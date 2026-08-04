"""Revision-keyed global graph manifest generation."""

from __future__ import annotations

from collections import Counter
from uuid import UUID

from cognigraph.domain.enums import NodeType
from cognigraph.domain.graph import GraphCluster, GraphManifest, OntologyManifest
from cognigraph.graph.applier import GraphNode, GraphSnapshot


class GraphManifestService:
    """Build a compact directory and reuse it until the revision changes."""

    def __init__(self) -> None:
        self._cache: dict[tuple[UUID, UUID | None], GraphManifest] = {}

    def build(self, snapshot: GraphSnapshot) -> GraphManifest:
        key = (snapshot.workspace_id, snapshot.revision_id)
        cached = self._cache.get(key)
        if cached is not None:
            return cached.model_copy(deep=True)

        active_assertions = [assertion for assertion in snapshot.assertions if assertion.is_active]
        node_types = sorted({node.node_type.value for node in snapshot.nodes})
        relation_types = sorted(
            {
                *(relation.name.value for relation in snapshot.relation_types),
                *(assertion.predicate_key.value for assertion in active_assertions),
            }
        )
        domains = _property_values(snapshot.nodes, NodeType.DOMAIN, "name")
        theories = _property_values(snapshot.nodes, NodeType.THEORY, "name")
        source_document_ids = {
            node.id for node in snapshot.nodes if node.node_type is NodeType.SOURCE_DOCUMENT
        }
        source_document_ids.update(span.document_id for span in snapshot.source_spans)

        clusters = Counter(
            value
            for node in snapshot.nodes
            if node.node_type is NodeType.KNOWLEDGE_POINT
            for value in [_string_property(node, "domain")]
            if value is not None
        )
        major_clusters = [
            GraphCluster(name=name, node_count=count)
            for name, count in sorted(clusters.items(), key=lambda item: (-item[1], item[0]))[:10]
        ]
        manifest = GraphManifest(
            workspace_id=snapshot.workspace_id,
            revision_id=snapshot.revision_id,
            ontology=OntologyManifest(
                entity_types=node_types,
                relation_types=relation_types,
            ),
            top_level_domains=domains,
            theories=theories,
            knowledge_point_count=sum(
                node.node_type is NodeType.KNOWLEDGE_POINT for node in snapshot.nodes
            ),
            assertion_count=len(active_assertions),
            source_count=len(source_document_ids),
            major_clusters=major_clusters,
        )
        self._cache[key] = manifest.model_copy(deep=True)
        return manifest

    def invalidate_workspace(self, workspace_id: UUID) -> None:
        self._cache = {key: value for key, value in self._cache.items() if key[0] != workspace_id}


def _string_property(node: GraphNode, key: str) -> str | None:
    value = node.properties.get(key)
    return value if isinstance(value, str) and value else None


def _property_values(nodes: list[GraphNode], node_type: NodeType, key: str) -> list[str]:
    return sorted(
        {
            value
            for node in nodes
            if node.node_type is node_type
            for value in [_string_property(node, key)]
            if value is not None
        }
    )
