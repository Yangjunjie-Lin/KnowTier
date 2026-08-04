from __future__ import annotations

import hashlib
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.persistence.postgres.models import ConversationTurn, TutoringSession


class SessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, tutoring_session: TutoringSession) -> TutoringSession:
        self.session.add(tutoring_session)
        await self.session.flush()
        return tutoring_session

    async def create(
        self,
        *,
        workspace_id: UUID,
        learner_id: UUID,
        requested_mode: str = "learn",
        session_id: UUID | None = None,
        goal: dict[str, Any] | None = None,
    ) -> TutoringSession:
        values: dict[str, Any] = {
            "workspace_id": workspace_id,
            "learner_id": learner_id,
            "requested_mode": requested_mode,
            "goal": goal or {},
        }
        if session_id is not None:
            values["id"] = session_id
        return await self.add(TutoringSession(**values))

    async def get_or_create(
        self,
        *,
        workspace_id: UUID,
        learner_id: UUID,
        session_id: UUID,
        requested_mode: str = "learn",
        goal: dict[str, Any] | None = None,
    ) -> TutoringSession:
        """Create a caller-addressed session idempotently across processes.

        The savepoint confines a losing unique-key race to this insert instead of
        invalidating the surrounding use-case transaction. Under PostgreSQL the
        conflicting insert waits for the winner, then the follow-up SELECT observes it.
        """

        existing = await self.get(session_id)
        if existing is not None:
            return existing
        try:
            async with self.session.begin_nested():
                return await self.create(
                    workspace_id=workspace_id,
                    learner_id=learner_id,
                    requested_mode=requested_mode,
                    session_id=session_id,
                    goal=goal,
                )
        except IntegrityError:
            existing = await self.get(session_id)
            if existing is None:
                raise
            return existing

    async def get(self, session_id: UUID) -> TutoringSession | None:
        return await self.session.get(TutoringSession, session_id)


class TurnRepository:
    _MAX_SEQUENCE_ATTEMPTS = 3

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(
        self,
        *,
        workspace_id: UUID,
        learner_id: UUID,
        session_id: UUID,
        role: str,
        content: str,
        sequence_number: int | None = None,
        **values: Any,
    ) -> ConversationTurn:
        requested_sequence = sequence_number
        attempts = 1 if requested_sequence is not None else self._MAX_SEQUENCE_ATTEMPTS
        for attempt in range(attempts):
            allocated_sequence = requested_sequence
            if allocated_sequence is None:
                allocated_sequence = await self._next_sequence_number(session_id)
            turn = ConversationTurn(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                sequence_number=allocated_sequence,
                role=role,
                content=content,
                content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                **values,
            )
            try:
                async with self.session.begin_nested():
                    self.session.add(turn)
                    await self.session.flush()
                return turn
            except IntegrityError as exc:
                if requested_sequence is not None or not _is_turn_sequence_conflict(exc):
                    raise
                if attempt + 1 == attempts:
                    raise RuntimeError(
                        "could not allocate a unique turn sequence after bounded retries"
                    ) from exc
        raise RuntimeError("turn sequence allocation exhausted unexpectedly")

    async def _next_sequence_number(self, session_id: UUID) -> int:
        # PostgreSQL holds this parent-row lock through the transaction, serializing
        # MAX+1 allocation among API processes. SQLite ignores FOR UPDATE, so the
        # bounded unique-conflict retry remains as a deterministic fallback in tests.
        locked_session_id = await self.session.scalar(
            select(TutoringSession.id).where(TutoringSession.id == session_id).with_for_update()
        )
        if locked_session_id is None:
            raise LookupError(f"session {session_id} does not exist")
        latest = await self.session.scalar(
            select(func.max(ConversationTurn.sequence_number)).where(
                ConversationTurn.session_id == session_id
            )
        )
        return (latest or 0) + 1

    async def get(self, turn_id: UUID) -> ConversationTurn | None:
        return await self.session.get(ConversationTurn, turn_id)

    async def recent(self, session_id: UUID, *, limit: int = 6) -> list[ConversationTurn]:
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        statement = (
            select(ConversationTurn)
            .where(ConversationTurn.session_id == session_id)
            .order_by(ConversationTurn.sequence_number.desc())
            .limit(limit)
        )
        turns = list((await self.session.scalars(statement)).all())
        turns.reverse()
        return turns


def _is_turn_sequence_conflict(error: IntegrityError) -> bool:
    message = str(error.orig).casefold()
    return (
        "turns.session_id, turns.sequence_number" in message
        or "turns_session_id_sequence_number_key" in message
        or "uq_turns_session" in message
    )
