from __future__ import annotations

import asyncio
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest

from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.graph.delta import (
    AssertionCreate,
    AssertionSupersede,
    GraphDelta,
    NodeCreate,
    NodePatch,
)
from cognigraph.persistence.neo4j import (
    GraphPayloadError,
    GraphRepository,
    GraphRevisionConflict,
    InMemoryGraphRepository,
)

pytestmark = pytest.mark.integration


@dataclass(frozen=True)
class SeedIds:
    workspace: UUID
    source: UUID
    advanced: UUID
    prerequisite: UUID
    assertion: UUID
    revision: UUID


def _seed_delta(ids: SeedIds) -> GraphDelta:
    return GraphDelta(
        workspace_id=ids.workspace,
        add_nodes=[
            NodeCreate(
                id=ids.source,
                node_type=NodeType.SOURCE_SPAN,
                properties={
                    "document_id": str(uuid4()),
                    "page_number": 4,
                    "text": "A learner needs the prerequisite before the advanced idea.",
                },
            ),
            NodeCreate(
                id=ids.advanced,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "advanced_idea", "display_name": "Advanced idea"},
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[ids.source],
            ),
            NodeCreate(
                id=ids.prerequisite,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={
                    "canonical_name": "prerequisite_idea",
                    "display_name": "Prerequisite idea",
                },
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[ids.source],
            ),
        ],
        add_assertions=[
            AssertionCreate(
                id=ids.assertion,
                subject_id=ids.advanced,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=ids.prerequisite,
                natural_language_description="The advanced idea requires the prerequisite idea.",
                confidence=0.95,
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[ids.source],
            )
        ],
    )


@pytest.fixture
def seed_ids() -> SeedIds:
    return SeedIds(
        workspace=uuid4(),
        source=uuid4(),
        advanced=uuid4(),
        prerequisite=uuid4(),
        assertion=uuid4(),
        revision=uuid4(),
    )


@pytest.mark.asyncio
async def test_projection_is_idempotent_and_queryable(seed_ids: SeedIds) -> None:
    repository: GraphRepository = InMemoryGraphRepository()
    delta = _seed_delta(seed_ids)

    first = await repository.apply_delta(delta, str(seed_ids.revision))
    replay = await repository.apply_delta(delta, str(seed_ids.revision))

    assert first.already_applied is False
    assert first.nodes_added == 3
    assert first.assertions_added == 1
    assert first.provenance_links_added == 3
    assert replay.already_applied is True
    assert replay.to_dict() | {"already_applied": False} == first.to_dict()

    manifest = await repository.get_graph_manifest(str(seed_ids.workspace))
    assert manifest["revision_id"] == str(seed_ids.revision)
    assert manifest["knowledge_point_count"] == 2
    assert manifest["assertion_count"] == 1
    assert manifest["ontology"]["relation_types"] == ["REQUIRES"]
    assert manifest["top_level_domains"] == []
    assert manifest["theories"] == []
    assert manifest["major_clusters"] == []

    search = await repository.search_knowledge_points(str(seed_ids.workspace), "advanced", limit=10)
    assert [node["id"] for node in search["nodes"]] == [str(seed_ids.advanced)]

    chain = await repository.get_prerequisite_chain(
        str(seed_ids.workspace), str(seed_ids.advanced), max_depth=3, limit=10
    )
    assert {node["id"] for node in chain["nodes"]} == {
        str(seed_ids.advanced),
        str(seed_ids.prerequisite),
    }
    assert [assertion["id"] for assertion in chain["assertions"]] == [str(seed_ids.assertion)]

    node_detail = await repository.get_node_detail(str(seed_ids.workspace), str(seed_ids.advanced))
    assert node_detail is not None
    assert node_detail["sources"][0]["id"] == str(seed_ids.source)
    assert node_detail["sources"][0]["source_document"] is None
    assert [item["id"] for item in node_detail["prerequisites"]] == [str(seed_ids.prerequisite)]
    assertion_detail = await repository.get_relation_assertion_detail(
        str(seed_ids.workspace), str(seed_ids.assertion)
    )
    assert assertion_detail is not None
    assert assertion_detail["subject"]["id"] == str(seed_ids.advanced)
    assert assertion_detail["object"]["id"] == str(seed_ids.prerequisite)
    assert assertion_detail["sources"][0]["id"] == str(seed_ids.source)
    assert assertion_detail["conflicts"] == []


@pytest.mark.asyncio
async def test_concurrent_replay_applies_only_once(seed_ids: SeedIds) -> None:
    repository = InMemoryGraphRepository()
    delta = _seed_delta(seed_ids)

    results = await asyncio.gather(
        *(repository.apply_delta(delta, str(seed_ids.revision)) for _ in range(8))
    )

    assert sum(not result.already_applied for result in results) == 1
    assert sum(result.already_applied for result in results) == 7


@pytest.mark.asyncio
async def test_stale_revision_and_atomic_failure_do_not_mutate_projection(
    seed_ids: SeedIds,
) -> None:
    repository = InMemoryGraphRepository()
    await repository.apply_delta(_seed_delta(seed_ids), str(seed_ids.revision))

    stale = GraphDelta(
        workspace_id=seed_ids.workspace,
        base_revision_id=uuid4(),
        update_nodes=[NodePatch(node_id=seed_ids.advanced, set_properties={"summary": "stale"})],
    )
    with pytest.raises(GraphRevisionConflict):
        await repository.apply_delta(stale, str(uuid4()))

    missing_endpoint = uuid4()
    new_node = uuid4()
    invalid = GraphDelta(
        workspace_id=seed_ids.workspace,
        base_revision_id=seed_ids.revision,
        add_nodes=[
            NodeCreate(
                id=new_node,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "should_not_survive"},
            )
        ],
        add_assertions=[
            AssertionCreate(
                subject_id=new_node,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=missing_endpoint,
                natural_language_description="An invalid endpoint.",
                confidence=0.4,
            )
        ],
    )
    with pytest.raises(GraphPayloadError):
        await repository.apply_delta(invalid, str(uuid4()))

    assert await repository.get_node_detail(str(seed_ids.workspace), str(new_node)) is None
    manifest = await repository.get_graph_manifest(str(seed_ids.workspace))
    assert manifest["revision_id"] == str(seed_ids.revision)
    assert manifest["node_count"] == 3


@pytest.mark.asyncio
async def test_patch_and_supersession_preserve_history(seed_ids: SeedIds) -> None:
    repository = InMemoryGraphRepository()
    await repository.apply_delta(_seed_delta(seed_ids), str(seed_ids.revision))
    replacement_id = uuid4()
    second_revision = uuid4()
    replacement = GraphDelta(
        workspace_id=seed_ids.workspace,
        base_revision_id=seed_ids.revision,
        add_assertions=[
            AssertionCreate(
                id=replacement_id,
                subject_id=seed_ids.advanced,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=seed_ids.prerequisite,
                natural_language_description="A better-supported prerequisite assertion.",
                confidence=0.99,
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[seed_ids.source],
            )
        ],
        supersede_assertions=[
            AssertionSupersede(
                assertion_id=seed_ids.assertion,
                replacement_assertion_id=replacement_id,
                reason="Higher-quality evidence became available.",
            )
        ],
    )
    await repository.apply_delta(replacement, str(second_revision))

    old_detail = await repository.get_relation_assertion_detail(
        str(seed_ids.workspace), str(seed_ids.assertion)
    )
    new_detail = await repository.get_relation_assertion_detail(
        str(seed_ids.workspace), str(replacement_id)
    )
    assert old_detail is not None and new_detail is not None
    assert old_detail["assertion"]["superseded_at"] is not None
    assert old_detail["replacements"][0]["id"] == str(replacement_id)
    assert new_detail["superseded_assertions"][0]["id"] == str(seed_ids.assertion)

    third_revision = uuid4()
    patch = GraphDelta(
        workspace_id=seed_ids.workspace,
        base_revision_id=second_revision,
        update_nodes=[
            NodePatch(
                node_id=seed_ids.advanced,
                set_properties={"summary": "Patched through set_properties."},
                source_span_ids=[seed_ids.source],
                expected_revision_id=seed_ids.revision,
            )
        ],
    )
    await repository.apply_delta(patch, str(third_revision))
    node_detail = await repository.get_node_detail(str(seed_ids.workspace), str(seed_ids.advanced))
    assert node_detail is not None
    assert node_detail["node"]["summary"] == "Patched through set_properties."
    assert "set_properties" not in node_detail["node"]


@pytest.mark.asyncio
async def test_controlled_query_bounds_and_lifecycle(seed_ids: SeedIds) -> None:
    repository = InMemoryGraphRepository()
    await repository.apply_delta(_seed_delta(seed_ids), str(seed_ids.revision))

    with pytest.raises(GraphPayloadError):
        await repository.get_focus_subgraph(
            str(seed_ids.workspace), [str(seed_ids.advanced)], max_depth=6
        )
    with pytest.raises(GraphPayloadError):
        await repository.search_knowledge_points(str(seed_ids.workspace), "idea", limit=501)

    assert not hasattr(repository, "execute_cypher")
    assert await repository.is_ready() is True
    await repository.close()
    assert await repository.is_ready() is False
