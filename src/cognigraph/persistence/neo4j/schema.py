"""Neo4j schema statements.

All labels, relationship types, and property names in this module are constants.
Business data is always supplied through Cypher parameters.
"""

from __future__ import annotations

CONSTRAINT_QUERIES: tuple[str, ...] = (
    """
    CREATE CONSTRAINT graph_node_identity IF NOT EXISTS
    FOR (node:GraphNode)
    REQUIRE (node.workspace_id, node.id) IS UNIQUE
    """,
    """
    CREATE CONSTRAINT relation_assertion_identity IF NOT EXISTS
    FOR (assertion:RelationAssertion)
    REQUIRE (assertion.workspace_id, assertion.id) IS UNIQUE
    """,
    """
    CREATE CONSTRAINT relation_type_identity IF NOT EXISTS
    FOR (relation_type:RelationType)
    REQUIRE (relation_type.workspace_id, relation_type.name) IS UNIQUE
    """,
    """
    CREATE CONSTRAINT graph_apply_identity IF NOT EXISTS
    FOR (graph_apply:GraphApply)
    REQUIRE (graph_apply.workspace_id, graph_apply.revision_id) IS UNIQUE
    """,
    """
    CREATE CONSTRAINT graph_revision_projection_identity IF NOT EXISTS
    FOR (revision:GraphRevisionProjection)
    REQUIRE (revision.workspace_id, revision.id) IS UNIQUE
    """,
    """
    CREATE CONSTRAINT workspace_graph_state_identity IF NOT EXISTS
    FOR (state:WorkspaceGraphState)
    REQUIRE state.workspace_id IS UNIQUE
    """,
    """
    CREATE CONSTRAINT merge_candidate_identity IF NOT EXISTS
    FOR (candidate:MergeCandidate)
    REQUIRE (candidate.workspace_id, candidate.id) IS UNIQUE
    """,
    """
    CREATE CONSTRAINT conflict_set_identity IF NOT EXISTS
    FOR (conflict:ConflictSet)
    REQUIRE (conflict.workspace_id, conflict.id) IS UNIQUE
    """,
)

INDEX_QUERIES: tuple[str, ...] = (
    """
    CREATE INDEX graph_node_type IF NOT EXISTS
    FOR (node:GraphNode)
    ON (node.workspace_id, node.entity_type)
    """,
    """
    CREATE INDEX graph_node_canonical_name IF NOT EXISTS
    FOR (node:GraphNode)
    ON (node.workspace_id, node.canonical_name)
    """,
    """
    CREATE INDEX relation_assertion_predicate IF NOT EXISTS
    FOR (assertion:RelationAssertion)
    ON (assertion.workspace_id, assertion.predicate_key)
    """,
    """
    CREATE INDEX source_span_document IF NOT EXISTS
    FOR (node:GraphNode)
    ON (node.workspace_id, node.document_id)
    """,
)

SCHEMA_QUERIES: tuple[str, ...] = CONSTRAINT_QUERIES + INDEX_QUERIES
