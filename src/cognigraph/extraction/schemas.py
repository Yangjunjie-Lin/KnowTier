from __future__ import annotations

from typing import Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from cognigraph.domain.base import DomainModel
from cognigraph.domain.enums import CognitiveLevel, RelationTypeKey


class SixLevelPlanCandidate(DomainModel):
    cognitive_level: CognitiveLevel
    learning_objective: str = Field(min_length=1)
    teaching_strategy: str = Field(min_length=1)
    required_prerequisites: list[str] = Field(default_factory=list)
    must_cover: list[str] = Field(min_length=1)
    example_candidate_ids: list[str] = Field(default_factory=list)
    counterexample_candidate_ids: list[str] = Field(default_factory=list)
    misconception_candidate_ids: list[str] = Field(default_factory=list)
    diagnostic_question: str = Field(min_length=1)
    mastery_criteria: list[str] = Field(min_length=1)
    promotion_requirements: list[str] = Field(min_length=1)
    remediation_policy: str = Field(min_length=1)


class TheoryCandidate(DomainModel):
    candidate_key: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class KnowledgePointCandidate(DomainModel):
    candidate_key: str = Field(min_length=1)
    canonical_name: str = Field(min_length=1)
    plain_definition: str = Field(min_length=1)
    formal_definition: str = Field(min_length=1)
    importance: float = Field(ge=0.0, le=1.0)
    difficulty: float = Field(ge=0.0, le=1.0)
    prerequisites: list[str] = Field(default_factory=list)
    must_cover: list[str] = Field(min_length=1)
    common_confusions: list[str] = Field(default_factory=list)
    applicability: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    source_span_ids: list[UUID] = Field(min_length=1)
    six_level_plan: list[SixLevelPlanCandidate] = Field(min_length=6, max_length=6)
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator("canonical_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split()).casefold()
        if not normalized:
            raise ValueError("canonical_name cannot be blank")
        return normalized

    @model_validator(mode="after")
    def complete_six_level_plan(self) -> Self:
        levels = [stage.cognitive_level for stage in self.six_level_plan]
        if len(levels) != len(set(levels)) or set(levels) != set(CognitiveLevel):
            raise ValueError("six_level_plan must include each cognitive level exactly once")
        if len(self.source_span_ids) != len(set(self.source_span_ids)):
            raise ValueError("source_span_ids must be unique")
        return self


class RelationCandidate(DomainModel):
    subject_candidate_id: str = Field(min_length=1)
    predicate: RelationTypeKey
    object_candidate_id: str = Field(min_length=1)
    natural_language_description: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    temporal: bool = False

    @model_validator(mode="after")
    def endpoints_are_distinct(self) -> Self:
        if self.subject_candidate_id == self.object_candidate_id:
            raise ValueError("relation candidate endpoints must differ")
        return self


class ExampleCandidate(DomainModel):
    candidate_key: str = Field(min_length=1)
    knowledge_point_candidate_id: str = Field(min_length=1)
    content: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)


class CounterexampleCandidate(ExampleCandidate):
    boundary_explained: str = Field(min_length=1)


class MisconceptionCandidate(DomainModel):
    candidate_key: str = Field(min_length=1)
    knowledge_point_candidate_id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    correction: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)


class AssessmentQuestionCandidate(DomainModel):
    candidate_key: str = Field(min_length=1)
    knowledge_point_candidate_id: str = Field(min_length=1)
    cognitive_level: CognitiveLevel
    question: str = Field(min_length=1)
    success_criteria: list[str] = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)


class Ambiguity(DomainModel):
    description: str = Field(min_length=1)
    candidate_keys: list[str] = Field(default_factory=list)
    source_span_ids: list[UUID] = Field(default_factory=list)


class ChatTopicCandidate(DomainModel):
    """Small, schema-validated seed expanded into a full unverified teaching plan."""

    title: str = Field(min_length=1)
    domain: str | None = None
    canonical_name: str = Field(min_length=1)
    plain_definition: str = Field(min_length=1)
    formal_definition: str = Field(min_length=1)
    must_cover: list[str] = Field(min_length=1, max_length=6)
    common_confusions: list[str] = Field(default_factory=list, max_length=6)
    applicability: list[str] = Field(default_factory=list, max_length=6)
    limitations: list[str] = Field(default_factory=list, max_length=6)
    importance: float = Field(ge=0.0, le=1.0)
    difficulty: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="before")
    @classmethod
    def normalize_bounded_provider_compatibility(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        for alias, canonical in (
            ("formal", "formal_definition"),
            ("must_cover_cover", "must_cover"),
        ):
            if alias in normalized:
                normalized.setdefault(canonical, normalized[alias])
                normalized.pop(alias, None)
        # A missing score must never become high-confidence model knowledge.
        normalized.setdefault("importance", 0.5)
        normalized.setdefault("difficulty", 0.5)
        normalized.setdefault("confidence", 0.4)
        for field in (
            "must_cover",
            "common_confusions",
            "applicability",
            "limitations",
        ):
            if field in normalized:
                normalized[field] = _bounded_topic_strings(normalized[field])
        if not normalized.get("must_cover"):
            canonical_name = normalized.get("canonical_name")
            if isinstance(canonical_name, str) and canonical_name.strip():
                normalized["must_cover"] = [canonical_name.strip()]
        return normalized

    @field_validator("canonical_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split()).casefold()
        if not normalized:
            raise ValueError("canonical_name cannot be blank")
        return normalized


class ChatTopicSeed(DomainModel):
    """Minimal provider response for a short learner question."""

    canonical_name: str = Field(min_length=1, max_length=200)
    plain_definition: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="before")
    @classmethod
    def normalize_provider_aliases(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        for alias, canonical in (
            ("topic", "canonical_name"),
            ("name", "canonical_name"),
            ("title", "canonical_name"),
            ("definition", "plain_definition"),
            ("description", "plain_definition"),
        ):
            if alias in normalized and canonical not in normalized:
                normalized[canonical] = normalized[alias]
            normalized.pop(alias, None)
        return normalized

    @field_validator("canonical_name", "plain_definition")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("chat topic seed text cannot be blank")
        return normalized


def _bounded_topic_strings(value: object) -> list[str]:
    items = value if isinstance(value, list) else [value]
    normalized: list[str] = []
    for item in items[:6]:
        candidate: str | None = item if isinstance(item, str) else None
        if isinstance(item, dict):
            candidate = next(
                (nested for nested in item.values() if isinstance(nested, str) and nested.strip()),
                None,
            )
        if candidate is None:
            continue
        text = " ".join(candidate.strip().split())
        if text and text not in normalized:
            normalized.append(text)
    return normalized


class KnowledgeBlueprint(DomainModel):
    title: str = Field(min_length=1)
    domain: str | None = None
    theories: list[TheoryCandidate] = Field(default_factory=list)
    knowledge_points: list[KnowledgePointCandidate] = Field(default_factory=list)
    relations: list[RelationCandidate] = Field(default_factory=list)
    examples: list[ExampleCandidate] = Field(default_factory=list)
    counterexamples: list[CounterexampleCandidate] = Field(default_factory=list)
    misconceptions: list[MisconceptionCandidate] = Field(default_factory=list)
    questions: list[AssessmentQuestionCandidate] = Field(default_factory=list)
    unresolved_ambiguities: list[Ambiguity] = Field(default_factory=list)

    @model_validator(mode="after")
    def local_references_are_valid(self) -> Self:
        keyed = [
            *(item.candidate_key for item in self.theories),
            *(item.candidate_key for item in self.knowledge_points),
            *(item.candidate_key for item in self.examples),
            *(item.candidate_key for item in self.counterexamples),
            *(item.candidate_key for item in self.misconceptions),
            *(item.candidate_key for item in self.questions),
        ]
        if len(keyed) != len(set(keyed)):
            raise ValueError("candidate_key values must be unique across a blueprint")
        known = set(keyed)
        point_keys = {item.candidate_key for item in self.knowledge_points}
        example_keys = {item.candidate_key for item in self.examples}
        counterexample_keys = {item.candidate_key for item in self.counterexamples}
        misconception_keys = {item.candidate_key for item in self.misconceptions}
        for relation in self.relations:
            if relation.subject_candidate_id not in known:
                raise ValueError("relation subject references an unknown candidate")
            if relation.object_candidate_id not in known:
                raise ValueError("relation object references an unknown candidate")
        point_references = (
            [item.knowledge_point_candidate_id for item in self.examples]
            + [item.knowledge_point_candidate_id for item in self.counterexamples]
            + [item.knowledge_point_candidate_id for item in self.misconceptions]
            + [item.knowledge_point_candidate_id for item in self.questions]
        )
        for point_reference in point_references:
            if point_reference not in point_keys:
                raise ValueError("content candidate references an unknown knowledge point")
        for point in self.knowledge_points:
            unknown = set(point.prerequisites).difference(point_keys)
            if unknown:
                raise ValueError("knowledge point prerequisite references an unknown candidate")
            for stage in point.six_level_plan:
                stage_prerequisites = set(stage.required_prerequisites).difference(point_keys)
                if stage_prerequisites:
                    raise ValueError("learning stage prerequisite references an unknown point")
                if not set(stage.example_candidate_ids).issubset(example_keys):
                    raise ValueError("learning stage references an unknown example")
                if not set(stage.counterexample_candidate_ids).issubset(counterexample_keys):
                    raise ValueError("learning stage references an unknown counterexample")
                if not set(stage.misconception_candidate_ids).issubset(misconception_keys):
                    raise ValueError("learning stage references an unknown misconception")
        return self
