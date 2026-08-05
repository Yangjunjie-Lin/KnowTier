from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from cognigraph.domain.enums import EpistemicStatus, NodeType
from cognigraph.graph.applier import GraphNode, GraphSnapshot
from cognigraph.graph.comparison import GraphComparisonService, GraphProposalCanonicalizer
from cognigraph.graph.proposals import (
    GraphComparisonProposal,
    GraphProposalValidationError,
    ModelGraphComparator,
    ProposedMerge,
)
from cognigraph.llm.schemas import ModelCallContext, ModelUsage, StructuredCallResult


def _snapshot(*, node_count: int = 3) -> GraphSnapshot:
    workspace_id = uuid4()
    revision_id = uuid4()
    nodes = [
        GraphNode(
            id=uuid4(),
            workspace_id=workspace_id,
            node_type=NodeType.KNOWLEDGE_POINT,
            properties={"canonical_name": f"concept-{index}", "summary": "bounded" * 20},
            epistemic_status=EpistemicStatus.UNVERIFIED,
            graph_revision_id=revision_id,
        )
        for index in range(node_count)
    ]
    return GraphSnapshot(
        workspace_id=workspace_id,
        revision_id=revision_id,
        nodes=nodes,
    )


class FakeGraphGateway:
    def __init__(self, *, budget: int = 4_000) -> None:
        self.settings = SimpleNamespace(graph_max_nodes=100, context_token_budget=budget)
        self.messages: list[object] = []
        self.contexts: list[object] = []
        self.proposal = GraphComparisonProposal()

    async def generate_structured(self, **kwargs: object) -> tuple[object, object]:
        self.messages.append(kwargs["messages"])
        self.contexts.append(kwargs["context"])
        return self.proposal, StructuredCallResult(
            value={},
            model_run_id=uuid4(),
            provider="fake",
            model="fake-graph",
            usage=ModelUsage(),
            latency_ms=1,
        )


@pytest.mark.unit
async def test_graph_model_is_read_only_and_budgeted() -> None:
    snapshot = _snapshot(node_count=200)
    gateway = FakeGraphGateway(budget=256)
    comparator = ModelGraphComparator(gateway)
    candidate = {"knowledge_points": [{"name": "target", "description": "x" * 2000}]}

    _, call = await comparator.compare(
        workspace_id=snapshot.workspace_id,
        candidate=candidate,
        snapshot=snapshot,
        context=ModelCallContext(
            workspace_id=snapshot.workspace_id,
            graph_revision_id=snapshot.revision_id,
            prompt_name="graph_delta_builder",
        ),
    )

    message = gateway.messages[0]
    assert isinstance(message, list)
    payload = json.loads(str(message[-1].content))
    assert payload["context_budget"]["max_tokens"] == 256
    assert len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) <= 256 * 4 + 1_024
    assert call.context_truncated is True
    assert "GraphComparisonProposal" in str(message[0].content)
    audit_context = gateway.contexts[0]
    assert isinstance(audit_context, ModelCallContext)
    assert audit_context.prompt_name == "graph_delta_builder"
    assert audit_context.prompt_version.startswith("sha256-")
    assert audit_context.context_truncated is True


@pytest.mark.unit
async def test_graph_model_proposal_becomes_review_advice_only() -> None:
    snapshot = _snapshot(node_count=2)
    source, target = snapshot.nodes
    gateway = FakeGraphGateway()
    gateway.proposal = GraphComparisonProposal(
        merge_candidates=[
            ProposedMerge(
                source_node_id=source.id,
                target_node_id=target.id,
                similarity=0.91,
                reason="same canonical concept",
            )
        ]
    )
    service = GraphComparisonService(gateway=gateway, enabled=True)
    result = await service.compare(
        workspace_id=snapshot.workspace_id,
        candidate={},
        snapshot=snapshot,
        context=ModelCallContext(workspace_id=snapshot.workspace_id, prompt_name="graph"),
    )
    assert result.fallback_used is False
    assert result.proposal.merge_candidates[0].requires_review is True


@pytest.mark.unit
def test_graph_proposal_rejects_operation_instructions() -> None:
    snapshot = _snapshot(node_count=2)
    proposal = GraphComparisonProposal(
        merge_candidates=[
            ProposedMerge(
                source_node_id=snapshot.nodes[0].id,
                target_node_id=snapshot.nodes[1].id,
                similarity=0.9,
                reason="run Cypher MATCH and merge this node",
            )
        ]
    )
    with pytest.raises(GraphProposalValidationError):
        GraphProposalCanonicalizer().canonicalize(
            proposal,
            workspace_id=snapshot.workspace_id,
            snapshot=snapshot,
        )
