from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cognigraph.persistence.postgres.models import GraphRevision, OutboxMessage


class GraphProjector(Protocol):
    async def apply_delta(self, payload: dict[str, object]) -> object: ...


class OutboxRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def claim(
        self,
        *,
        batch_size: int = 20,
        lock_timeout: timedelta = timedelta(minutes=5),
    ) -> list[OutboxMessage]:
        if not 1 <= batch_size <= 500:
            raise ValueError("batch_size must be between 1 and 500")
        now = datetime.now(UTC)
        stale = now - lock_timeout
        statement = (
            select(OutboxMessage)
            .where(
                OutboxMessage.available_at <= now,
                or_(
                    OutboxMessage.status == "PENDING",
                    ((OutboxMessage.status == "PROCESSING") & (OutboxMessage.locked_at < stale)),
                ),
            )
            .order_by(OutboxMessage.created_at)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        messages = list((await self.session.scalars(statement)).all())
        for message in messages:
            message.status = "PROCESSING"
            message.locked_at = now
            message.attempt_count += 1
        await self.session.flush()
        return messages

    async def mark_published(self, message_id: UUID) -> None:
        message = await self._require(message_id)
        now = datetime.now(UTC)
        message.status = "PUBLISHED"
        message.published_at = now
        message.locked_at = None
        message.last_error = None
        if message.event_type == "GRAPH_DELTA_COMMITTED":
            revision = await self.session.get(GraphRevision, message.aggregate_id)
            if revision is not None:
                revision.status = "APPLIED"
                revision.projection_status = "PROJECTED"
                revision.projected_at = now

    async def mark_failed(
        self,
        message_id: UUID,
        error: BaseException,
        *,
        max_attempts: int = 8,
    ) -> None:
        message = await self._require(message_id)
        message.last_error = f"{type(error).__name__}: {error}"[:1000]
        message.locked_at = None
        if message.attempt_count >= max_attempts:
            message.status = "FAILED"
            if message.event_type == "GRAPH_DELTA_COMMITTED":
                revision = await self.session.get(GraphRevision, message.aggregate_id)
                if revision is not None:
                    revision.status = "FAILED"
                    revision.projection_status = "FAILED"
            return
        delay_seconds = min(2 ** max(message.attempt_count - 1, 0), 300)
        message.status = "PENDING"
        message.available_at = datetime.now(UTC) + timedelta(seconds=delay_seconds)

    async def _require(self, message_id: UUID) -> OutboxMessage:
        message = await self.session.get(OutboxMessage, message_id)
        if message is None:
            raise LookupError(f"outbox message {message_id} does not exist")
        return message


class OutboxDispatcher:
    """Project committed graph deltas and make retries observable and bounded."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        projector: GraphProjector,
        *,
        max_attempts: int = 8,
    ) -> None:
        self.session_factory = session_factory
        self.projector = projector
        self.max_attempts = max_attempts

    async def dispatch_once(self, *, batch_size: int = 20) -> int:
        async with self.session_factory.begin() as session:
            claimed = await OutboxRepository(session).claim(batch_size=batch_size)
            claimed_ids = [message.id for message in claimed]

        published = 0
        for message_id in claimed_ids:
            async with self.session_factory() as read_session:
                message = await read_session.get(OutboxMessage, message_id)
                if message is None or message.status != "PROCESSING":
                    continue
                payload = dict(message.payload)
            try:
                await self.projector.apply_delta(payload)
            except Exception as error:
                async with self.session_factory.begin() as failure_session:
                    await OutboxRepository(failure_session).mark_failed(
                        message_id, error, max_attempts=self.max_attempts
                    )
            else:
                async with self.session_factory.begin() as success_session:
                    await OutboxRepository(success_session).mark_published(message_id)
                published += 1
        return published
