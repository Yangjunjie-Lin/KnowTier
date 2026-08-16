from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.api.schemas import ChatRequest, ChatResponse, ConversationHistoryResponse
from cognigraph.services.chat import ChatService
from cognigraph.services.conversation_history import ConversationHistoryService

router = APIRouter(tags=["tutoring"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> ChatResponse:
    enforce_workspace_scope(workspace_scope, request.workspace_id)
    return await ChatService(runtime).chat(request)


@router.get(
    "/workspaces/{workspace_id}/learners/{learner_id}/sessions/{session_id}/turns",
    response_model=ConversationHistoryResponse,
)
async def conversation_history(
    workspace_id: UUID,
    learner_id: UUID,
    session_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> ConversationHistoryResponse:
    enforce_workspace_scope(workspace_scope, workspace_id)
    return await ConversationHistoryService(runtime).get(
        workspace_id=workspace_id,
        learner_id=learner_id,
        session_id=session_id,
    )
