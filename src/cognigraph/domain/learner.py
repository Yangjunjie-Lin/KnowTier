"""Learner profile, mastery state and evidence models."""

from __future__ import annotations

from datetime import datetime
from typing import Self
from uuid import UUID, uuid4

from pydantic import Field, model_validator

from cognigraph.domain.base import DomainModel, JsonObject, utc_now
from cognigraph.domain.enums import CognitiveLevel, EvidenceType, MasteryDecision


class Learner(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    display_name: str = Field(min_length=1, max_length=200)
    preferred_language: str = Field(default="zh-CN", min_length=2)
    metadata: JsonObject = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class LearnerKnowledgeState(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    learner_id: UUID
    knowledge_point_id: UUID
    current_level: CognitiveLevel = CognitiveLevel.INTUITIVE_RECOGNITION
    mastery_score: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    evidence_count: int = Field(default=0, ge=0)
    independent_success_count: int = Field(default=0, ge=0)
    reasoning_success_count: int = Field(default=0, ge=0)
    transfer_success_count: int = Field(default=0, ge=0)
    critical_misconceptions: list[str] = Field(default_factory=list)
    last_interaction_at: datetime | None = None
    next_review_at: datetime | None = None
    version: int = Field(default=1, ge=1)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class MasteryEvidence(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    learner_id: UUID
    knowledge_point_id: UUID
    session_id: UUID
    turn_id: UUID
    evidence_type: EvidenceType
    cognitive_level: CognitiveLevel
    correctness_score: float = Field(ge=0.0, le=1.0)
    reasoning_score: float = Field(ge=0.0, le=1.0)
    independence_score: float = Field(ge=0.0, le=1.0)
    transfer_score: float = Field(ge=0.0, le=1.0)
    grader_confidence: float = Field(ge=0.0, le=1.0)
    observed_misconceptions: list[str] = Field(default_factory=list)
    raw_answer: str = Field(min_length=1)
    grader_explanation: str = Field(min_length=1)
    created_at: datetime = Field(default_factory=utc_now)

    @property
    def is_self_report_only(self) -> bool:
        return self.evidence_type is EvidenceType.SELF_REPORT


class MasteryUpdate(DomainModel):
    decision: MasteryDecision
    reason: str = Field(min_length=1)
    updated_state: LearnerKnowledgeState
    applied_evidence_id: UUID
    promotion_eligible: bool = False
    machine_reason: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def promotion_is_consistent(self) -> Self:
        if self.decision is MasteryDecision.PROMOTE and not self.promotion_eligible:
            raise ValueError("PROMOTE requires promotion_eligible=true")
        return self
