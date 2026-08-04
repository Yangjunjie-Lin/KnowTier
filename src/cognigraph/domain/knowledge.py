"""Knowledge point and six-stage learning plan models."""

from __future__ import annotations

from datetime import datetime
from typing import Self
from uuid import UUID, uuid4

from pydantic import Field, field_validator, model_validator

from cognigraph.domain.base import DomainModel, utc_now
from cognigraph.domain.enums import CognitiveLevel, EpistemicStatus


class LearningStage(DomainModel):
    """Teaching contract for one knowledge point at one cognitive level."""

    id: UUID = Field(default_factory=uuid4)
    knowledge_point_id: UUID
    cognitive_level: CognitiveLevel
    learning_objective: str = Field(min_length=1)
    teaching_strategy: str = Field(min_length=1)
    required_prerequisites: list[UUID] = Field(default_factory=list)
    must_cover_items: list[str] = Field(min_length=1)
    example_ids: list[UUID] = Field(default_factory=list)
    counterexample_ids: list[UUID] = Field(default_factory=list)
    misconception_ids: list[UUID] = Field(default_factory=list)
    diagnostic_question_ids: list[UUID] = Field(min_length=1)
    mastery_criteria: list[str] = Field(min_length=1)
    promotion_requirements: list[str] = Field(min_length=1)
    remediation_policy: str = Field(min_length=1)

    @model_validator(mode="after")
    def unique_references(self) -> Self:
        reference_fields = (
            self.required_prerequisites,
            self.example_ids,
            self.counterexample_ids,
            self.misconception_ids,
            self.diagnostic_question_ids,
        )
        if any(len(values) != len(set(values)) for values in reference_fields):
            raise ValueError("learning-stage references must be unique within each field")
        if self.knowledge_point_id in self.required_prerequisites:
            raise ValueError("a knowledge point cannot require itself")
        return self


class KnowledgePoint(DomainModel):
    """An atomic, teachable concept with a complete six-level plan."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    canonical_name: str = Field(min_length=1, max_length=240)
    display_name: str = Field(min_length=1, max_length=240)
    aliases: list[str] = Field(default_factory=list)
    summary: str = Field(min_length=1)
    formal_definition: str = Field(min_length=1)
    plain_language_definition: str = Field(min_length=1)
    importance: float = Field(ge=0.0, le=1.0)
    difficulty: float = Field(ge=0.0, le=1.0)
    scope: str = Field(min_length=1)
    language: str = Field(default="zh-CN", min_length=2)
    epistemic_status: EpistemicStatus = EpistemicStatus.UNVERIFIED
    source_confidence: float = Field(ge=0.0, le=1.0)
    source_span_ids: list[UUID] = Field(default_factory=list)
    prerequisite_ids: list[UUID] = Field(default_factory=list)
    similar_knowledge_point_ids: list[UUID] = Field(default_factory=list)
    common_confusions: list[str] = Field(default_factory=list)
    learning_stages: list[LearningStage] = Field(min_length=6, max_length=6)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    graph_revision_id: UUID | None = None

    @field_validator("canonical_name")
    @classmethod
    def stable_canonical_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("canonical_name cannot be blank")
        return normalized.casefold()

    @field_validator("aliases")
    @classmethod
    def normalized_aliases(cls, values: list[str]) -> list[str]:
        normalized = [" ".join(value.strip().split()) for value in values if value.strip()]
        return list(dict.fromkeys(normalized))

    @model_validator(mode="after")
    def coherent_plan_and_sources(self) -> Self:
        expected = set(CognitiveLevel)
        levels = [stage.cognitive_level for stage in self.learning_stages]
        if len(levels) != len(set(levels)) or set(levels) != expected:
            raise ValueError("learning_stages must contain every cognitive level exactly once")
        if any(stage.knowledge_point_id != self.id for stage in self.learning_stages):
            raise ValueError("every learning stage must reference its knowledge point")
        if self.id in self.prerequisite_ids:
            raise ValueError("a knowledge point cannot be its own prerequisite")
        if len(self.prerequisite_ids) != len(set(self.prerequisite_ids)):
            raise ValueError("prerequisite_ids must be unique")
        if self.epistemic_status is EpistemicStatus.CONFIRMED and not self.source_span_ids:
            raise ValueError("confirmed knowledge requires at least one source span")
        return self


class LearningStagePlan(DomainModel):
    """Model-generated stage plan before candidate IDs become graph UUIDs."""

    cognitive_level: CognitiveLevel
    learning_objective: str = Field(min_length=1)
    teaching_strategy: str = Field(min_length=1)
    required_prerequisites: list[str] = Field(default_factory=list)
    must_cover_items: list[str] = Field(min_length=1)
    example_candidate_ids: list[str] = Field(default_factory=list)
    counterexample_candidate_ids: list[str] = Field(default_factory=list)
    misconception_candidate_ids: list[str] = Field(default_factory=list)
    diagnostic_questions: list[str] = Field(min_length=1)
    mastery_criteria: list[str] = Field(min_length=1)
    promotion_requirements: list[str] = Field(min_length=1)
    remediation_policy: str = Field(min_length=1)


class TheoryCandidate(DomainModel):
    candidate_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class KnowledgePointCandidate(DomainModel):
    candidate_id: str = Field(min_length=1)
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
    six_level_plan: list[LearningStagePlan] = Field(min_length=6, max_length=6)
    confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def six_unique_levels(self) -> Self:
        levels = [stage.cognitive_level for stage in self.six_level_plan]
        if set(levels) != set(CognitiveLevel) or len(levels) != len(set(levels)):
            raise ValueError("six_level_plan must contain every cognitive level exactly once")
        if self.candidate_id in self.prerequisites:
            raise ValueError("a candidate cannot require itself")
        return self


class RelationCandidate(DomainModel):
    subject_candidate_id: str = Field(min_length=1)
    predicate: str = Field(min_length=1)
    object_candidate_id: str = Field(min_length=1)
    natural_language_description: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    temporal: bool = False

    @model_validator(mode="after")
    def endpoints_differ(self) -> Self:
        if self.subject_candidate_id == self.object_candidate_id:
            raise ValueError("candidate relation endpoints must differ")
        return self


class ExampleCandidate(DomainModel):
    candidate_id: str = Field(min_length=1)
    knowledge_point_candidate_id: str = Field(min_length=1)
    content: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)


class CounterexampleCandidate(ExampleCandidate):
    boundary_explanation: str = Field(min_length=1)


class MisconceptionCandidate(DomainModel):
    candidate_id: str = Field(min_length=1)
    knowledge_point_candidate_id: str = Field(min_length=1)
    misconception: str = Field(min_length=1)
    correction: str = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)


class AssessmentQuestionCandidate(DomainModel):
    candidate_id: str = Field(min_length=1)
    knowledge_point_candidate_id: str = Field(min_length=1)
    cognitive_level: CognitiveLevel
    question: str = Field(min_length=1)
    expected_elements: list[str] = Field(min_length=1)
    source_span_ids: list[UUID] = Field(min_length=1)


class Ambiguity(DomainModel):
    description: str = Field(min_length=1)
    candidate_ids: list[str] = Field(default_factory=list)
    source_span_ids: list[UUID] = Field(default_factory=list)
    suggested_resolution: str | None = None


class KnowledgeBlueprint(DomainModel):
    title: str = Field(min_length=1)
    domain: str | None = None
    theories: list[TheoryCandidate] = Field(default_factory=list)
    knowledge_points: list[KnowledgePointCandidate]
    relations: list[RelationCandidate] = Field(default_factory=list)
    examples: list[ExampleCandidate] = Field(default_factory=list)
    counterexamples: list[CounterexampleCandidate] = Field(default_factory=list)
    misconceptions: list[MisconceptionCandidate] = Field(default_factory=list)
    questions: list[AssessmentQuestionCandidate] = Field(default_factory=list)
    unresolved_ambiguities: list[Ambiguity] = Field(default_factory=list)

    @model_validator(mode="after")
    def candidate_references_are_valid(self) -> Self:
        collections = (
            self.theories,
            self.knowledge_points,
            self.examples,
            self.counterexamples,
            self.misconceptions,
            self.questions,
        )
        all_ids = [item.candidate_id for items in collections for item in items]
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("candidate_id values must be unique throughout a blueprint")
        knowledge_ids = {item.candidate_id for item in self.knowledge_points}
        for relation in self.relations:
            if relation.subject_candidate_id not in set(all_ids):
                raise ValueError("relation subject_candidate_id is unknown")
            if relation.object_candidate_id not in set(all_ids):
                raise ValueError("relation object_candidate_id is unknown")
        referenced_knowledge_ids = {
            *(item.knowledge_point_candidate_id for item in self.examples),
            *(item.knowledge_point_candidate_id for item in self.counterexamples),
            *(item.knowledge_point_candidate_id for item in self.misconceptions),
            *(item.knowledge_point_candidate_id for item in self.questions),
        }
        if not referenced_knowledge_ids.issubset(knowledge_ids):
            raise ValueError("content candidate references an unknown knowledge point")
        return self
