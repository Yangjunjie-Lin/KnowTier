from __future__ import annotations

import os
from uuid import uuid4

import pytest
from sqlalchemy import text

from cognigraph.domain.enums import NodeType
from cognigraph.graph.delta import GraphDelta, NodeCreate
from cognigraph.persistence.neo4j import InMemoryGraphRepository
from cognigraph.persistence.outbox import OutboxDispatcher
from cognigraph.persistence.postgres.database import Database
from cognigraph.persistence.postgres.models import OutboxMessage

pytestmark = [pytest.mark.integration, pytest.mark.postgres]


def _configured_postgres_url() -> str:
    """Return the explicitly requested production database URL.

    The opt-in flag is intentionally separate from URL detection: a typo in a
    CI configuration must fail loudly instead of silently exercising SQLite.
    """

    if os.getenv("COGNIGRAPH_RUN_POSTGRES_TESTS") != "1":
        pytest.skip("set COGNIGRAPH_RUN_POSTGRES_TESTS=1 to exercise live PostgreSQL")
    url = os.getenv("COGNIGRAPH_DATABASE_URL", "")
    if not url.startswith(("postgresql://", "postgresql+asyncpg://", "postgres://")):
        pytest.fail("COGNIGRAPH_DATABASE_URL must point to PostgreSQL for this test")
    return url


@pytest.mark.asyncio
async def test_postgresql_pgvector_extension_and_embedding_column() -> None:
    database = Database(_configured_postgres_url())
    try:
        async with database.session() as session:
            extension_version = await session.scalar(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            )
            assert isinstance(extension_version, str) and extension_version

            column_type = await session.scalar(
                text(
                    "SELECT udt_name FROM information_schema.columns "
                    "WHERE table_schema = current_schema() "
                    "AND table_name = 'document_chunks' AND column_name = 'embedding'"
                )
            )
            assert column_type == "vector"

            distance = await session.scalar(text("SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector"))
            assert float(distance or 0.0) == pytest.approx(1.0)
    finally:
        await database.dispose()


@pytest.mark.asyncio
async def test_postgresql_transaction_rolls_back_and_outbox_projects() -> None:
    database = Database(_configured_postgres_url())
    graph = InMemoryGraphRepository()
    slug = f"pg-boundary-{uuid4().hex}"
    try:
        with pytest.raises(RuntimeError, match="rollback-check"):
            async with database.unit_of_work() as unit:
                await unit.workspaces.create(name="Rollback check", slug=slug)
                raise RuntimeError("rollback-check")

        async with database.unit_of_work() as unit:
            assert await unit.workspaces.get_by_slug(slug) is None
            workspace = await unit.workspaces.create(name="Outbox check", slug=f"{slug}-outbox")
            node = NodeCreate(
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": f"pg-node-{uuid4().hex}"},
            )
            persisted = await unit.graph.persist_delta(
                GraphDelta(workspace_id=workspace.id, add_nodes=[node])
            )

        async with database.session() as session:
            outbox = await session.get(OutboxMessage, persisted.outbox_message_id)
            assert outbox is not None
            assert outbox.status == "PENDING"
            assert outbox.workspace_id == workspace.id

        dispatcher = OutboxDispatcher(database.session_factory, graph)
        assert await dispatcher.dispatch_once(batch_size=10) == 1
        detail = await graph.get_node_detail(str(workspace.id), str(node.id))
        assert detail is not None

        async with database.session() as session:
            outbox = await session.get(OutboxMessage, persisted.outbox_message_id)
            assert outbox is not None
            assert outbox.status == "PUBLISHED"
    finally:
        await graph.close()
        await database.dispose()
