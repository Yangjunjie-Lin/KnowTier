"""Opt-in production-sized budget checks.

These tests intentionally use a synthetic graph so they remain deterministic
and do not require PostgreSQL, Neo4j, or a model provider.  They are skipped in
the normal developer suite; CI/release jobs can enable them explicitly with
``COGNIGRAPH_RUN_PERFORMANCE=1``.
"""

from __future__ import annotations

import os
from uuid import UUID

import pytest

from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.domain.graph import RelationAssertion
from cognigraph.domain.learner import LearnerKnowledgeState
from cognigraph.domain.teaching import SessionGoal, TeachingPolicy
from cognigraph.graph.applier import GraphNode, GraphSnapshot
from cognigraph.graph.context_compiler import (
    ContextCandidates,
    ContextCompilationRequest,
    GraphContextCompiler,
)
from cognigraph.graph.manifest import GraphManifestService
from cognigraph.graph.query_tools import (
    AsyncControlledGraphQueryTools,
    FocusSubgraphParams,
    LearnerStateParams,
)

pytestmark = [
    pytest.mark.performance,
    pytest.mark.skipif(
        os.getenv("COGNIGRAPH_RUN_PERFORMANCE") != "1",
        reason="set COGNIGRAPH_RUN_PERFORMANCE=1 to allocate the production-sized fixture",
    ),
]

WORKSPACE_ID = UUID(int=1)
REVISION_ID = UUID(int=2)
LEARNER_ID = UUID(int=3)
NODE_COUNT = 10_000
ASSERTION_COUNT = 50_000
LEARNER_STATE_COUNT = 1_000


def _large_snapshot() -> GraphSnapshot:
    node_ids = [UUID(int=100 + index) for index in range(NODE_COUNT)]
    nodes = [
        GraphNode(
            id=node_id,
            workspace_id=WORKSPACE_ID,
            node_type=NodeType.KNOWLEDGE_POINT,
            properties={
                "canonical_name": f"knowledge-point-{index:05d}",
                "display_name": f"Knowledge point {index:05d}",
                "summary": "Synthetic production-size performance fixture.",
                "domain": f"domain-{index % 20:02d}",
            },
            epistemic_status=EpistemicStatus.UNVERIFIED,
            graph_revision_id=REVISION_ID,
        )
        for index, node_id in enumerate(node_ids)
    ]
    assertions = [
        RelationAssertion(
            id=UUID(int=1_000_000 + index),
            workspace_id=WORKSPACE_ID,
            subject_id=node_ids[index % NODE_COUNT],
            predicate_key=RelationTypeKey.REQUIRES,
            object_id=node_ids[(index * 17 + 1) % NODE_COUNT],
            natural_language_description="Synthetic prerequisite assertion.",
            confidence=0.8,
            created_by="performance-fixture",
            graph_revision_id=REVISION_ID,
        )
        for index in range(ASSERTION_COUNT)
    ]
    return GraphSnapshot(
        workspace_id=WORKSPACE_ID,
        revision_id=REVISION_ID,
        revision_sequence=1,
        nodes=nodes,
        assertions=assertions,
    )


def test_manifest_cache_and_context_budget_handle_production_size() -> None:
    snapshot = _large_snapshot()
    service = GraphManifestService()

    first = service.build(snapshot)
    second = service.build(snapshot)

    assert first.knowledge_point_count == NODE_COUNT
    assert first.assertion_count == ASSERTION_COUNT
    assert second == first
    assert second is not first

    # A large directory must be bounded before it enters a teacher prompt.
    oversized = first.model_copy(
        update={
            "theories": [f"theory-{index:05d}" for index in range(NODE_COUNT)],
            "top_level_domains": [f"domain-{index:05d}" for index in range(NODE_COUNT)],
        }
    )
    bundle = GraphContextCompiler().compile(
        ContextCompilationRequest(
            workspace_id=WORKSPACE_ID,
            learner_id=LEARNER_ID,
            session_id=UUID(int=4),
            user_message="Teach one bounded concept.",
            token_budget=600,
        ),
        oversized,
        ContextCandidates(),
        session_goal=SessionGoal(),
        teaching_policy=TeachingPolicy(),
    )
    assert bundle.truncated is True
    assert bundle.estimated_tokens <= 600
    assert len(bundle.global_manifest.theories) < NODE_COUNT


class _BoundedProvider:
    """A provider spy proving query limits are passed through as one batch."""

    def __init__(self) -> None:
        self.focus_calls: list[tuple[int, int]] = []
        self.learner_calls: list[int] = []

    async def get_focus_subgraph(
        self,
        workspace_id: str,
        node_ids: list[str],
        *,
        max_depth: int,
        max_nodes: int,
    ) -> dict[str, object]:
        self.focus_calls.append((max_depth, max_nodes))
        return {
            "workspace_id": workspace_id,
            "revision_id": str(REVISION_ID),
            "nodes": [{"id": str(UUID(int=100 + index))} for index in range(min(max_nodes, 50))],
            "assertions": [],
            "total_nodes_available": NODE_COUNT,
            "total_assertions_available": ASSERTION_COUNT,
        }

    async def get_learner_state(
        self,
        workspace_id: str,
        learner_id: str,
        *,
        knowledge_point_ids: list[str],
        limit: int,
    ) -> dict[str, object]:
        self.learner_calls.append(limit)
        return {
            "workspace_id": workspace_id,
            "revision_id": str(REVISION_ID),
            "items": [
                {
                    "learner_id": learner_id,
                    "knowledge_point_id": str(UUID(int=10_000 + index)),
                    "mastery_score": index / LEARNER_STATE_COUNT,
                }
                for index in range(min(limit, LEARNER_STATE_COUNT))
            ],
        }


@pytest.mark.asyncio
async def test_focus_and_learner_queries_remain_bounded_and_batched() -> None:
    provider = _BoundedProvider()
    tools = AsyncControlledGraphQueryTools(provider)

    focus = await tools.get_focus_subgraph(
        FocusSubgraphParams(
            workspace_id=WORKSPACE_ID,
            node_id=UUID(int=100),
            max_depth=3,
            max_nodes=50,
        )
    )
    learner = await tools.get_learner_state(
        LearnerStateParams(
            workspace_id=WORKSPACE_ID,
            learner_id=LEARNER_ID,
            # The public tool intentionally caps one response at 100; the
            # separate index test below covers a 1,000-state learner model.
            limit=100,
        )
    )

    assert len(focus.data["nodes"]) == 50
    assert provider.focus_calls == [(3, 50)]
    assert len(learner.data["items"]) == 100
    assert provider.learner_calls == [100]


def test_learner_state_index_has_expected_production_cardinality() -> None:
    states = [
        LearnerKnowledgeState(
            learner_id=LEARNER_ID,
            knowledge_point_id=UUID(int=10_000 + index),
            mastery_score=index / LEARNER_STATE_COUNT,
        )
        for index in range(LEARNER_STATE_COUNT)
    ]
    indexed = {state.knowledge_point_id: state for state in states}
    assert len(indexed) == LEARNER_STATE_COUNT
    assert indexed[UUID(int=10_000)].mastery_score == 0.0
