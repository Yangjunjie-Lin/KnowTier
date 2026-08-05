"""Persistence for learner-specific graph revisions and relation assertions."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.domain.enums import LearnerRelationType
from cognigraph.domain.learner import LearnerGraphDelta
from cognigraph.persistence.postgres.base import utc_now
from cognigraph.persistence.postgres.models import (
    ConversationTurn,
    Learner,
    LearnerGraphChangeEvent,
    LearnerGraphRevision,
    LearnerRelationAssertion,
    LearnerRelationAssertionSource,
    MasteryEvidence,
    SourceSpan,
    TutoringSession,
)
from cognigraph.persistence.repositories._serialization import (
    as_mapping,
    datetime_value,
    optional_uuid,
    to_plain,
    uuid_value,
)


class LearnerGraphRecordValidationError(ValueError):
    """A learner graph change violates a persistence invariant."""


class LearnerGraphRevisionConflictError(LearnerGraphRecordValidationError):
    """A typed learner delta was built from a stale parent revision."""


@dataclass(frozen=True, slots=True)
class LearnerGraphPersistenceResult:
    revision_id: UUID
    sequence_number: int
    assertions_added: int
    assertions_superseded: int
    idempotent_replay: bool = False


@dataclass(frozen=True, slots=True)
class LearnerAssertionDetailRecord:
    assertion: LearnerRelationAssertion
    sources: list[SourceSpan]


class LearnerGraphRepository:
    """Store learner graph updates in the same transaction as a tutoring turn.

    The repository accepts plain mappings deliberately: model output can be
    converted into a constrained application predicate before it reaches this
    boundary, and no arbitrary graph query or write is exposed here.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def latest_revision(
        self, learner_id: UUID, *, workspace_id: UUID | None = None
    ) -> LearnerGraphRevision | None:
        statement = select(LearnerGraphRevision).where(
            LearnerGraphRevision.learner_id == learner_id
        )
        if workspace_id is not None:
            statement = statement.where(LearnerGraphRevision.workspace_id == workspace_id)
        result: LearnerGraphRevision | None = await self.session.scalar(
            statement.order_by(LearnerGraphRevision.sequence_number.desc()).limit(1)
        )
        return result

    async def get_revision(
        self,
        learner_id: UUID,
        revision_id: UUID,
        *,
        workspace_id: UUID | None = None,
    ) -> LearnerGraphRevision | None:
        statement = select(LearnerGraphRevision).where(
            LearnerGraphRevision.id == revision_id,
            LearnerGraphRevision.learner_id == learner_id,
        )
        if workspace_id is not None:
            statement = statement.where(LearnerGraphRevision.workspace_id == workspace_id)
        result: LearnerGraphRevision | None = await self.session.scalar(statement)
        return result

    async def list_revisions(
        self,
        learner_id: UUID,
        *,
        workspace_id: UUID | None = None,
        limit: int = 100,
    ) -> list[LearnerGraphRevision]:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        statement = select(LearnerGraphRevision).where(
            LearnerGraphRevision.learner_id == learner_id
        )
        if workspace_id is not None:
            statement = statement.where(LearnerGraphRevision.workspace_id == workspace_id)
        result = await self.session.scalars(
            statement.order_by(LearnerGraphRevision.sequence_number.desc()).limit(limit)
        )
        return list(result.all())

    async def list_change_events(
        self,
        learner_id: UUID,
        *,
        workspace_id: UUID | None = None,
        limit: int = 100,
    ) -> list[LearnerGraphChangeEvent]:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        statement = select(LearnerGraphChangeEvent).where(
            LearnerGraphChangeEvent.learner_id == learner_id
        )
        if workspace_id is not None:
            statement = statement.where(LearnerGraphChangeEvent.workspace_id == workspace_id)
        result = await self.session.scalars(
            statement.order_by(LearnerGraphChangeEvent.created_at.desc()).limit(limit)
        )
        return list(result.all())

    async def get_assertion(
        self,
        learner_id: UUID,
        assertion_id: UUID,
        *,
        workspace_id: UUID | None = None,
        active_only: bool = False,
    ) -> LearnerRelationAssertion | None:
        statement = select(LearnerRelationAssertion).where(
            LearnerRelationAssertion.id == assertion_id,
            LearnerRelationAssertion.learner_id == learner_id,
        )
        if workspace_id is not None:
            statement = statement.where(LearnerRelationAssertion.workspace_id == workspace_id)
        if active_only:
            statement = statement.where(
                LearnerRelationAssertion.valid_to.is_(None),
                LearnerRelationAssertion.superseded_at.is_(None),
            )
        result: LearnerRelationAssertion | None = await self.session.scalar(statement)
        return result

    async def list_assertions(
        self,
        learner_id: UUID,
        *,
        workspace_id: UUID | None = None,
        revision_id: UUID | None = None,
        active_only: bool = False,
        limit: int = 1000,
    ) -> list[LearnerRelationAssertion]:
        if not 1 <= limit <= 5000:
            raise ValueError("limit must be between 1 and 5000")
        statement = select(LearnerRelationAssertion).where(
            LearnerRelationAssertion.learner_id == learner_id
        )
        if workspace_id is not None:
            statement = statement.where(LearnerRelationAssertion.workspace_id == workspace_id)
        if revision_id is not None:
            statement = statement.where(
                LearnerRelationAssertion.learner_graph_revision_id == revision_id
            )
        if active_only:
            statement = statement.where(
                LearnerRelationAssertion.valid_to.is_(None),
                LearnerRelationAssertion.superseded_at.is_(None),
            )
        result = await self.session.scalars(
            statement.order_by(
                LearnerRelationAssertion.created_at,
                LearnerRelationAssertion.id,
            ).limit(limit)
        )
        return list(result.all())

    async def get_assertion_detail(
        self,
        learner_id: UUID,
        assertion_id: UUID,
        *,
        workspace_id: UUID | None = None,
    ) -> LearnerAssertionDetailRecord | None:
        assertion = await self.get_assertion(
            learner_id,
            assertion_id,
            workspace_id=workspace_id,
        )
        if assertion is None:
            return None
        sources = list(
            (
                await self.session.scalars(
                    select(SourceSpan)
                    .join(
                        LearnerRelationAssertionSource,
                        LearnerRelationAssertionSource.source_span_id == SourceSpan.id,
                    )
                    .where(
                        LearnerRelationAssertionSource.assertion_id == assertion_id,
                        SourceSpan.workspace_id == assertion.workspace_id,
                    )
                    .order_by(SourceSpan.created_at)
                )
            ).all()
        )
        return LearnerAssertionDetailRecord(assertion=assertion, sources=sources)

    async def persist_revision(
        self,
        *,
        workspace_id: UUID,
        learner_id: UUID,
        session_id: UUID,
        turn_id: UUID,
        assertions: Sequence[Mapping[str, object] | object] = (),
        supersede_assertion_ids: Sequence[UUID] = (),
        replace_keys: Sequence[tuple[str, UUID, UUID]] | None = None,
        change_summary: Mapping[str, object] | None = None,
        idempotency_key: str | None = None,
        base_revision_id: UUID | None = None,
        enforce_base_revision: bool = False,
    ) -> LearnerGraphPersistenceResult:
        """Append one learner graph revision and close replaced assertions.

        ``replace_keys`` lets callers close a prior misconception even when the
        new turn does not emit a replacement edge.  By default every newly
        emitted edge replaces the active edge with the same predicate/endpoints.
        """

        if not assertions and not supersede_assertion_ids and not replace_keys:
            # A tutoring turn still needs a revision for auditability; an empty
            # delta is valid and records the turn boundary.
            assertions = ()
        learner = await self.session.scalar(
            select(Learner)
            .where(Learner.id == learner_id, Learner.workspace_id == workspace_id)
            .with_for_update()
        )
        if learner is None:
            raise LearnerGraphRecordValidationError("learner does not belong to workspace")
        session = await self.session.scalar(
            select(TutoringSession).where(
                TutoringSession.id == session_id,
                TutoringSession.learner_id == learner_id,
                TutoringSession.workspace_id == workspace_id,
            )
        )
        if session is None:
            raise LearnerGraphRecordValidationError("session does not belong to learner")
        turn = await self.session.scalar(
            select(ConversationTurn).where(
                ConversationTurn.id == turn_id,
                ConversationTurn.learner_id == learner_id,
                ConversationTurn.workspace_id == workspace_id,
                ConversationTurn.session_id == session_id,
            )
        )
        if turn is None:
            raise LearnerGraphRecordValidationError("turn does not belong to learner session")

        key = idempotency_key or f"turn:{turn_id}"
        request_fingerprint = _delta_fingerprint(
            assertions,
            supersede_assertion_ids,
            replace_keys,
            change_summary,
            base_revision_id,
        )
        existing_event = await self.session.scalar(
            select(LearnerGraphChangeEvent).where(
                LearnerGraphChangeEvent.learner_id == learner_id,
                LearnerGraphChangeEvent.idempotency_key == key,
            )
        )
        if existing_event is not None:
            # Validate the caller's predicate set even on an idempotent retry;
            # a reused turn key must never become a bypass for relation policy.
            for raw_value in assertions:
                raw_mapping = as_mapping(raw_value)
                predicate = str(raw_mapping.get("predicate") or "").strip()
                if predicate not in {item.value for item in LearnerRelationType}:
                    raise LearnerGraphRecordValidationError(
                        f"unsupported learner relation predicate: {predicate}"
                    )
            existing_fingerprint = (
                existing_event.delta.get("request_fingerprint")
                if isinstance(existing_event.delta, dict)
                else None
            )
            if existing_fingerprint is not None and existing_fingerprint != request_fingerprint:
                raise LearnerGraphRecordValidationError(
                    "idempotency key was already used for a different learner graph delta"
                )
            revision = await self.session.get(
                LearnerGraphRevision, existing_event.learner_graph_revision_id
            )
            if revision is None:
                raise LearnerGraphRecordValidationError(
                    "learner graph event references a missing revision"
                )
            # The replay counts are derived from the already persisted delta,
            # keeping this path free of an extra aggregate query.
            raw_delta = existing_event.delta
            raw_added = raw_delta.get("assertions_added", []) if isinstance(raw_delta, dict) else []
            raw_superseded = (
                raw_delta.get("assertions_superseded", []) if isinstance(raw_delta, dict) else []
            )
            return LearnerGraphPersistenceResult(
                revision_id=revision.id,
                sequence_number=revision.sequence_number,
                assertions_added=(len(raw_added) if isinstance(raw_added, list) else 0),
                assertions_superseded=(
                    len(raw_superseded) if isinstance(raw_superseded, list) else 0
                ),
                idempotent_replay=True,
            )

        normalized = [as_mapping(item) for item in assertions]
        supported_predicates = {item.value for item in LearnerRelationType}
        keys: set[tuple[str, UUID, UUID]] = set()
        for raw_key in replace_keys or ():
            if len(raw_key) != 3:
                raise LearnerGraphRecordValidationError(
                    "replace_keys must contain predicate, subject, and object"
                )
            raw_predicate, raw_subject_id, raw_object_id = raw_key
            predicate = str(raw_predicate).strip()
            if predicate not in supported_predicates:
                raise LearnerGraphRecordValidationError(
                    f"unsupported learner relation predicate: {predicate}"
                )
            try:
                subject_id = uuid_value(raw_subject_id)
                object_id = uuid_value(raw_object_id)
            except (TypeError, ValueError) as exc:
                raise LearnerGraphRecordValidationError(
                    "replace_keys endpoints must be UUIDs"
                ) from exc
            if subject_id == object_id:
                raise LearnerGraphRecordValidationError(
                    "replace_keys subject and object must differ"
                )
            keys.add((predicate, subject_id, object_id))
        try:
            explicit_supersede_ids = [uuid_value(value) for value in supersede_assertion_ids]
        except (TypeError, ValueError) as exc:
            raise LearnerGraphRecordValidationError(
                "supersede_assertion_ids must contain UUIDs"
            ) from exc
        raw_supersede_ids: list[UUID] = []
        for raw in normalized:
            predicate = str(raw.get("predicate") or "").strip()
            if not predicate:
                raise LearnerGraphRecordValidationError("learner assertion predicate is required")
            if predicate not in supported_predicates:
                raise LearnerGraphRecordValidationError(
                    f"unsupported learner relation predicate: {predicate}"
                )
            try:
                subject_id = uuid_value(raw["subject_id"])
                object_id = uuid_value(raw["object_id"])
            except (KeyError, ValueError, TypeError) as exc:
                raise LearnerGraphRecordValidationError(
                    "learner assertion endpoints must be UUIDs"
                ) from exc
            if subject_id == object_id:
                raise LearnerGraphRecordValidationError(
                    "learner assertion subject and object must differ"
                )
            try:
                confidence = float(raw.get("confidence", 0.0))
            except (TypeError, ValueError) as exc:
                raise LearnerGraphRecordValidationError(
                    "learner assertion confidence must be numeric"
                ) from exc
            if not 0.0 <= confidence <= 1.0:
                raise LearnerGraphRecordValidationError(
                    "learner assertion confidence must be between 0 and 1"
                )
            if not str(raw.get("natural_language_description") or "").strip():
                raise LearnerGraphRecordValidationError("learner assertion description is required")
            raw_supersede_value = raw.get("supersedes_assertion_id")
            if raw_supersede_value not in (None, ""):
                try:
                    raw_supersede_ids.append(uuid_value(raw_supersede_value))
                except (TypeError, ValueError) as exc:
                    raise LearnerGraphRecordValidationError(
                        "supersedes_assertion_id must be a UUID"
                    ) from exc
            keys.add((predicate, subject_id, object_id))

        source_turn_ids = {
            turn_id_value
            for raw in normalized
            if (turn_id_value := optional_uuid(raw.get("source_turn_id"))) is not None
        }
        evidence_ids = {
            evidence_id
            for raw in normalized
            if (evidence_id := optional_uuid(raw.get("mastery_evidence_id"))) is not None
        }
        if source_turn_ids:
            valid_turn_ids = set(
                (
                    await self.session.scalars(
                        select(ConversationTurn.id).where(
                            ConversationTurn.id.in_(source_turn_ids),
                            ConversationTurn.workspace_id == workspace_id,
                            ConversationTurn.learner_id == learner_id,
                            ConversationTurn.session_id == session_id,
                        )
                    )
                ).all()
            )
            if valid_turn_ids != source_turn_ids:
                raise LearnerGraphRecordValidationError(
                    "learner assertion source turns must belong to the learner session"
                )
        if evidence_ids:
            valid_evidence_ids = set(
                (
                    await self.session.scalars(
                        select(MasteryEvidence.id).where(
                            MasteryEvidence.id.in_(evidence_ids),
                            MasteryEvidence.workspace_id == workspace_id,
                            MasteryEvidence.learner_id == learner_id,
                            MasteryEvidence.session_id == session_id,
                        )
                    )
                ).all()
            )
            if valid_evidence_ids != evidence_ids:
                raise LearnerGraphRecordValidationError(
                    "learner assertion evidence must belong to the learner session"
                )

        if len(set(raw_supersede_ids)) != len(raw_supersede_ids):
            raise LearnerGraphRecordValidationError(
                "each learner assertion may supersede an assertion only once per delta"
            )
        requested_supersede_ids = set(explicit_supersede_ids) | set(raw_supersede_ids)
        if len(set(explicit_supersede_ids)) != len(explicit_supersede_ids):
            raise LearnerGraphRecordValidationError(
                "supersede_assertion_ids must contain unique assertion IDs"
            )
        explicit_rows: list[LearnerRelationAssertion] = []
        if requested_supersede_ids:
            explicit_rows = list(
                (
                    await self.session.scalars(
                        select(LearnerRelationAssertion).where(
                            LearnerRelationAssertion.id.in_(requested_supersede_ids),
                            LearnerRelationAssertion.workspace_id == workspace_id,
                            LearnerRelationAssertion.learner_id == learner_id,
                            LearnerRelationAssertion.valid_to.is_(None),
                            LearnerRelationAssertion.superseded_at.is_(None),
                        )
                    )
                ).all()
            )
            if {row.id for row in explicit_rows} != requested_supersede_ids:
                raise LearnerGraphRecordValidationError(
                    "superseded assertions must be active and belong to the learner workspace"
                )

        latest = await self.latest_revision(learner_id, workspace_id=workspace_id)
        if enforce_base_revision:
            latest_id = latest.id if latest is not None else None
            if base_revision_id != latest_id:
                raise LearnerGraphRevisionConflictError(
                    "learner delta base revision "
                    f"{base_revision_id} does not match latest revision {latest_id}"
                )
        sequence_number = (latest.sequence_number if latest is not None else 0) + 1
        revision = LearnerGraphRevision(
            workspace_id=workspace_id,
            learner_id=learner_id,
            session_id=session_id,
            turn_id=turn_id,
            sequence_number=sequence_number,
            parent_revision_id=latest.id if latest is not None else None,
            change_summary=dict(to_plain(change_summary or {})),
        )
        self.session.add(revision)
        await self.session.flush()

        now = utc_now()
        superseded: list[LearnerRelationAssertion] = []
        if keys:
            predicates = {item[0] for item in keys}
            subjects = {item[1] for item in keys}
            objects = {item[2] for item in keys}
            active_rows = list(
                (
                    await self.session.scalars(
                        select(LearnerRelationAssertion).where(
                            LearnerRelationAssertion.workspace_id == workspace_id,
                            LearnerRelationAssertion.learner_id == learner_id,
                            LearnerRelationAssertion.predicate.in_(predicates),
                            LearnerRelationAssertion.subject_id.in_(subjects),
                            LearnerRelationAssertion.object_id.in_(objects),
                            LearnerRelationAssertion.valid_to.is_(None),
                            LearnerRelationAssertion.superseded_at.is_(None),
                        )
                    )
                ).all()
            )
            for previous in active_rows:
                if (previous.predicate, previous.subject_id, previous.object_id) in keys:
                    previous.valid_to = now
                    previous.superseded_at = now
                    superseded.append(previous)

        for previous in explicit_rows:
            previous.valid_to = now
            previous.superseded_at = now
            if previous not in superseded:
                superseded.append(previous)

        added_rows: list[LearnerRelationAssertion] = []
        source_links: list[tuple[LearnerRelationAssertion, list[UUID]]] = []
        previous_by_key: dict[tuple[str, UUID, UUID], LearnerRelationAssertion] = {
            (item.predicate, item.subject_id, item.object_id): item for item in superseded
        }
        for raw in normalized:
            predicate = str(raw["predicate"])
            subject_id = uuid_value(raw["subject_id"])
            object_id = uuid_value(raw["object_id"])
            confidence = float(raw.get("confidence", 0.0))
            if not 0.0 <= confidence <= 1.0:
                raise LearnerGraphRecordValidationError(
                    "learner assertion confidence must be between 0 and 1"
                )
            description = str(raw.get("natural_language_description") or "").strip()
            if not description:
                raise LearnerGraphRecordValidationError("learner assertion description is required")
            assertion_id = optional_uuid(raw.get("id")) or uuid4()
            raw_supersedes_id = optional_uuid(raw.get("supersedes_assertion_id"))
            if raw_supersedes_id == assertion_id:
                raise LearnerGraphRecordValidationError(
                    "a learner assertion cannot supersede itself"
                )
            valid_from = datetime_value(raw.get("valid_from"), default=now) or now
            prior_for_key = previous_by_key.get((predicate, subject_id, object_id))
            row = LearnerRelationAssertion(
                id=assertion_id,
                workspace_id=workspace_id,
                learner_id=learner_id,
                subject_id=subject_id,
                predicate=predicate,
                object_id=object_id,
                natural_language_description=description,
                confidence=confidence,
                valid_from=valid_from,
                source_turn_id=optional_uuid(raw.get("source_turn_id")) or turn_id,
                mastery_evidence_id=optional_uuid(raw.get("mastery_evidence_id")),
                learner_graph_revision_id=revision.id,
                supersedes_assertion_id=(
                    raw_supersedes_id or (prior_for_key.id if prior_for_key is not None else None)
                ),
            )
            self.session.add(row)
            added_rows.append(row)
            raw_source_ids = raw.get("source_span_ids", [])
            if not isinstance(raw_source_ids, list):
                raise LearnerGraphRecordValidationError("source_span_ids must be a list")
            try:
                source_ids = [uuid_value(value) for value in raw_source_ids]
            except (TypeError, ValueError) as exc:
                raise LearnerGraphRecordValidationError(
                    "learner assertion source_span_ids must contain UUIDs"
                ) from exc
            if len(source_ids) != len(set(source_ids)):
                raise LearnerGraphRecordValidationError(
                    "learner assertion source_span_ids must be unique"
                )
            source_links.append((row, source_ids))

        all_source_ids = {source_id for _, source_ids in source_links for source_id in source_ids}
        if all_source_ids:
            valid_source_ids = set(
                (
                    await self.session.scalars(
                        select(SourceSpan.id).where(
                            SourceSpan.workspace_id == workspace_id,
                            SourceSpan.id.in_(all_source_ids),
                        )
                    )
                ).all()
            )
            if valid_source_ids != all_source_ids:
                raise LearnerGraphRecordValidationError(
                    "learner assertion sources must belong to the workspace"
                )
            for row, source_ids in source_links:
                self.session.add_all(
                    [
                        LearnerRelationAssertionSource(
                            assertion_id=row.id,
                            source_span_id=source_id,
                        )
                        for source_id in source_ids
                    ]
                )

        summary_payload = dict(to_plain(change_summary or {}))
        # Counts are derived from persisted rows so callers cannot forge the audit summary.
        summary_payload["assertions_added"] = len(added_rows)
        summary_payload["assertions_superseded"] = len(superseded)
        revision.change_summary = summary_payload
        delta = {
            "revision_id": str(revision.id),
            "sequence_number": sequence_number,
            "assertions_added": [
                {
                    "id": str(row.id),
                    "predicate": row.predicate,
                    "subject_id": str(row.subject_id),
                    "object_id": str(row.object_id),
                }
                for row in added_rows
            ],
            "assertions_superseded": [str(row.id) for row in superseded],
            "change_summary": summary_payload,
            "request_fingerprint": request_fingerprint,
        }
        event = LearnerGraphChangeEvent(
            workspace_id=workspace_id,
            learner_id=learner_id,
            learner_graph_revision_id=revision.id,
            event_type="LEARNER_GRAPH_DELTA",
            idempotency_key=key,
            delta=delta,
        )
        self.session.add(event)
        await self.session.flush()
        return LearnerGraphPersistenceResult(
            revision_id=revision.id,
            sequence_number=sequence_number,
            assertions_added=len(added_rows),
            assertions_superseded=len(superseded),
        )

    # Explicit alias used by service code and downstream integrations.
    create_revision = persist_revision

    async def persist_delta(
        self,
        delta: LearnerGraphDelta,
        *,
        session_id: UUID | None = None,
        turn_id: UUID | None = None,
    ) -> LearnerGraphPersistenceResult:
        """Persist a typed learner delta after resolving its turn boundary."""

        resolved_session_id = session_id or delta.session_id
        resolved_turn_id = turn_id or delta.turn_id
        if resolved_session_id is None or resolved_turn_id is None:
            raise LearnerGraphRecordValidationError(
                "learner graph delta requires session_id and turn_id"
            )
        return await self.persist_revision(
            workspace_id=delta.workspace_id,
            learner_id=delta.learner_id,
            session_id=resolved_session_id,
            turn_id=resolved_turn_id,
            assertions=delta.add_assertions,
            supersede_assertion_ids=delta.supersede_assertion_ids,
            change_summary=delta.change_summary,
            idempotency_key=delta.idempotency_key,
            base_revision_id=delta.base_revision_id,
            enforce_base_revision=True,
        )


def _delta_fingerprint(
    assertions: Sequence[Mapping[str, object] | object],
    supersede_assertion_ids: Sequence[UUID],
    replace_keys: Sequence[tuple[str, UUID, UUID]] | None,
    change_summary: Mapping[str, object] | None,
    base_revision_id: UUID | None,
) -> str:
    payload = {
        "assertions": [as_mapping(item) for item in assertions],
        "supersede_assertion_ids": list(supersede_assertion_ids),
        "replace_keys": list(replace_keys or ()),
        "change_summary": dict(change_summary or {}),
        "base_revision_id": base_revision_id,
    }
    encoded = json.dumps(
        to_plain(payload),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
