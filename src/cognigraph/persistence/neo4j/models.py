"""Stable value objects returned by graph repositories."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol

type GraphRecord = dict[str, Any]


class JsonModel(Protocol):
    """Structural protocol implemented by Pydantic v2 graph models."""

    def model_dump(self, *, mode: Literal["json"] = "json") -> dict[str, Any]: ...


type GraphDeltaInput = Mapping[str, Any] | JsonModel


@dataclass(frozen=True, slots=True)
class GraphApplyResult:
    """Summary of an idempotent graph projection application."""

    workspace_id: str
    revision_id: str
    nodes_added: int = 0
    nodes_updated: int = 0
    assertions_added: int = 0
    assertions_superseded: int = 0
    provenance_links_added: int = 0
    merge_candidates_recorded: int = 0
    conflicts_recorded: int = 0
    already_applied: bool = False

    def to_dict(self) -> GraphRecord:
        return {
            "workspace_id": self.workspace_id,
            "revision_id": self.revision_id,
            "nodes_added": self.nodes_added,
            "nodes_updated": self.nodes_updated,
            "assertions_added": self.assertions_added,
            "assertions_superseded": self.assertions_superseded,
            "provenance_links_added": self.provenance_links_added,
            "merge_candidates_recorded": self.merge_candidates_recorded,
            "conflicts_recorded": self.conflicts_recorded,
            "already_applied": self.already_applied,
        }
