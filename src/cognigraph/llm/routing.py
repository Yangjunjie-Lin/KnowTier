from __future__ import annotations

from dataclasses import dataclass

from cognigraph.config import Settings
from cognigraph.llm.schemas import ModelRole


@dataclass(frozen=True, slots=True)
class ModelRoute:
    primary: str
    fallbacks: tuple[str, ...]

    @property
    def candidates(self) -> tuple[str, ...]:
        return (self.primary, *tuple(item for item in self.fallbacks if item != self.primary))


class ModelRouter:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def route(self, role: ModelRole) -> ModelRoute:
        primary = {
            ModelRole.TEACHER: self._settings.teacher_model,
            ModelRole.EXTRACTOR: self._settings.extractor_model,
            ModelRole.GRADER: self._settings.grader_model,
            ModelRole.GRAPH: self._settings.graph_model,
            ModelRole.VISION: self._settings.vision_model,
            ModelRole.EMBEDDING: self._settings.embedding_model,
        }[role]
        return ModelRoute(primary=primary, fallbacks=self._settings.fallback_models)
