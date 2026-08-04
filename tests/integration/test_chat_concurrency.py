from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from cognigraph.api.schemas import ChatRequest
from cognigraph.config import Settings
from cognigraph.persistence.postgres.database import Database
from cognigraph.persistence.postgres.models import (
    ConversationTurn,
    LearnerKnowledgeState,
    MasteryEvidence,
)
from cognigraph.services.chat import ChatService
from cognigraph.services.runtime import ApplicationRuntime


@pytest.mark.integration
async def test_repository_races_recover_session_and_turn_allocation(tmp_path: Path) -> None:
    database = Database(f"sqlite+aiosqlite:///{(tmp_path / 'repository-races.db').as_posix()}")
    await database.create_schema()
    try:
        async with database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(
                name="Repository Race Workspace",
                slug=f"repository-race-{uuid4().hex[:8]}",
            )
            learner = await unit.learners.create(
                workspace_id=workspace.id,
                display_name="Repository Race Learner",
            )
            await unit.commit()
        session_id = uuid4()

        async def create_session() -> UUID:
            async with database.unit_of_work() as unit:
                tutoring_session = await unit.sessions.get_or_create(
                    workspace_id=workspace.id,
                    learner_id=learner.id,
                    session_id=session_id,
                )
                await unit.commit()
                return tutoring_session.id

        created_ids = await asyncio.gather(create_session(), create_session())
        assert len(created_ids) == 2
        assert set(created_ids) == {session_id}

        async def add_turn(content: str) -> int:
            async with database.unit_of_work() as unit:
                turn = await unit.turns.add(
                    workspace_id=workspace.id,
                    learner_id=learner.id,
                    session_id=session_id,
                    role="user",
                    content=content,
                )
                await unit.commit()
                return turn.sequence_number

        sequences = await asyncio.gather(add_turn("first"), add_turn("second"))
        assert sorted(sequences) == [1, 2]
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_concurrent_chat_requests_share_one_consistent_session(tmp_path: Path) -> None:
    runtime = ApplicationRuntime(
        Settings(
            database_url=f"sqlite+aiosqlite:///{(tmp_path / 'concurrent-chat.db').as_posix()}",
            storage_path=tmp_path / "uploads",
            use_mock_llm=True,
            neo4j_required=False,
        )
    )
    await runtime.startup()
    try:
        workspace_id = uuid4()
        learner_id = uuid4()
        session_id = uuid4()
        async with runtime.database.unit_of_work() as unit:
            await unit.workspaces.create(
                workspace_id=workspace_id,
                name="Concurrent Chat Workspace",
                slug=f"concurrent-{workspace_id.hex[:8]}",
            )
            await unit.learners.create(
                workspace_id=workspace_id,
                learner_id=learner_id,
                display_name="Concurrent Learner",
            )
            await unit.commit()

        initial_service = ChatService(runtime)
        await initial_service.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="Teach me concurrency prerequisite knowledge.",
            )
        )

        first_service = ChatService(runtime)
        second_service = ChatService(runtime)
        responses = await asyncio.gather(
            first_service.chat(
                ChatRequest(
                    workspace_id=workspace_id,
                    learner_id=learner_id,
                    session_id=session_id,
                    message="It is knowledge needed before the dependent idea.",
                )
            ),
            second_service.chat(
                ChatRequest(
                    workspace_id=workspace_id,
                    learner_id=learner_id,
                    session_id=session_id,
                    message="The later idea relies on it, so it must be learned first.",
                )
            ),
        )

        assert {item.learner_update.decision for item in responses} == {
            "PROMOTE",
            "REQUEST_MORE_EVIDENCE",
        }
        async with runtime.database.session() as session:
            turns = list(
                (
                    await session.scalars(
                        select(ConversationTurn)
                        .where(ConversationTurn.session_id == session_id)
                        .order_by(ConversationTurn.sequence_number)
                    )
                ).all()
            )
            learner_state = await session.scalar(
                select(LearnerKnowledgeState).where(LearnerKnowledgeState.learner_id == learner_id)
            )
            evidence_count = len(
                (
                    await session.scalars(
                        select(MasteryEvidence.id).where(MasteryEvidence.learner_id == learner_id)
                    )
                ).all()
            )

        assert [turn.sequence_number for turn in turns] == list(range(1, 7))
        assert [turn.role for turn in turns] == [
            "user",
            "assistant",
            "user",
            "assistant",
            "user",
            "assistant",
        ]
        assert learner_state is not None
        assert learner_state.current_level == 2
        assert learner_state.evidence_count == 2
        assert evidence_count == 2
        assert initial_service._session_locks.active_session_count == 0
    finally:
        await runtime.shutdown()
