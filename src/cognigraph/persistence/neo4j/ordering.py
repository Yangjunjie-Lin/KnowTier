"""Deterministic ordering helpers for graph query results."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .errors import GraphPayloadError


def topological_knowledge_points(subgraph: Mapping[str, Any]) -> list[str]:
    """Order prerequisites before the knowledge points that require them."""

    raw_nodes = subgraph.get("nodes", ())
    raw_assertions = subgraph.get("assertions", ())
    if not isinstance(raw_nodes, Sequence) or isinstance(raw_nodes, (str, bytes)):
        raise GraphPayloadError("subgraph nodes must be a list")
    if not isinstance(raw_assertions, Sequence) or isinstance(raw_assertions, (str, bytes)):
        raise GraphPayloadError("subgraph assertions must be a list")
    node_ids = {
        str(node["id"])
        for node in raw_nodes
        if isinstance(node, Mapping) and node.get("id") is not None
    }
    dependencies: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    for assertion in raw_assertions:
        if not isinstance(assertion, Mapping):
            continue
        subject = assertion.get("subject_id")
        object_id = assertion.get("object_id")
        if subject is None or object_id is None:
            continue
        subject_id = str(subject)
        prerequisite_id = str(object_id)
        if subject_id in dependencies and prerequisite_id in dependencies:
            dependencies[subject_id].add(prerequisite_id)

    ordered: list[str] = []
    temporary: set[str] = set()
    permanent: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in permanent:
            return
        if node_id in temporary:
            raise GraphPayloadError("prerequisite graph contains a cycle")
        temporary.add(node_id)
        for dependency in sorted(dependencies[node_id]):
            visit(dependency)
        temporary.remove(node_id)
        permanent.add(node_id)
        ordered.append(node_id)

    for candidate in sorted(dependencies):
        visit(candidate)
    return ordered
