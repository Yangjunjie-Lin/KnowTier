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


class ToolDefinition(BaseModel):
    """A provider-neutral, JSON-schema constrained tool declaration."""

    name: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_]{0,99}$")
    description: str = Field(min_length=1, max_length=2_000)
    parameters: dict[str, object] = Field(default_factory=dict)


class ToolCall(BaseModel):
    """A tool request emitted by a model.

    Providers occasionally return arguments as a JSON string.  The gateway
    normalizes that representation before constructing this model, so domain
    code only handles a dictionary.
    """

    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    arguments: dict[str, object] = Field(default_factory=dict)


class ToolResult(BaseModel):
    """Sanitized result sent back to a model after a controlled graph read."""

    tool_call_id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    content: dict[str, object] = Field(default_factory=dict)


class ChatMessage(BaseModel):
    role: str
    # OpenAI-compatible providers accept a list for multimodal messages.  Text
    # callers continue to use the simple string form.
    content: str | list[dict[str, object]] | None = None
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[ToolCall] | None = None


class ModelUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost: float = 0.0


class ProviderResponse(BaseModel):
    content: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    finish_reason: str | None = None
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
    question_understanding: float = Field(default=0.0, ge=0.0, le=1.0)
    reasoning_error_type: str | None = None
    missing_conditions: list[str] = Field(default_factory=list)
    resolved_misconceptions: list[str] = Field(default_factory=list)
    new_misconceptions: list[str] = Field(default_factory=list)


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
    document_id: UUID | None = None
    graph_revision_id: UUID | None = None
    learner_graph_revision_id: UUID | None = None
    tool_step_count: int = Field(default=0, ge=0)
    # Preserve the bounded-context decision in model-run audit records.
    context_truncated: bool = False
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
    tool_calling_enabled: bool = False
    tool_calling_fallback: bool = False
    tool_steps: int = 0
    tools_used: list[str] = Field(default_factory=list)
    context_truncated: bool = False

    @property
    def tool_usage(self) -> dict[str, object]:
        """Stable API-shaped summary for callers that expose chat metadata."""

        return {
            "enabled": self.tool_calling_enabled and not self.tool_calling_fallback,
            "steps": self.tool_steps,
            "tools": list(self.tools_used),
            "fallback": self.tool_calling_fallback,
        }
