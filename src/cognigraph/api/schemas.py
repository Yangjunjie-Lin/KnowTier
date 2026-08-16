from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cognigraph.domain.enums import CognitiveLevel, RequestedMode


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9][a-z0-9-]*$")
    default_language: str = "zh-CN"


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    default_language: str
    created_at: datetime


class WorkspaceListResponse(BaseModel):
    items: list[WorkspaceResponse]
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    next_offset: int | None = Field(default=None, ge=0)


class LearnerCreateRequest(BaseModel):
    workspace_id: UUID
    display_name: str = Field(min_length=1, max_length=200)
    external_id: str | None = None
    language: str = "zh-CN"
    preferences: dict[str, object] = Field(default_factory=dict)


class LearnerResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    display_name: str
    language: str
    created_at: datetime


class LearnerListResponse(BaseModel):
    workspace_id: UUID
    items: list[LearnerResponse]
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    next_offset: int | None = Field(default=None, ge=0)


class DocumentResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    filename: str
    mime_type: str
    byte_size: int
    sha256: str
    status: str
    page_count: int | None = None
    warnings: list[str] = Field(default_factory=list)
    created_at: datetime


class DocumentListResponse(BaseModel):
    workspace_id: UUID
    items: list[DocumentResponse]
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    next_offset: int | None = Field(default=None, ge=0)


class IngestionResponse(BaseModel):
    document_id: UUID
    parser: str
    page_count: int
    chunk_count: int
    knowledge_point_count: int
    assertion_count: int
    warning_count: int
    graph_revision_id: UUID | None
    parser_chain: list[str] = Field(default_factory=list)
    ocr_used: bool = False
    vision_used: bool = False
    detected_language: str | None = None
    low_confidence_blocks: int = 0


class ChatRequest(BaseModel):
    workspace_id: UUID
    learner_id: UUID
    session_id: UUID
    client_request_id: UUID | None = None
    message: str = Field(min_length=1, max_length=20_000)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=20)
    requested_mode: RequestedMode = RequestedMode.LEARN


class TargetKnowledgePointResponse(BaseModel):
    id: UUID
    name: str


class AssessmentResponse(BaseModel):
    type: str
    question: str


class LearnerUpdateResponse(BaseModel):
    decision: str
    reason: str
    current_level: CognitiveLevel
    mastery_score: float
    confidence: float


class GraphUpdateResponse(BaseModel):
    revision_id: UUID | None
    nodes_added: int = 0
    assertions_added: int = 0
    assertions_superseded: int = 0


class ToolUsageResponse(BaseModel):
    enabled: bool
    steps: int = Field(ge=0)
    tools: list[str] = Field(default_factory=list)
    fallback: bool = False


class LearnerGraphUpdateResponse(BaseModel):
    """Summary of the learner graph revision created by a tutoring turn."""

    revision_id: UUID
    assertions_added: int = 0
    assertions_superseded: int = 0


class ChatResponse(BaseModel):
    turn_id: UUID
    response: str
    target_knowledge_point: TargetKnowledgePointResponse
    cognitive_level: CognitiveLevel
    teaching_action: str
    assessment: AssessmentResponse
    learner_update: LearnerUpdateResponse
    graph_update: GraphUpdateResponse
    learner_graph_update: LearnerGraphUpdateResponse | None = None
    tool_usage: ToolUsageResponse | None = None
    model_fallback: bool = False
    sources: list[dict[str, object]] = Field(default_factory=list)


class ConversationUserTurnResponse(BaseModel):
    id: UUID
    role: Literal["user"] = "user"
    content: str
    attachment_ids: list[UUID] = Field(default_factory=list)
    created_at: datetime


class ConversationAssistantTurnResponse(BaseModel):
    id: UUID
    role: Literal["assistant"] = "assistant"
    response: ChatResponse
    created_at: datetime


ConversationHistoryItemResponse = Annotated[
    ConversationUserTurnResponse | ConversationAssistantTurnResponse,
    Field(discriminator="role"),
]


class ConversationHistoryResponse(BaseModel):
    workspace_id: UUID
    learner_id: UUID
    session_id: UUID
    turn_limit: int = Field(ge=1, le=200)
    truncated: bool = False
    items: list[ConversationHistoryItemResponse] = Field(default_factory=list)


class GraphExportResponse(BaseModel):
    format: str
    revision_id: UUID | None
    data: object
