from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from uuid import UUID

from cognigraph.extraction.canonicalizer import canonical_text
from cognigraph.graph.applier import GraphNode


@dataclass(frozen=True, slots=True)
class DuplicateMatch:
    node_id: UUID
    similarity: float
    reason: str


class EntityDeduplicator:
    def __init__(self, threshold: float = 0.92) -> None:
        if not 0 < threshold <= 1:
            raise ValueError("threshold must be in (0, 1]")
        self.threshold = threshold

    def find(self, name: str, nodes: list[GraphNode]) -> DuplicateMatch | None:
        target = canonical_text(name)
        best: DuplicateMatch | None = None
        for node in nodes:
            candidate = next(
                (
                    value
                    for key in (
                        "canonical_name",
                        "display_name",
                        "name",
                        "content",
                        "statement",
                        "question",
                    )
                    if isinstance((value := node.properties.get(key)), str) and value
                ),
                None,
            )
            if not isinstance(candidate, str):
                continue
            normalized = canonical_text(candidate)
            similarity = SequenceMatcher(a=target, b=normalized).ratio()
            if similarity >= self.threshold and (best is None or similarity > best.similarity):
                reason = (
                    "canonical names are identical"
                    if similarity == 1
                    else "canonical names are highly similar"
                )
                best = DuplicateMatch(node.id, similarity, reason)
        return best
