"""Typed contracts for deterministic, learner-specific study planning."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field

from cognigraph.domain.base import DomainModel
from cognigraph.domain.enums import CognitiveLevel, RequestedMode


class LearningPriority(StrEnum):
    """Stable reason codes used to explain why a topic is recommended."""

    CORRECT_MISCONCEPTION = "correct_misconception"
    REVIEW_DUE = "review_due"
    UNLOCK_PREREQUISITE = "unlock_prerequisite"
    REMEDIATE_FOUNDATION = "remediate_foundation"
    CONTINUE_PRACTICE = "continue_practice"
    START_TOPIC = "start_topic"
    DEEPEN_MASTERY = "deepen_mastery"


class LearningPhase(StrEnum):
    """Phases of a short evidence-producing study session."""

    ACTIVATE = "activate"
    BUILD = "build"
    CHECK = "check"


class LearningPlanTopic(DomainModel):
    """Planner input assembled from confirmed graph structure and learner state."""

    knowledge_point_id: UUID
    knowledge_point: str = Field(min_length=1, max_length=500)
    current_level: CognitiveLevel | None = None
    mastery_score: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    evidence_count: int = Field(default=0, ge=0)
    misconception_count: int = Field(default=0, ge=0)
    next_review_at: datetime | None = None
    prerequisite_ids: list[UUID] = Field(default_factory=list)
    source_order: int = Field(default=0, ge=0)


class LearningPlanRecommendation(DomainModel):
    """One actionable topic recommendation with machine-readable rationale."""

    knowledge_point_id: UUID
    knowledge_point: str
    priority: LearningPriority
    requested_mode: RequestedMode
    current_level: CognitiveLevel | None = None
    target_level: CognitiveLevel
    mastery_score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_count: int = Field(ge=0)
    misconception_count: int = Field(ge=0)
    due_at: datetime | None = None
    unlocks_topic_count: int = Field(default=0, ge=0)


class LearningPlanStep(DomainModel):
    """A time-boxed session phase; copy is localized by the client."""

    phase: LearningPhase
    minutes: int = Field(ge=1, le=30)
    strategy: str = Field(min_length=1, max_length=100)
    requested_mode: RequestedMode


class LearningPlanSummary(DomainModel):
    due_review_count: int = Field(default=0, ge=0)
    active_misconception_count: int = Field(default=0, ge=0)
    ready_topic_count: int = Field(default=0, ge=0)
    blocked_topic_count: int = Field(default=0, ge=0)


class LearningPlan(DomainModel):
    """Deterministic next action and a compact retrieve-build-check agenda."""

    goal_knowledge_point_id: UUID | None = None
    focus: LearningPlanRecommendation | None = None
    alternatives: list[LearningPlanRecommendation] = Field(default_factory=list, max_length=2)
    steps: list[LearningPlanStep] = Field(default_factory=list, max_length=3)
    total_minutes: int = Field(default=0, ge=0, le=90)
    summary: LearningPlanSummary = Field(default_factory=LearningPlanSummary)
    source: str = "deterministic_learner_state"
