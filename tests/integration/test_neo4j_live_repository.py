from __future__ import annotations

import os
from uuid import uuid4

import pytest

from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.graph.delta import AssertionCreate, GraphDelta, NodeCreate
from cognigraph.persistence.neo4j import Neo4jGraphRepository

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_live_neo4j_projection_when_explicitly_configured() -> None:
    uri = os.getenv("COGNIGRAPH_TEST_NEO4J_URI")
    if not uri:
        pytest.skip("set COGNIGRAPH_TEST_NEO4J_URI to exercise a live Neo4j instance")
    username = os.getenv("COGNIGRAPH_TEST_NEO4J_USER", "neo4j")
    password = os.getenv("COGNIGRAPH_TEST_NEO4J_PASSWORD")
    if not password:
        pytest.skip("set COGNIGRAPH_TEST_NEO4J_PASSWORD for the live Neo4j test")

    workspace_id = uuid4()
    source_id = uuid4()
    subject_id = uuid4()
    object_id = uuid4()
    assertion_id = uuid4()
    revision_id = uuid4()
    delta = GraphDelta(
        workspace_id=workspace_id,
        add_nodes=[
            NodeCreate(
                id=source_id,
                node_type=NodeType.SOURCE_SPAN,
                properties={"text": "Live projection evidence."},
            ),
            NodeCreate(
                id=subject_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": f"subject_{subject_id}"},
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[source_id],
            ),
            NodeCreate(
                id=object_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": f"object_{object_id}"},
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[source_id],
            ),
        ],
        add_assertions=[
            AssertionCreate(
                id=assertion_id,
                subject_id=subject_id,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=object_id,
                natural_language_description="The live subject requires the live object.",
                confidence=1.0,
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[source_id],
            )
        ],
    )

    repository = Neo4jGraphRepository.from_uri(uri, username, password)
    try:
        assert await repository.is_ready()
        await repository.create_schema()
        result = await repository.apply_delta(delta, str(revision_id))
        assert result.assertions_added == 1
        detail = await repository.get_relation_assertion_detail(
            str(workspace_id), str(assertion_id)
        )
        assert detail is not None
        assert detail["sources"][0]["id"] == str(source_id)
    finally:
        await repository.close()
