from __future__ import annotations

from uuid import uuid4

import pytest

from cognigraph.persistence.neo4j import GraphPayloadError, InMemoryGraphRepository
from cognigraph.persistence.neo4j.payload import neo4j_properties, normalize_delta
from cognigraph.persistence.neo4j.schema import SCHEMA_QUERIES

pytestmark = pytest.mark.integration


def test_generic_payload_requires_traceability_for_confirmed_facts() -> None:
    workspace_id = str(uuid4())
    with pytest.raises(GraphPayloadError, match="CONFIRMED"):
        normalize_delta(
            {
                "workspace_id": workspace_id,
                "add_nodes": [
                    {
                        "id": str(uuid4()),
                        "node_type": "KnowledgePoint",
                        "properties": {"canonical_name": "unsupported"},
                        "epistemic_status": "CONFIRMED",
                    }
                ],
            }
        )


def test_nested_properties_are_losslessly_encoded_for_neo4j() -> None:
    properties = neo4j_properties(
        {
            "name": "knowledge",
            "aliases": ["a", "b"],
            "metadata": {"language": "zh", "quality": {"score": 0.8}},
        }
    )
    assert properties["name"] == "knowledge"
    assert properties["aliases"] == ["a", "b"]
    assert properties["metadata"] == '{"language":"zh","quality":{"score":0.8}}'


@pytest.mark.asyncio
async def test_mapping_payload_cannot_patch_hard_delete_fields() -> None:
    workspace_id = str(uuid4())
    node_id = str(uuid4())
    repository = InMemoryGraphRepository()
    first_revision = str(uuid4())
    await repository.apply_delta(
        {
            "workspace_id": workspace_id,
            "add_nodes": [
                {
                    "id": node_id,
                    "node_type": "KnowledgePoint",
                    "properties": {"canonical_name": "durable"},
                }
            ],
        },
        first_revision,
    )
    with pytest.raises(GraphPayloadError, match="cannot express deletion"):
        await repository.apply_delta(
            {
                "workspace_id": workspace_id,
                "base_revision_id": first_revision,
                "update_nodes": [{"node_id": node_id, "set_properties": {"hard_delete": True}}],
            },
            str(uuid4()),
        )


def test_schema_statements_are_fixed_and_idempotent() -> None:
    assert SCHEMA_QUERIES
    assert all("IF NOT EXISTS" in statement for statement in SCHEMA_QUERIES)
    assert all("$" not in statement for statement in SCHEMA_QUERIES)
    assert all("{workspace_id}" not in statement for statement in SCHEMA_QUERIES)
