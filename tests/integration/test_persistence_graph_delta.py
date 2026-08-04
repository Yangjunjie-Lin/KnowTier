from __future__ import annotations

from uuid import uuid4

import pytest

from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.graph.delta import AssertionCreate, GraphDelta, NodeCreate
from cognigraph.persistence.postgres.database import Database
from cognigraph.persistence.postgres.models import SourceSpan
from cognigraph.persistence.repositories.graph import (
    GraphRecordValidationError,
    GraphRevisionConflictError,
)


@pytest.mark.integration
async def test_graph_delta_creates_revision_records_and_outbox_atomically() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Graph", slug="graph")
            first_id = uuid4()
            second_id = uuid4()
            delta = GraphDelta(
                workspace_id=workspace.id,
                add_nodes=[
                    NodeCreate(
                        id=first_id,
                        node_type=NodeType.KNOWLEDGE_POINT,
                        properties={"canonical_name": "recursion", "display_name": "Recursion"},
                        epistemic_status=EpistemicStatus.UNVERIFIED,
                    ),
                    NodeCreate(
                        id=second_id,
                        node_type=NodeType.KNOWLEDGE_POINT,
                        properties={
                            "canonical_name": "base case",
                            "display_name": "Base case",
                        },
                        epistemic_status=EpistemicStatus.UNVERIFIED,
                    ),
                ],
                add_assertions=[
                    AssertionCreate(
                        subject_id=first_id,
                        predicate_key=RelationTypeKey.REQUIRES,
                        object_id=second_id,
                        natural_language_description="Recursion requires a base case.",
                        confidence=0.9,
                    )
                ],
            )
            result = await uow.graph.persist_delta(delta)
            replay = await uow.graph.persist_delta(delta)
            assert result.sequence_number == 1
            assert result.nodes_added == 2
            assert result.assertions_added == 1
            assert replay.revision_id == result.revision_id
            assert replay.idempotent_replay

        async with database.unit_of_work() as uow:
            revisions = await uow.graph.list_revisions(workspace.id)
            assert len(revisions) == 1
            assertion = await uow.graph.get_assertion(workspace.id, delta.add_assertions[0].id)
            assert assertion is not None
            assert assertion.predicate_key == "REQUIRES"
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_graph_delta_rejects_stale_base_revision() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            workspace = await uow.workspaces.create(name="Graph", slug="graph-stale")
            first = await uow.graph.persist_delta(GraphDelta(workspace_id=workspace.id))

        async with database.unit_of_work() as uow:
            with pytest.raises(GraphRevisionConflictError):
                await uow.graph.persist_delta(
                    GraphDelta(workspace_id=workspace.id, base_revision_id=uuid4())
                )
            latest = await uow.graph.latest_revision(workspace.id)
            assert latest is not None and latest.id == first.revision_id
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_graph_delta_rejects_source_span_from_another_workspace() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as uow:
            target = await uow.workspaces.create(name="Target", slug="target")
            source = await uow.workspaces.create(name="Source", slug="source")
            document = await uow.documents.create(
                workspace_id=source.id,
                filename="source.txt",
                safe_storage_name="source.txt",
                storage_path="data/uploads/source.txt",
                mime_type="text/plain",
                byte_size=12,
                sha256="d" * 64,
            )
            span = SourceSpan(
                workspace_id=source.id,
                document_id=document.id,
                text="Foreign workspace evidence.",
                normalized_text="Foreign workspace evidence.",
                start_offset=0,
                end_offset=27,
                content_hash="e" * 64,
                parser_name="text",
                parser_version="1",
            )
            await uow.documents.add_source_spans([span])

        async with database.unit_of_work() as uow:
            with pytest.raises(GraphRecordValidationError, match="does not belong"):
                await uow.graph.persist_delta(
                    GraphDelta(
                        workspace_id=target.id,
                        add_nodes=[
                            NodeCreate(
                                node_type=NodeType.KNOWLEDGE_POINT,
                                properties={"canonical_name": "foreign evidence"},
                                source_span_ids=[span.id],
                            )
                        ],
                    )
                )
    finally:
        await database.dispose()
