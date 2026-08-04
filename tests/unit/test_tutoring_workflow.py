from __future__ import annotations

import importlib.util

import pytest

from cognigraph.tutoring.workflow import TutoringWorkflow, WorkflowState


@pytest.mark.asyncio
async def test_workflow_runs_all_nodes_with_checkpointed_langgraph() -> None:
    visited: list[str] = []

    def node(name: str):
        async def run(state: WorkflowState) -> WorkflowState:
            visited.append(name)
            return state

        return run

    workflow = TutoringWorkflow({name: node(name) for name in TutoringWorkflow.node_order})
    result = await workflow.run(
        {"context": {"value": 1}},
        checkpoint_id="session-one",
    )

    assert result["context"] == {"value": 1}
    assert visited == list(TutoringWorkflow.node_order)
    if importlib.util.find_spec("langgraph") is not None:
        assert workflow._compiled is not None


def test_workflow_rejects_missing_node() -> None:
    with pytest.raises(ValueError, match="missing nodes"):
        TutoringWorkflow({})
