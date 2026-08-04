from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest

from cognigraph.config import Settings
from cognigraph.graph.delta import GraphDelta
from cognigraph.graph.query_tools import (
    AsyncControlledGraphQueryTools,
    BufferedToolAuditSink,
    LearnerStateParams,
    NodeDetailParams,
    ToolCallRecord,
    WorkspaceParams,
)
from cognigraph.services.runtime import ApplicationRuntime


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'tool-audit.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
        outbox_worker_enabled=False,
    )


def test_buffered_tool_audit_sink_is_thread_safe() -> None:
    sink = BufferedToolAuditSink()
    workspace_id = uuid4()

    def record(index: int) -> None:
        sink.record(
            ToolCallRecord(
                tool_name="get_graph_manifest",
                workspace_id=workspace_id,
                parameters={"index": index},
                graph_revision_id=None,
            )
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(record, range(200)))

    first = sink.drain(limit=75)
    second = sink.drain(limit=200)
    assert len(first) == 75
    assert len(second) == 125
    assert len({item.id for item in [*first, *second]}) == 200
    assert sink.pending_count == 0


@pytest.mark.integration
async def test_semantic_query_audits_persist_and_are_queryable_after_restart(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    first_runtime = ApplicationRuntime(settings)
    await first_runtime.startup()
    try:
        assert isinstance(first_runtime.semantic_queries, AsyncControlledGraphQueryTools)
        async with first_runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(
                name="Tool audit",
                slug=f"tool-audit-{uuid4().hex[:8]}",
            )
            learner = await unit.learners.create(
                workspace_id=workspace.id,
                display_name="Audited learner",
            )
            persisted = await unit.graph.persist_delta(GraphDelta(workspace_id=workspace.id))
            await unit.commit()
        await first_runtime.outbox_dispatcher.dispatch_once()

        manifest = await first_runtime.semantic_queries.get_graph_manifest(
            WorkspaceParams(workspace_id=workspace.id)
        )
        assert manifest.graph_revision_id == persisted.revision_id
        learner_state = await first_runtime.semantic_queries.get_learner_state(
            LearnerStateParams(workspace_id=workspace.id, learner_id=learner.id)
        )
        assert learner_state.graph_revision_id == persisted.revision_id
        with pytest.raises(KeyError):
            await first_runtime.semantic_queries.get_node_detail(
                NodeDetailParams(workspace_id=workspace.id, node_id=uuid4())
            )
    finally:
        await first_runtime.shutdown()

    second_runtime = ApplicationRuntime(settings)
    await second_runtime.startup()
    try:
        async with second_runtime.database.unit_of_work() as unit:
            records = await unit.audit.list_tool_calls(workspace.id)

        by_tool = {record.tool_name: record for record in records}
        assert set(by_tool) == {
            "get_graph_manifest",
            "get_learner_state",
            "get_node_detail",
        }
        manifest_record = by_tool["get_graph_manifest"]
        assert manifest_record.arguments == {"workspace_id": str(workspace.id)}
        assert manifest_record.result_count == 1
        assert manifest_record.graph_revision_id == persisted.revision_id
        assert manifest_record.status == "SUCCEEDED"
        learner_record = by_tool["get_learner_state"]
        assert learner_record.learner_id == learner.id
        assert learner_record.arguments["learner_id"] == str(learner.id)
        assert learner_record.graph_revision_id == persisted.revision_id
        assert by_tool["get_node_detail"].status == "FAILED"
        assert all(record.latency_ms >= 0 for record in records)
    finally:
        await second_runtime.shutdown()
