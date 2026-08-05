"""Application service for learner graph revision writes."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from uuid import UUID

from cognigraph.persistence.postgres.database import SqlAlchemyUnitOfWork
from cognigraph.persistence.repositories.learner_graph import LearnerGraphPersistenceResult


class LearnerGraphService:
    """Keep learner graph writes inside the caller's tutoring transaction.

    The service intentionally delegates only to the constrained repository.  It
    has no graph-query or model-output escape hatch and therefore cannot mutate
    the authoritative domain graph.
    """

    async def record_turn(
        self,
        unit: SqlAlchemyUnitOfWork,
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
    ) -> LearnerGraphPersistenceResult:
        """Append a learner revision without opening a second transaction."""

        return await unit.learner_graph.persist_revision(
            workspace_id=workspace_id,
            learner_id=learner_id,
            session_id=session_id,
            turn_id=turn_id,
            assertions=assertions,
            supersede_assertion_ids=supersede_assertion_ids,
            replace_keys=replace_keys,
            change_summary=change_summary,
            idempotency_key=idempotency_key,
        )
