from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import TYPE_CHECKING
from uuid import UUID, uuid5

from cognigraph.domain.enums import NodeType
from cognigraph.extraction.schemas import KnowledgeBlueprint
from cognigraph.graph.applier import GraphSnapshot

_SPACE = re.compile(r"\s+")

if TYPE_CHECKING:
    from cognigraph.extraction.deduplicator import EntityDeduplicator


def canonical_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    return _SPACE.sub(" ", normalized)


@dataclass(frozen=True, slots=True)
class CanonicalizationResult:
    candidate_ids: dict[str, UUID]
    matched_existing: frozenset[str]


class EntityCanonicalizer:
    def __init__(self, *, similarity_threshold: float = 0.92) -> None:
        # Local import avoids a module cycle because the reusable deduplicator uses
        # ``canonical_text`` from this module.
        from cognigraph.extraction.deduplicator import EntityDeduplicator

        self.deduplicator: EntityDeduplicator = EntityDeduplicator(similarity_threshold)

    def canonicalize(
        self,
        *,
        workspace_id: UUID,
        blueprint: KnowledgeBlueprint,
        snapshot: GraphSnapshot,
    ) -> CanonicalizationResult:
        name_index = self._name_index(snapshot)
        ids: dict[str, UUID] = {}
        matched: set[str] = set()
        candidates = [
            *((item.candidate_key, item.name, NodeType.THEORY) for item in blueprint.theories),
            *(
                (item.candidate_key, item.canonical_name, NodeType.KNOWLEDGE_POINT)
                for item in blueprint.knowledge_points
            ),
            *((item.candidate_key, item.content, NodeType.EXAMPLE) for item in blueprint.examples),
            *(
                (item.candidate_key, item.content, NodeType.COUNTEREXAMPLE)
                for item in blueprint.counterexamples
            ),
            *(
                (item.candidate_key, item.statement, NodeType.MISCONCEPTION)
                for item in blueprint.misconceptions
            ),
            *(
                (item.candidate_key, item.question, NodeType.QUESTION)
                for item in blueprint.questions
            ),
        ]
        pending_names: dict[tuple[NodeType, str], UUID] = {}
        for key, name, node_type in candidates:
            normalized = canonical_text(name)
            existing = name_index.get((node_type, normalized))
            if existing is None:
                duplicate = self.deduplicator.find(
                    name,
                    [node for node in snapshot.nodes if node.node_type is node_type],
                )
                existing = duplicate.node_id if duplicate is not None else None
            if existing is not None:
                ids[key] = existing
                matched.add(key)
            else:
                pending = next(
                    (
                        pending_id
                        for (pending_type, pending_name), pending_id in pending_names.items()
                        if pending_type is node_type
                        and SequenceMatcher(a=normalized, b=pending_name).ratio()
                        >= self.deduplicator.threshold
                    ),
                    None,
                )
                candidate_id = pending or uuid5(
                    workspace_id,
                    f"candidate:{node_type.value}:{normalized}",
                )
                ids[key] = candidate_id
                pending_names.setdefault((node_type, normalized), candidate_id)
        return CanonicalizationResult(ids, frozenset(matched))

    @staticmethod
    def _name_index(snapshot: GraphSnapshot) -> dict[tuple[NodeType, str], UUID]:
        result: dict[tuple[NodeType, str], UUID] = {}
        for node in snapshot.nodes:
            if node.node_type not in {
                NodeType.KNOWLEDGE_POINT,
                NodeType.THEORY,
                NodeType.EXAMPLE,
                NodeType.COUNTEREXAMPLE,
                NodeType.MISCONCEPTION,
                NodeType.QUESTION,
            }:
                continue
            names: list[str] = []
            for key in (
                "canonical_name",
                "display_name",
                "name",
                "content",
                "statement",
                "question",
            ):
                value = node.properties.get(key)
                if isinstance(value, str):
                    names.append(value)
            aliases = node.properties.get("aliases")
            if isinstance(aliases, list):
                names.extend(item for item in aliases if isinstance(item, str))
            for name in names:
                result.setdefault((node.node_type, canonical_text(name)), node.id)
        return result
