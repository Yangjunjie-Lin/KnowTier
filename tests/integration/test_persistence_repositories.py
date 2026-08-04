from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text

from cognigraph.persistence.postgres.database import Database
from cognigraph.persistence.postgres.models import DocumentChunk, SourceSpan


@pytest.mark.integration
async def test_sqlite_connections_enforce_foreign_keys() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    try:
        async with database.session() as session:
            enabled = await session.scalar(text("PRAGMA foreign_keys"))
        assert enabled == 1
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_unit_of_work_persists_workspace_learner_session_and_turn() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Algorithms", slug="algorithms")
            learner = await uow.learners.create(workspace_id=workspace.id, display_name="Lin")
            tutoring_session = await uow.sessions.create(
                workspace_id=workspace.id, learner_id=learner.id
            )
            first = await uow.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=tutoring_session.id,
                role="user",
                content="What is dynamic programming?",
            )
            second = await uow.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=tutoring_session.id,
                role="assistant",
                content="Let us first identify overlapping subproblems.",
            )
            assert (first.sequence_number, second.sequence_number) == (1, 2)

        async with database.unit_of_work() as uow:
            loaded = await uow.workspaces.get_by_slug("algorithms")
            assert loaded is not None
            turns = await uow.turns.recent(tutoring_session.id)
            assert [turn.role for turn in turns] == ["user", "assistant"]
            assert all(len(turn.content_hash) == 64 for turn in turns)
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_unit_of_work_rolls_back_on_exception() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        with pytest.raises(RuntimeError, match="abort"):
            async with database.unit_of_work() as uow:
                await uow.workspaces.create(name="Temporary", slug="temporary")
                raise RuntimeError("abort")
        async with database.unit_of_work() as uow:
            assert await uow.workspaces.get_by_slug("temporary") is None
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_learner_state_is_unique_per_knowledge_point() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        knowledge_point_id = uuid4()
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Tutor", slug="tutor")
            learner = await uow.learners.create(workspace_id=workspace.id, display_name="Student")
            first = await uow.learner_states.get_or_create(
                workspace_id=workspace.id,
                learner_id=learner.id,
                knowledge_point_id=knowledge_point_id,
            )
            second = await uow.learner_states.get_or_create(
                workspace_id=workspace.id,
                learner_id=learner.id,
                knowledge_point_id=knowledge_point_id,
            )
            assert first.id == second.id
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_document_hash_lookup_and_source_spans_preserve_provenance() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        content_hash = "a" * 64
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Sources", slug="sources")
            document = await uow.documents.create(
                workspace_id=workspace.id,
                filename="lesson.txt",
                safe_storage_name="safe.txt",
                storage_path="data/uploads/safe.txt",
                mime_type="text/plain",
                byte_size=12,
                sha256=content_hash,
            )
            chunk = DocumentChunk(
                workspace_id=workspace.id,
                document_id=document.id,
                ordinal=0,
                text="A base case stops recursion.",
                normalized_text="A base case stops recursion.",
                token_count=6,
                content_hash="b" * 64,
            )
            await uow.documents.add_chunks([chunk])
            span = SourceSpan(
                workspace_id=workspace.id,
                document_id=document.id,
                chunk_id=chunk.id,
                page_number=1,
                heading_path=["Recursion"],
                text="A base case stops recursion.",
                normalized_text="A base case stops recursion.",
                start_offset=0,
                end_offset=28,
                content_hash="c" * 64,
                parser_name="text",
                parser_version="1",
            )
            await uow.documents.add_source_spans([span])

        async with database.unit_of_work() as uow:
            duplicate = await uow.documents.get_by_hash(workspace.id, content_hash)
            chunks = await uow.documents.list_chunks(document.id)
            spans = await uow.documents.list_source_spans(document.id)
            assert duplicate is not None and duplicate.id == document.id
            assert [item.ordinal for item in chunks] == [0]
            assert [item.id for item in spans] == [span.id]
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_prompt_versions_are_immutable_and_activation_is_exclusive() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            first = await uow.prompts.register(
                prompt_name="teacher_system", version="1", content="First", activate=True
            )
            second = await uow.prompts.register(
                prompt_name="teacher_system", version="2", content="Second", activate=True
            )
            assert not first.active
            assert second.active
            with pytest.raises(ValueError, match="immutable"):
                await uow.prompts.register(
                    prompt_name="teacher_system", version="2", content="Changed"
                )
        async with database.unit_of_work() as uow:
            active = await uow.prompts.get_active("teacher_system")
            assert active is not None and active.version == "2"
    finally:
        await database.dispose()
