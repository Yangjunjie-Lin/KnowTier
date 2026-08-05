"""Learner profile, mastery state and evidence models."""

from __future__ import annotations

from datetime import datetime
from typing import Self
from uuid import UUID, uuid4

from pydantic import Field, model_validator

from cognigraph.domain.base import DomainModel, JsonObject, utc_now
from cognigraph.domain.enums import (
    CognitiveLevel,
    EvidenceType,
    LearnerRelationType,
    MasteryDecision,
)


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


class LearnerGraphRevision(DomainModel):
    """An immutable, auditable snapshot of one learner's graph changes."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    learner_id: UUID
    session_id: UUID
    turn_id: UUID
    sequence_number: int = Field(ge=1)
    parent_revision_id: UUID | None = None
    change_summary: JsonObject = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

    @property
    def sequence(self) -> int:
        """Compatibility alias matching the domain GraphRevision contract."""

        return self.sequence_number


class LearnerGraphChangeEvent(DomainModel):
    """The durable change payload associated with a learner graph revision."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    learner_id: UUID
    learner_graph_revision_id: UUID
    event_type: str = Field(default="LEARNER_GRAPH_DELTA", min_length=1, max_length=100)
    idempotency_key: str = Field(min_length=1, max_length=300)
    delta: JsonObject = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

    @property
    def revision_id(self) -> UUID:
        return self.learner_graph_revision_id


class LearnerGraphDelta(DomainModel):
    """Deterministic learner-state change before it is committed as a revision."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    learner_id: UUID
    session_id: UUID | None = None
    turn_id: UUID | None = None
    base_revision_id: UUID | None = None
    # Draft mappings intentionally retain UUID values until the persistence
    # boundary normalizes them into JSON and constrained columns.
    add_assertions: list[dict[str, object]] = Field(default_factory=list)
    supersede_assertion_ids: list[UUID] = Field(default_factory=list)
    change_summary: JsonObject = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=300)

    @property
    def is_empty(self) -> bool:
        return not self.add_assertions and not self.supersede_assertion_ids


class LearnerRelationAssertion(DomainModel):
    """A first-class, temporal edge in a learner-specific graph.

    ``subject_id`` and ``object_id`` intentionally remain polymorphic UUIDs:
    a learner relation may point to a knowledge point, an evidence record, or
    another learner-graph resource.  The predicate is application-owned and
    cannot redefine the authoritative domain ontology.
    """

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    learner_id: UUID
    subject_id: UUID
    predicate: LearnerRelationType
    object_id: UUID
    natural_language_description: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    valid_from: datetime = Field(default_factory=utc_now)
    valid_to: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    superseded_at: datetime | None = None
    source_turn_id: UUID | None = None
    mastery_evidence_id: UUID | None = None
    learner_graph_revision_id: UUID
    supersedes_assertion_id: UUID | None = None

    @property
    def is_active(self) -> bool:
        return self.valid_to is None and self.superseded_at is None

    @property
    def relation_type(self) -> LearnerRelationType:
        """Readable alias used by graph export clients."""

        return self.predicate

    @model_validator(mode="after")
    def valid_lifetime(self) -> Self:
        if self.subject_id == self.object_id:
            raise ValueError("learner relation subject and object must differ")
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("valid_to cannot precede valid_from")
        if self.superseded_at is not None and self.superseded_at < self.valid_from:
            raise ValueError("superseded_at cannot precede valid_from")
        if self.supersedes_assertion_id == self.id:
            raise ValueError("a learner assertion cannot supersede itself")
        return self
