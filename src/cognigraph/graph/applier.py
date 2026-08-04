"""Storage-neutral graph snapshots and an idempotent in-memory applier."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, Self
from uuid import UUID, uuid4

from pydantic import Field, model_validator

from cognigraph.domain.base import DomainModel, JsonObject, utc_now
from cognigraph.domain.documents import SourceSpan
from cognigraph.domain.enums import EpistemicStatus, GraphRevisionStatus, NodeType
from cognigraph.domain.graph import (
    GraphRevision,
    RelationAssertion,
    RelationType,
    core_relation_types,
)
from cognigraph.graph.delta import GraphDelta


class GraphNode(DomainModel):
    id: UUID
    workspace_id: UUID
    node_type: NodeType
    properties: JsonObject
    epistemic_status: EpistemicStatus
    source_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    source_span_ids: list[UUID] = Field(default_factory=list)
    created_by: str = "system"
    model_run_id: UUID | None = None
    graph_revision_id: UUID
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class GraphSnapshot(DomainModel):
    workspace_id: UUID
    revision_id: UUID | None = None
    revision_sequence: int = Field(default=0, ge=0)
    nodes: list[GraphNode] = Field(default_factory=list)
    assertions: list[RelationAssertion] = Field(default_factory=list)
    relation_types: list[RelationType] = Field(default_factory=list)
    source_spans: list[SourceSpan] = Field(default_factory=list)

    @model_validator(mode="after")
    def load_core_ontology(self) -> Self:
        if not self.relation_types:
            self.relation_types = core_relation_types(self.workspace_id)
        return self

    def node_map(self) -> dict[UUID, GraphNode]:
        return {node.id: node for node in self.nodes}

    def assertion_map(self) -> dict[UUID, RelationAssertion]:
        return {assertion.id: assertion for assertion in self.assertions}


class GraphApplyResult(DomainModel):
    revision: GraphRevision
    snapshot: GraphSnapshot
    already_applied: bool = False


class GraphApplier(Protocol):
    async def apply(
        self,
        delta: GraphDelta,
        *,
        revision_id: UUID | None = None,
    ) -> GraphApplyResult:
        """Apply a validated delta exactly once."""


@dataclass(slots=True)
class InMemoryGraphStore:
    """A deterministic graph projection used by tests and local mock mode."""

    snapshots: dict[UUID, GraphSnapshot] = field(default_factory=dict)
    applied_delta_results: dict[UUID, GraphApplyResult] = field(default_factory=dict)
    revisions: dict[UUID, list[GraphRevision]] = field(default_factory=dict)

    def get_snapshot(self, workspace_id: UUID) -> GraphSnapshot:
        snapshot = self.snapshots.get(workspace_id)
        if snapshot is None:
            return GraphSnapshot(workspace_id=workspace_id)
        return snapshot.model_copy(deep=True)

    def set_snapshot(self, snapshot: GraphSnapshot) -> None:
        self.snapshots[snapshot.workspace_id] = snapshot.model_copy(deep=True)


class InMemoryGraphApplier:
    def __init__(self, store: InMemoryGraphStore | None = None) -> None:
        self.store = store or InMemoryGraphStore()

    async def apply(
        self,
        delta: GraphDelta,
        *,
        revision_id: UUID | None = None,
    ) -> GraphApplyResult:
        cached = self.store.applied_delta_results.get(delta.id)
        if cached is not None:
            return cached.model_copy(update={"already_applied": True}, deep=True)

        current = self.store.get_snapshot(delta.workspace_id)
        if current.revision_id != delta.base_revision_id:
            raise ValueError("delta base revision does not match current graph revision")
        # Local import keeps the snapshot types storage-neutral while ensuring no
        # caller can bypass graph invariants by invoking the applier directly.
        from cognigraph.graph.validator import GraphDeltaValidator

        GraphDeltaValidator().require_valid(delta, current)

        revision_id = revision_id or uuid4()
        now = utc_now()
        sequence = current.revision_sequence + 1
        nodes = current.node_map()
        assertions = current.assertion_map()

        for node_create in delta.add_nodes:
            if node_create.id in nodes:
                raise ValueError(f"node {node_create.id} already exists")
            nodes[node_create.id] = GraphNode(
                id=node_create.id,
                workspace_id=delta.workspace_id,
                node_type=node_create.node_type,
                properties=deepcopy(node_create.properties),
                epistemic_status=node_create.epistemic_status,
                source_confidence=node_create.source_confidence,
                source_span_ids=list(node_create.source_span_ids),
                created_by=node_create.created_by,
                model_run_id=node_create.model_run_id or delta.generated_by_model_run_id,
                graph_revision_id=revision_id,
                created_at=now,
                updated_at=now,
            )

        for patch in delta.update_nodes:
            existing = nodes.get(patch.node_id)
            if existing is None:
                raise ValueError(f"cannot patch unknown node {patch.node_id}")
            properties = _merge_properties(existing.properties, patch.set_properties)
            source_ids = list(dict.fromkeys([*existing.source_span_ids, *patch.source_span_ids]))
            nodes[patch.node_id] = existing.model_copy(
                update={
                    "properties": properties,
                    "source_span_ids": source_ids,
                    "graph_revision_id": revision_id,
                    "updated_at": now,
                }
            )

        known_node_ids = set(nodes)
        for assertion_create in delta.add_assertions:
            if (
                assertion_create.subject_id not in known_node_ids
                or assertion_create.object_id not in known_node_ids
            ):
                raise ValueError("assertion endpoints must exist before applying the delta")
            if assertion_create.id in assertions:
                raise ValueError(f"assertion {assertion_create.id} already exists")
            assertions[assertion_create.id] = assertion_create.materialize(
                delta.workspace_id, revision_id
            )

        for supersede in delta.supersede_assertions:
            old = assertions.get(supersede.assertion_id)
            replacement = assertions.get(supersede.replacement_assertion_id)
            if old is None or replacement is None:
                raise ValueError("supersede operation references an unknown assertion")
            assertions[old.id] = old.model_copy(
                update={
                    "valid_to": supersede.superseded_at,
                    "superseded_at": supersede.superseded_at,
                    "epistemic_status": EpistemicStatus.SUPERSEDED,
                }
            )
            assertions[replacement.id] = replacement.model_copy(
                update={"supersedes_assertion_id": old.id}
            )

        for link in delta.add_provenance_links:
            node = nodes.get(link.entity_id)
            if node is not None:
                nodes[node.id] = node.model_copy(
                    update={
                        "source_span_ids": list(
                            dict.fromkeys([*node.source_span_ids, link.source_span_id])
                        ),
                        "updated_at": now,
                    }
                )
                continue
            assertion = assertions.get(link.entity_id)
            if assertion is not None:
                assertions[assertion.id] = assertion.model_copy(
                    update={
                        "source_span_ids": list(
                            dict.fromkeys([*assertion.source_span_ids, link.source_span_id])
                        )
                    }
                )

        source_spans = {span.id: span for span in current.source_spans}
        for node_create in delta.add_nodes:
            if node_create.node_type is NodeType.SOURCE_SPAN:
                payload = {"id": node_create.id, **node_create.properties}
                span = SourceSpan.model_validate(payload)
                source_spans[span.id] = span

        snapshot = GraphSnapshot(
            workspace_id=delta.workspace_id,
            revision_id=revision_id,
            revision_sequence=sequence,
            nodes=sorted(nodes.values(), key=lambda node: str(node.id)),
            assertions=sorted(assertions.values(), key=lambda assertion: str(assertion.id)),
            relation_types=current.relation_types,
            source_spans=sorted(source_spans.values(), key=lambda span: str(span.id)),
        )
        from cognigraph.graph.validator import ShaclGraphValidator

        shacl_result = ShaclGraphValidator(inference="none").validate_snapshot(snapshot)
        if not shacl_result.conforms:
            raise ValueError(f"SHACL validation failed: {shacl_result.report_text}")
        revision = GraphRevision(
            id=revision_id,
            workspace_id=delta.workspace_id,
            sequence=sequence,
            base_revision_id=delta.base_revision_id,
            delta_id=delta.id,
            status=GraphRevisionStatus.APPLIED,
            nodes_added=len(delta.add_nodes),
            nodes_updated=len(delta.update_nodes),
            assertions_added=len(delta.add_assertions),
            assertions_superseded=len(delta.supersede_assertions),
            content_hash=delta.content_hash(),
            created_at=now,
            applied_at=now,
        )
        result = GraphApplyResult(revision=revision, snapshot=snapshot)
        self.store.set_snapshot(snapshot)
        self.store.revisions.setdefault(delta.workspace_id, []).append(revision)
        self.store.applied_delta_results[delta.id] = result.model_copy(deep=True)
        return result


def _merge_properties(original: JsonObject, patch: JsonObject) -> JsonObject:
    merged = deepcopy(original)
    for key, value in patch.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = _merge_properties(current, value)
        else:
            merged[key] = deepcopy(value)
    return merged
