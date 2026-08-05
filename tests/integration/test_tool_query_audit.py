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
    LearningPathParams,
    NodeDetailParams,
    ToolCallRecord,
    WorkspaceParams,
)
from cognigraph.llm.schemas import ModelCallContext, ToolCall
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
async def test_learning_path_joins_sql_learner_state_at_same_revision() -> None:
    workspace_id = uuid4()
    learner_id = uuid4()
    target_id = uuid4()
    revision_id = uuid4()

    class PathProvider:
        async def get_learning_path(self, *args: object, **kwargs: object) -> dict[str, object]:
            return {
                "workspace_id": str(workspace_id),
                "revision_id": str(revision_id),
                "knowledge_point_ids": [str(target_id)],
            }

    async def load_state(params: LearnerStateParams) -> dict[str, object]:
        assert params.learner_id == learner_id
        return {
            "workspace_id": str(workspace_id),
            "revision_id": str(revision_id),
            "learner_graph_revision_id": str(uuid4()),
            "items": [{"knowledge_point_id": str(target_id), "mastery_score": 0.4}],
        }

    tools = AsyncControlledGraphQueryTools(  # type: ignore[arg-type]
        PathProvider(),
        learner_state_loader=load_state,
    )
    result = await tools.get_learning_path(
        LearningPathParams(
            workspace_id=workspace_id,
            learner_id=learner_id,
            target_knowledge_point_id=target_id,
        )
    )

    assert result.graph_revision_id == revision_id
    assert result.data["learner_states"] == [
        {"knowledge_point_id": str(target_id), "mastery_score": 0.4}
    ]


@pytest.mark.integration
async def test_direct_query_facade_rejects_context_workspace_mismatch() -> None:
    runtime = ApplicationRuntime(
        Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            use_mock_llm=True,
            neo4j_required=False,
            outbox_worker_enabled=False,
        )
    )
    await runtime.startup()
    try:
        with pytest.raises(ValueError, match="workspace"):
            await runtime.semantic_queries.execute_tool(
                ToolCall(
                    id="context-check",
                    name="get_graph_manifest",
                    arguments={"workspace_id": str(uuid4())},
                ),
                context=ModelCallContext(workspace_id=uuid4(), prompt_name="teacher"),
            )
    finally:
        await runtime.shutdown()


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
            knowledge_point_id = uuid4()
            state = await unit.learner_states.get_or_create(
                workspace_id=workspace.id,
                learner_id=learner.id,
                knowledge_point_id=knowledge_point_id,
            )
            state.current_level = 2
            state.mastery_score = 0.63
            state.confidence = 0.81
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
        assert learner_state.data["items"] == [
            {
                "id": str(state.id),
                "knowledge_point_id": str(knowledge_point_id),
                "current_level": 2,
                "mastery_score": 0.63,
                "confidence": 0.81,
                "evidence_count": 0,
                "independent_success_count": 0,
                "reasoning_success_count": 0,
                "transfer_success_count": 0,
                "critical_misconceptions": [],
                "last_interaction_at": None,
                "next_review_at": None,
                "version": 1,
            }
        ]
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
