"""Typed contracts for teaching decisions and compiled model context."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from cognigraph.domain.base import DomainModel, JsonObject
from cognigraph.domain.enums import (
    AssessmentType,
    CognitiveLevel,
    HintLevel,
    RequestedMode,
    TeachingAction,
)
from cognigraph.domain.graph import GraphManifest


class Assessment(DomainModel):
    type: AssessmentType
    question: str = Field(min_length=1)
    target_knowledge_point_id: UUID
    target_level: CognitiveLevel
    success_criteria: list[str] = Field(min_length=1)


class TeachingDirective(DomainModel):
    teaching_action: TeachingAction
    target_knowledge_point_id: UUID
    target_level: CognitiveLevel
    response_constraints: list[str] = Field(default_factory=list)
    assessment_type: AssessmentType
    hint_level: HintLevel = HintLevel.LEVEL_1_DIRECTION
    promotion_eligibility: bool = False


class SessionGoal(DomainModel):
    knowledge_point_id: UUID | None = None
    desired_level: CognitiveLevel | None = None
    requested_mode: RequestedMode = RequestedMode.LEARN
    description: str = ""


class TeachingPolicy(DomainModel):
    one_primary_goal_per_turn: bool = True
    maximum_questions: int = Field(default=1, ge=1, le=1)
    default_hint_level: HintLevel = HintLevel.LEVEL_1_DIRECTION
    allowed_next_actions: list[TeachingAction] = Field(default_factory=list)


class ContextNode(DomainModel):
    id: UUID
    node_type: str
    name: str
    summary: str = ""
    properties: JsonObject = Field(default_factory=dict)
    relevance: float = Field(default=0.0, ge=0.0, le=1.0)


class ContextAssertion(DomainModel):
    id: UUID
    subject_id: UUID
    predicate: str
    object_id: UUID
    description: str
    confidence: float = Field(ge=0.0, le=1.0)
    source_span_ids: list[UUID] = Field(default_factory=list)


class SourceEvidence(DomainModel):
    source_span_id: UUID
    document_id: UUID
    page_number: int | None = Field(default=None, ge=1)
    heading_path: list[str] = Field(default_factory=list)
    excerpt: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class LearnerMasterySummary(DomainModel):
    knowledge_point_id: UUID
    current_level: CognitiveLevel
    mastery_score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    unresolved_misconceptions: list[str] = Field(default_factory=list)


class RecentTurn(DomainModel):
    turn_id: UUID
    role: str
    content: str
    created_at: datetime


class ContextBundle(DomainModel):
    """Bounded context supplied to a model; never the complete conversation/graph."""

    graph_revision: UUID | None
    global_manifest: GraphManifest
    focus_nodes: list[ContextNode] = Field(default_factory=list)
    focus_assertions: list[ContextAssertion] = Field(default_factory=list)
    prerequisite_chain: list[ContextNode] = Field(default_factory=list)
    learner_mastery: list[LearnerMasterySummary] = Field(default_factory=list)
    relevant_misconceptions: list[str] = Field(default_factory=list)
    supporting_sources: list[SourceEvidence] = Field(default_factory=list)
    current_teaching_stage: JsonObject = Field(default_factory=dict)
    session_goal: SessionGoal
    teaching_policy: TeachingPolicy
    allowed_next_actions: list[TeachingAction] = Field(default_factory=list)
    recent_turn_window: list[RecentTurn] = Field(default_factory=list)
    estimated_tokens: int = Field(ge=0)
    truncated: bool = False
