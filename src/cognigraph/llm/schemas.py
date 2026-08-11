from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class TeacherSeed(BaseModel):
    """Compact provider contract expanded into the public teaching response."""

    model_config = ConfigDict(extra="ignore")

    core_explanation: str = Field(min_length=1, max_length=12_000)
    illustration: str = Field(min_length=1, max_length=8_000)
    key_takeaway: str = Field(min_length=1, max_length=4_000)
    assessment_question: str = Field(min_length=1, max_length=4_000)

    @model_validator(mode="before")
    @classmethod
    def normalize_provider_aliases(cls, value: object) -> object:
        """Accept bounded semantic aliases used by OpenAI-compatible models."""

        if not isinstance(value, Mapping):
            return value
        normalized = dict(value)
        aliases = {
            "core_explanation": (
                "explanation",
                "answer",
                "response",
                "teaching_response",
            ),
            "illustration": ("example", "analogy", "contrast", "hint"),
            "key_takeaway": ("takeaway", "summary", "main_point"),
            "assessment_question": (
                "question",
                "mastery_check",
                "check_question",
            ),
        }
        for target, candidates in aliases.items():
            if normalized.get(target):
                continue
            for candidate in candidates:
                replacement = normalized.get(candidate)
                if isinstance(replacement, str) and replacement.strip():
                    normalized[target] = replacement
                    break

        # JSON mode occasionally turns the requested property name into a natural
        # language label. Map only bounded semantic labels, never arbitrary object
        # structure or executable content.
        semantic_keywords = {
            "core_explanation": (
                "explain",
                "answer",
                "response",
                "lesson",
                "definition",
                "main",
                "核心",
                "解释",
                "答案",
            ),
            "illustration": (
                "illustrat",
                "example",
                "analogy",
                "contrast",
                "hint",
                "示例",
                "例子",
                "类比",
            ),
            "key_takeaway": (
                "takeaway",
                "summary",
                "conclusion",
                "key_point",
                "keypoint",
                "要点",
                "总结",
                "结论",
            ),
            "assessment_question": (
                "question",
                "assessment",
                "check",
                "prompt",
                "问题",
                "检测",
            ),
        }
        semantic_values: list[tuple[str, str]] = [
            (str(key).casefold(), item.strip())
            for key, item in normalized.items()
            if isinstance(item, str) and item.strip() and len(item) <= 12_000
        ]
        for target, keywords in semantic_keywords.items():
            if normalized.get(target):
                continue
            for key, item in semantic_values:
                if any(keyword.casefold() in key for keyword in keywords):
                    normalized[target] = item
                    break

        remaining_values = [
            item
            for _key, item in semantic_values
            if item
            not in {
                normalized.get("core_explanation"),
                normalized.get("illustration"),
                normalized.get("key_takeaway"),
                normalized.get("assessment_question"),
            }
        ]
        if not normalized.get("core_explanation") and remaining_values:
            normalized["core_explanation"] = max(remaining_values, key=len)
        if not normalized.get("assessment_question"):
            question_value = next(
                (
                    item
                    for item in remaining_values
                    if item.rstrip().endswith(("?", "!", "\uff1f", "\uff01"))
                ),
                None,
            )
            if question_value is not None:
                normalized["assessment_question"] = question_value

        if not normalized.get("assessment_question"):
            assessment = normalized.get("assessment")
            if isinstance(assessment, str) and assessment.strip():
                normalized["assessment_question"] = assessment
            elif isinstance(assessment, Mapping):
                for candidate in ("question", "prompt", "content"):
                    replacement = assessment.get(candidate)
                    if isinstance(replacement, str) and replacement.strip():
                        normalized["assessment_question"] = replacement
                        break

        core = normalized.get("core_explanation")
        if isinstance(core, str) and core.strip():
            # Some JSON-mode models put the complete lesson in the core field even
            # when asked for separate presentation sections. Reuse only that
            # already-generated text so compatibility never invents new facts.
            if not normalized.get("illustration"):
                normalized["illustration"] = core
            if not normalized.get("key_takeaway"):
                normalized["key_takeaway"] = _last_nonempty_sentence(core)
        return normalized


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


def _last_nonempty_sentence(value: str) -> str:
    normalized = " ".join(value.split()).strip()
    if not normalized:
        return value
    for separator in ("\u3002", "\uff01", "\uff1f", ".", "!", "?"):
        parts = [part.strip() for part in normalized.split(separator) if part.strip()]
        if len(parts) > 1:
            return parts[-1][:4_000]
    return normalized[-4_000:]


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
