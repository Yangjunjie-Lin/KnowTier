from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.domain.enums import DocumentOrigin
from cognigraph.persistence.postgres.base import utc_now
from cognigraph.persistence.postgres.models import (
    AssertionSource,
    GraphChangeEvent,
    GraphConflict,
    GraphNodeRecord,
    GraphNodeSource,
    GraphRevision,
    OutboxMessage,
    RelationAssertionRecord,
    SourceSpan,
    Workspace,
)
from cognigraph.persistence.postgres.models import Document as DocumentRecord
from cognigraph.persistence.repositories._serialization import (
    as_mapping,
    datetime_value,
    enum_value,
    optional_uuid,
    to_plain,
    uuid_value,
)


class GraphRevisionConflictError(RuntimeError):
    """The delta was compiled against a graph revision that is no longer current."""


class GraphRecordValidationError(ValueError):
    """A delta cannot be represented without violating persistence invariants."""


@dataclass(frozen=True, slots=True)
class GraphPersistenceResult:
    revision_id: UUID
    sequence_number: int
    nodes_added: int
    nodes_updated: int
    assertions_added: int
    assertions_superseded: int
    outbox_message_id: UUID
    idempotent_replay: bool = False


@dataclass(frozen=True, slots=True)
class GraphNodeDetailRecord:
    node: GraphNodeRecord
    sources: list[SourceSpan]
    incoming: list[RelationAssertionRecord]
    outgoing: list[RelationAssertionRecord]


@dataclass(frozen=True, slots=True)
class AssertionDetailRecord:
    assertion: RelationAssertionRecord
    sources: list[SourceSpan]


class GraphDeltaRepository:
    """Store a validated graph delta, revision and projection message atomically."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def latest_revision(self, workspace_id: UUID) -> GraphRevision | None:
        result: GraphRevision | None = await self.session.scalar(
            select(GraphRevision)
            .where(GraphRevision.workspace_id == workspace_id)
            .order_by(GraphRevision.sequence_number.desc())
            .limit(1)
        )
        return result

    async def get_revision(self, revision_id: UUID) -> GraphRevision | None:
        result: GraphRevision | None = await self.session.get(GraphRevision, revision_id)
        return result

    async def list_revisions(self, workspace_id: UUID, *, limit: int = 100) -> list[GraphRevision]:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        result = await self.session.scalars(
            select(GraphRevision)
            .where(GraphRevision.workspace_id == workspace_id)
            .order_by(GraphRevision.sequence_number.desc())
            .limit(limit)
        )
        return list(result.all())

    async def get_node(
        self, workspace_id: UUID, node_id: UUID, *, active_only: bool = False
    ) -> GraphNodeRecord | None:
        statement = select(GraphNodeRecord).where(
            GraphNodeRecord.workspace_id == workspace_id,
            GraphNodeRecord.id == node_id,
        )
        if active_only:
            statement = statement.where(GraphNodeRecord.is_active.is_(True))
        result: GraphNodeRecord | None = await self.session.scalar(statement)
        return result

    async def get_assertion(
        self, workspace_id: UUID, assertion_id: UUID, *, active_only: bool = False
    ) -> RelationAssertionRecord | None:
        statement = select(RelationAssertionRecord).where(
            RelationAssertionRecord.workspace_id == workspace_id,
            RelationAssertionRecord.id == assertion_id,
        )
        if active_only:
            statement = statement.where(
                RelationAssertionRecord.superseded_at.is_(None),
                RelationAssertionRecord.valid_to.is_(None),
            )
        result: RelationAssertionRecord | None = await self.session.scalar(statement)
        return result

    async def get_node_detail(
        self, workspace_id: UUID, node_id: UUID
    ) -> GraphNodeDetailRecord | None:
        node = await self.get_node(workspace_id, node_id)
        if node is None:
            return None
        sources = list(
            (
                await self.session.scalars(
                    select(SourceSpan)
                    .join(GraphNodeSource, GraphNodeSource.source_span_id == SourceSpan.id)
                    .join(DocumentRecord, DocumentRecord.id == SourceSpan.document_id)
                    .where(
                        GraphNodeSource.node_id == node_id,
                        SourceSpan.workspace_id == workspace_id,
                        DocumentRecord.origin == DocumentOrigin.USER_UPLOAD.value,
                    )
                    .order_by(SourceSpan.created_at)
                )
            ).all()
        )
        outgoing = list(
            (
                await self.session.scalars(
                    select(RelationAssertionRecord)
                    .where(
                        RelationAssertionRecord.workspace_id == workspace_id,
                        RelationAssertionRecord.subject_id == node_id,
                    )
                    .order_by(RelationAssertionRecord.created_at)
                )
            ).all()
        )
        incoming = list(
            (
                await self.session.scalars(
                    select(RelationAssertionRecord)
                    .where(
                        RelationAssertionRecord.workspace_id == workspace_id,
                        RelationAssertionRecord.object_id == node_id,
                    )
                    .order_by(RelationAssertionRecord.created_at)
                )
            ).all()
        )
        return GraphNodeDetailRecord(
            node=node,
            sources=sources,
            incoming=incoming,
            outgoing=outgoing,
        )

    async def get_assertion_detail(
        self, workspace_id: UUID, assertion_id: UUID
    ) -> AssertionDetailRecord | None:
        assertion = await self.get_assertion(workspace_id, assertion_id)
        if assertion is None:
            return None
        sources = list(
            (
                await self.session.scalars(
                    select(SourceSpan)
                    .join(AssertionSource, AssertionSource.source_span_id == SourceSpan.id)
                    .join(DocumentRecord, DocumentRecord.id == SourceSpan.document_id)
                    .where(
                        AssertionSource.assertion_id == assertion_id,
                        SourceSpan.workspace_id == workspace_id,
                        DocumentRecord.origin == DocumentOrigin.USER_UPLOAD.value,
                    )
                    .order_by(SourceSpan.created_at)
                )
            ).all()
        )
        return AssertionDetailRecord(assertion=assertion, sources=sources)

    async def persist_delta(
        self,
        delta: Any,
        *,
        created_by: str = "system",
        idempotency_key: str | None = None,
    ) -> GraphPersistenceResult:
        raw = as_mapping(delta)
        workspace_id = uuid_value(raw["workspace_id"])
        key = idempotency_key or self._delta_key(raw)

        workspace = await self.session.scalar(
            select(Workspace).where(Workspace.id == workspace_id).with_for_update()
        )
        if workspace is None:
            raise GraphRecordValidationError(f"workspace {workspace_id} does not exist")

        existing_event = await self.session.scalar(
            select(GraphChangeEvent).where(
                GraphChangeEvent.workspace_id == workspace_id,
                GraphChangeEvent.idempotency_key == key,
            )
        )
        if existing_event is not None:
            return await self._replay_result(existing_event, key)

        latest = await self.latest_revision(workspace_id)
        latest_id = latest.id if latest is not None else None
        base_id = optional_uuid(raw.get("base_revision_id"))
        if base_id != latest_id:
            raise GraphRevisionConflictError(
                f"delta base revision {base_id} does not match latest revision {latest_id}"
            )

        sequence = (latest.sequence_number if latest is not None else 0) + 1
        revision_id = uuid4()
        model_run_id = optional_uuid(raw.get("generated_by_model_run_id"))
        nodes_added = len(raw.get("add_nodes", []))
        nodes_updated = len(raw.get("update_nodes", []))
        assertions_added = len(raw.get("add_assertions", []))
        assertions_superseded = len(raw.get("supersede_assertions", []))
        summary = {
            "nodes_added": nodes_added,
            "nodes_updated": nodes_updated,
            "assertions_added": assertions_added,
            "assertions_superseded": assertions_superseded,
            "conflict_count": len(raw.get("conflicts", [])),
        }
        revision = GraphRevision(
            id=revision_id,
            workspace_id=workspace_id,
            sequence_number=sequence,
            parent_revision_id=latest_id,
            status="PENDING",
            projection_status="PENDING",
            summary=summary,
            created_by=created_by,
            model_run_id=model_run_id,
        )
        self.session.add(revision)
        await self.session.flush()

        for node_value in raw.get("add_nodes", []):
            await self._add_node(workspace_id, revision_id, model_run_id, as_mapping(node_value))
        for patch_value in raw.get("update_nodes", []):
            await self._update_node(workspace_id, revision_id, as_mapping(patch_value))
        for assertion_value in raw.get("add_assertions", []):
            await self._add_assertion(
                workspace_id,
                revision_id,
                model_run_id,
                created_by,
                as_mapping(assertion_value),
            )
        for supersede_value in raw.get("supersede_assertions", []):
            await self._supersede_assertion(workspace_id, revision_id, as_mapping(supersede_value))
        for link_value in raw.get("add_provenance_links", []):
            await self._add_provenance_link(
                workspace_id, revision_id, model_run_id, as_mapping(link_value)
            )
        for conflict_value in raw.get("conflicts", []):
            await self._add_conflict(workspace_id, revision_id, as_mapping(conflict_value))

        payload = dict(raw)
        payload["revision_id"] = str(revision_id)
        payload["sequence_number"] = sequence
        payload["idempotency_key"] = key
        payload = to_plain(payload)
        event = GraphChangeEvent(
            workspace_id=workspace_id,
            revision_id=revision_id,
            idempotency_key=key,
            delta=payload,
        )
        message = OutboxMessage(
            workspace_id=workspace_id,
            aggregate_type="GraphRevision",
            aggregate_id=revision_id,
            event_type="GRAPH_DELTA_COMMITTED",
            idempotency_key=f"neo4j:{key}",
            payload=payload,
        )
        self.session.add_all([event, message])
        await self.session.flush()
        return GraphPersistenceResult(
            revision_id=revision_id,
            sequence_number=sequence,
            nodes_added=nodes_added,
            nodes_updated=nodes_updated,
            assertions_added=assertions_added,
            assertions_superseded=assertions_superseded,
            outbox_message_id=message.id,
        )

    async def _add_node(
        self,
        workspace_id: UUID,
        revision_id: UUID,
        model_run_id: UUID | None,
        raw: dict[str, Any],
    ) -> None:
        node_id = uuid_value(raw.get("id") or uuid4())
        properties = dict(raw.get("properties") or {})
        entity_type = enum_value(raw.get("node_type") or raw.get("entity_type"))
        if not entity_type:
            raise GraphRecordValidationError("graph node requires node_type")
        display_name = str(
            properties.get("display_name")
            or properties.get("canonical_name")
            or properties.get("name")
            or node_id
        )
        canonical_name = str(properties.get("canonical_name") or display_name).strip().casefold()
        canonical_key = str(raw.get("canonical_key") or f"{entity_type}:{canonical_name}")
        existing = await self.get_node(workspace_id, node_id)
        if existing is not None:
            if existing.canonical_key != canonical_key:
                raise GraphRecordValidationError(f"node UUID collision for {node_id}")
            return
        epistemic_status = enum_value(raw.get("epistemic_status"), "UNVERIFIED")
        source_span_ids = raw.get("source_span_ids", [])
        evidence_carriers = {
            "SourceDocument",
            "SourceSpan",
            "EntityType",
            "RelationType",
            "Constraint",
            "EpistemicStatus",
        }
        if (
            epistemic_status == "CONFIRMED"
            and entity_type not in evidence_carriers
            and not source_span_ids
        ):
            raise GraphRecordValidationError("confirmed graph nodes require source evidence")
        confidence = float(raw.get("source_confidence", raw.get("confidence", 0.0)) or 0.0)
        if not 0.0 <= confidence <= 1.0:
            raise GraphRecordValidationError("node source confidence must be between 0 and 1")
        node_model_run_id = optional_uuid(raw.get("model_run_id")) or model_run_id
        stored_properties: dict[str, Any] = {
            str(key): to_plain(value) for key, value in properties.items()
        }
        stored_properties.setdefault("created_by", str(raw.get("created_by") or "system"))
        if node_model_run_id is not None:
            stored_properties.setdefault("model_run_id", str(node_model_run_id))
        node = GraphNodeRecord(
            id=node_id,
            workspace_id=workspace_id,
            canonical_key=canonical_key,
            entity_type=entity_type,
            display_name=display_name,
            properties=stored_properties,
            epistemic_status=epistemic_status,
            source_confidence=confidence,
            graph_revision_id=revision_id,
        )
        self.session.add(node)
        await self.session.flush()
        for span_id in source_span_ids:
            await self._link_node_source(
                workspace_id,
                node_id,
                uuid_value(span_id),
                revision_id,
                model_run_id=node_model_run_id,
            )

    async def _update_node(
        self, workspace_id: UUID, revision_id: UUID, raw: dict[str, Any]
    ) -> None:
        node_id = uuid_value(raw.get("node_id") or raw.get("id"))
        node = await self.get_node(workspace_id, node_id)
        if node is None:
            raise GraphRecordValidationError(f"cannot update missing node {node_id}")
        expected_revision_id = optional_uuid(raw.get("expected_revision_id"))
        if expected_revision_id is not None and expected_revision_id != node.graph_revision_id:
            raise GraphRevisionConflictError(
                f"node {node_id} was last changed in {node.graph_revision_id}, "
                f"not {expected_revision_id}"
            )
        changes = (
            raw.get("set_properties")
            or raw.get("changes")
            or raw.get("patch")
            or raw.get("properties")
            or {}
        )
        if not isinstance(changes, dict):
            raise GraphRecordValidationError("node patch changes must be an object")
        protected = {"id", "workspace_id", "graph_revision_id", "created_at"}
        properties = dict(node.properties)
        for key, value in changes.items():
            if key not in protected:
                properties[str(key)] = to_plain(value)
        node.properties = properties
        node.display_name = str(properties.get("display_name") or node.display_name)
        node.epistemic_status = enum_value(raw.get("epistemic_status"), node.epistemic_status)
        node.graph_revision_id = revision_id
        for span_id in raw.get("source_span_ids", []):
            await self._link_node_source(
                workspace_id,
                node_id,
                uuid_value(span_id),
                revision_id,
            )

    async def _add_assertion(
        self,
        workspace_id: UUID,
        revision_id: UUID,
        generated_model_run_id: UUID | None,
        created_by: str,
        raw: dict[str, Any],
    ) -> None:
        assertion_id = uuid_value(raw.get("id") or uuid4())
        subject_id = uuid_value(raw["subject_id"])
        object_id = uuid_value(raw["object_id"])
        if subject_id == object_id:
            raise GraphRecordValidationError("assertion subject and object must differ")
        if await self.get_node(workspace_id, subject_id) is None:
            raise GraphRecordValidationError(f"assertion subject {subject_id} does not exist")
        if await self.get_node(workspace_id, object_id) is None:
            raise GraphRecordValidationError(f"assertion object {object_id} does not exist")
        predicate = enum_value(raw.get("predicate") or raw.get("predicate_key"))
        if not predicate:
            raise GraphRecordValidationError("assertion predicate is required")
        relation_type_id = optional_uuid(raw.get("relation_type_id"))
        if relation_type_id is not None:
            relation_type = await self.get_node(workspace_id, relation_type_id)
            if relation_type is None or relation_type.entity_type != "RelationType":
                raise GraphRecordValidationError(
                    f"relation type {relation_type_id} does not exist in the workspace"
                )
            relation_name = str(relation_type.properties.get("name") or "")
            if relation_name != predicate:
                raise GraphRecordValidationError(
                    f"relation type {relation_type_id} does not match predicate {predicate}"
                )
        assertion_key = str(
            raw.get("idempotency_key") or f"{subject_id}:{predicate}:{object_id}:{assertion_id}"
        )
        duplicate = await self.session.scalar(
            select(RelationAssertionRecord).where(
                RelationAssertionRecord.workspace_id == workspace_id,
                RelationAssertionRecord.idempotency_key == assertion_key,
            )
        )
        if duplicate is not None:
            return
        valid_from = datetime_value(raw.get("valid_from"), default=utc_now())
        assert valid_from is not None
        epistemic_status = enum_value(raw.get("epistemic_status"), "UNVERIFIED")
        source_span_ids = raw.get("source_span_ids", [])
        if epistemic_status == "CONFIRMED" and not source_span_ids:
            raise GraphRecordValidationError("confirmed assertions require source evidence")
        confidence = float(raw.get("confidence", 0.0))
        if not 0.0 <= confidence <= 1.0:
            raise GraphRecordValidationError("assertion confidence must be between 0 and 1")
        assertion = RelationAssertionRecord(
            id=assertion_id,
            workspace_id=workspace_id,
            subject_id=subject_id,
            relation_type_id=relation_type_id,
            predicate_key=predicate,
            object_id=object_id,
            natural_language_description=str(raw.get("natural_language_description") or ""),
            confidence=confidence,
            epistemic_status=epistemic_status,
            valid_from=valid_from,
            valid_to=datetime_value(raw.get("valid_to")),
            created_by=str(raw.get("created_by") or created_by),
            model_run_id=optional_uuid(raw.get("model_run_id")) or generated_model_run_id,
            graph_revision_id=revision_id,
            idempotency_key=assertion_key,
        )
        self.session.add(assertion)
        await self.session.flush()
        for span_id in source_span_ids:
            await self._link_assertion_source(
                workspace_id,
                assertion_id,
                uuid_value(span_id),
            )

    async def _supersede_assertion(
        self, workspace_id: UUID, revision_id: UUID, raw: dict[str, Any]
    ) -> None:
        assertion_id = uuid_value(
            raw.get("assertion_id") or raw.get("old_assertion_id") or raw.get("id")
        )
        assertion = await self.get_assertion(workspace_id, assertion_id)
        if assertion is None:
            raise GraphRecordValidationError(f"cannot supersede missing assertion {assertion_id}")
        when = datetime_value(raw.get("superseded_at"), default=utc_now())
        assert when is not None
        if assertion.superseded_at is None:
            assertion.superseded_at = when
            assertion.valid_to = datetime_value(raw.get("valid_to"), default=when)
        replacement_id = optional_uuid(
            raw.get("superseded_by_assertion_id") or raw.get("replacement_assertion_id")
        )
        if replacement_id is not None:
            replacement = await self.get_assertion(workspace_id, replacement_id)
            if replacement is None:
                raise GraphRecordValidationError(
                    f"superseding assertion {replacement_id} does not exist"
                )
            replacement.supersedes_assertion_id = assertion_id
            replacement.graph_revision_id = revision_id

    async def _add_provenance_link(
        self,
        workspace_id: UUID,
        revision_id: UUID,
        model_run_id: UUID | None,
        raw: dict[str, Any],
    ) -> None:
        target_id = uuid_value(
            raw.get("entity_id") or raw.get("target_id") or raw.get("node_or_assertion_id")
        )
        span_id = uuid_value(raw["source_span_id"])
        target_kind = enum_value(raw.get("target_kind") or raw.get("target_type")).upper()
        node = await self.get_node(workspace_id, target_id)
        assertion = await self.get_assertion(workspace_id, target_id)
        if target_kind in {"NODE", "KNOWLEDGE_POINT"} or (not target_kind and node):
            await self._link_node_source(
                workspace_id,
                target_id,
                span_id,
                revision_id,
                model_run_id=model_run_id,
            )
            return
        if target_kind in {"ASSERTION", "RELATION_ASSERTION"} or (not target_kind and assertion):
            await self._link_assertion_source(workspace_id, target_id, span_id)
            return
        raise GraphRecordValidationError(f"unknown provenance target kind {target_kind!r}")

    async def _link_node_source(
        self,
        workspace_id: UUID,
        node_id: UUID,
        source_span_id: UUID,
        revision_id: UUID,
        *,
        model_run_id: UUID | None = None,
    ) -> None:
        await self._require_workspace_source(workspace_id, source_span_id)
        key = {"node_id": node_id, "source_span_id": source_span_id}
        if await self.session.get(GraphNodeSource, key) is None:
            self.session.add(
                GraphNodeSource(
                    node_id=node_id,
                    source_span_id=source_span_id,
                    model_run_id=model_run_id,
                    graph_revision_id=revision_id,
                )
            )

    async def _link_assertion_source(
        self,
        workspace_id: UUID,
        assertion_id: UUID,
        source_span_id: UUID,
    ) -> None:
        await self._require_workspace_source(workspace_id, source_span_id)
        key = {"assertion_id": assertion_id, "source_span_id": source_span_id}
        if await self.session.get(AssertionSource, key) is None:
            self.session.add(
                AssertionSource(assertion_id=assertion_id, source_span_id=source_span_id)
            )

    async def _require_workspace_source(
        self,
        workspace_id: UUID,
        source_span_id: UUID,
    ) -> SourceSpan:
        source = await self.session.scalar(
            select(SourceSpan).where(
                SourceSpan.id == source_span_id,
                SourceSpan.workspace_id == workspace_id,
            )
        )
        if source is None:
            raise GraphRecordValidationError(
                f"source span {source_span_id} does not belong to workspace {workspace_id}"
            )
        return source

    async def _add_conflict(
        self, workspace_id: UUID, revision_id: UUID, raw: dict[str, Any]
    ) -> None:
        conflict = GraphConflict(
            id=uuid_value(raw.get("id") or uuid4()),
            workspace_id=workspace_id,
            revision_id=revision_id,
            conflict_type=enum_value(raw.get("conflict_type") or raw.get("type"), "SEMANTIC"),
            status="OPEN",
            subject_id=optional_uuid(raw.get("subject_id")),
            predicate_key=enum_value(raw.get("predicate") or raw.get("predicate_key")) or None,
            assertion_ids=[str(value) for value in raw.get("assertion_ids", [])],
            details=to_plain(raw),
        )
        self.session.add(conflict)

    async def _replay_result(self, event: GraphChangeEvent, key: str) -> GraphPersistenceResult:
        revision = await self.session.get(GraphRevision, event.revision_id)
        if revision is None:
            raise RuntimeError("graph event refers to a missing revision")
        message = await self.session.scalar(
            select(OutboxMessage).where(
                OutboxMessage.workspace_id == event.workspace_id,
                OutboxMessage.idempotency_key == f"neo4j:{key}",
            )
        )
        if message is None:
            raise RuntimeError("graph event refers to a missing outbox message")
        summary = revision.summary
        return GraphPersistenceResult(
            revision_id=revision.id,
            sequence_number=revision.sequence_number,
            nodes_added=int(summary.get("nodes_added", 0)),
            nodes_updated=int(summary.get("nodes_updated", 0)),
            assertions_added=int(summary.get("assertions_added", 0)),
            assertions_superseded=int(summary.get("assertions_superseded", 0)),
            outbox_message_id=message.id,
            idempotent_replay=True,
        )

    @staticmethod
    def _delta_key(raw: dict[str, Any]) -> str:
        explicit = raw.get("delta_id") or raw.get("id")
        if explicit is not None:
            return f"delta:{explicit}"
        canonical = json.dumps(to_plain(raw), sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return f"sha256:{digest}"
