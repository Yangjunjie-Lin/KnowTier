from __future__ import annotations

import pytest

from cognigraph.domain.enums import NodeType
from cognigraph.graph.delta import GraphDelta, NodeCreate
from cognigraph.persistence.neo4j import InMemoryGraphRepository
from cognigraph.persistence.outbox.dispatcher import OutboxDispatcher
from cognigraph.persistence.postgres.database import Database


class RecordingProjector:
    def __init__(self, *, failures: int = 0) -> None:
        self.failures = failures
        self.payloads: list[dict[str, object]] = []

    async def apply_delta(self, payload: dict[str, object]) -> None:
        self.payloads.append(payload)
        if self.failures:
            self.failures -= 1
            raise RuntimeError("transient projection failure")


@pytest.mark.integration
async def test_outbox_dispatch_is_idempotent_after_publish() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Outbox", slug="outbox")
            result = await uow.graph.persist_delta(GraphDelta(workspace_id=workspace.id))
        projector = RecordingProjector()
        dispatcher = OutboxDispatcher(database.session_factory, projector)
        assert await dispatcher.dispatch_once() == 1
        assert await dispatcher.dispatch_once() == 0
        assert len(projector.payloads) == 1
        async with database.unit_of_work() as uow:
            revision = await uow.graph.get_revision(result.revision_id)
            assert revision is not None
            assert revision.projection_status == "PROJECTED"
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_outbox_schedules_retry_after_projection_failure() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Retry", slug="retry")
            await uow.graph.persist_delta(GraphDelta(workspace_id=workspace.id))
        projector = RecordingProjector(failures=1)
        dispatcher = OutboxDispatcher(database.session_factory, projector)
        assert await dispatcher.dispatch_once() == 0
        assert len(projector.payloads) == 1
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_outbox_projects_sql_revision_to_semantic_graph() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    graph = InMemoryGraphRepository()
    try:
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Projection", slug="projection")
            node = NodeCreate(
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "memoization", "display_name": "Memoization"},
            )
            result = await uow.graph.persist_delta(
                GraphDelta(workspace_id=workspace.id, add_nodes=[node])
            )

        dispatcher = OutboxDispatcher(database.session_factory, graph)
        assert await dispatcher.dispatch_once() == 1
        detail = await graph.get_node_detail(str(workspace.id), str(node.id))
        assert detail is not None
        assert detail["node"]["canonical_name"] == "memoization"
        async with database.unit_of_work() as uow:
            revision = await uow.graph.get_revision(result.revision_id)
            assert revision is not None and revision.status == "APPLIED"
    finally:
        await graph.close()
        await database.dispose()
