from __future__ import annotations

from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from cognigraph.domain.enums import AssessmentType


class ModelRole(StrEnum):
    TEACHER = "teacher_model"
    EXTRACTOR = "extractor_model"
    GRADER = "grader_model"
    GRAPH = "graph_model"
    VISION = "vision_model"
    EMBEDDING = "embedding_model"


class ChatMessage(BaseModel):
    role: str
    content: str


class ModelUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost: float = 0.0


class ProviderResponse(BaseModel):
    content: str
    provider: str
    model: str
    usage: ModelUsage = Field(default_factory=ModelUsage)


class GraderOutput(BaseModel):
    correctness: float = Field(ge=0.0, le=1.0)
    reasoning: float = Field(ge=0.0, le=1.0)
    independence: float = Field(ge=0.0, le=1.0)
    transfer: float = Field(ge=0.0, le=1.0)
    misconceptions: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    explanation: str


class TeacherAssessment(BaseModel):
    type: AssessmentType
    question: str


class TeacherOutput(BaseModel):
    acknowledgement: str
    core_explanation: str
    illustration: str
    key_takeaway: str
    assessment: TeacherAssessment

    def render(self) -> str:
        return "\n\n".join(
            (
                self.acknowledgement,
                self.core_explanation,
                self.illustration,
                self.key_takeaway,
                self.assessment.question,
            )
        )


class ModelCallContext(BaseModel):
    workspace_id: UUID | None = None
    learner_id: UUID | None = None
    session_id: UUID | None = None
    turn_id: UUID | None = None
    graph_revision_id: UUID | None = None
    prompt_name: str
    prompt_version: str = "1"


class StructuredCallResult(BaseModel):
    value: Any
    model_run_id: UUID
    provider: str
    model: str
    usage: ModelUsage
    latency_ms: int
    repaired: bool = False
