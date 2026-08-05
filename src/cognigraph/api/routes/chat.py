from __future__ import annotations

from fastapi import APIRouter

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.api.schemas import ChatRequest, ChatResponse
from cognigraph.services.chat import ChatService

router = APIRouter(tags=["tutoring"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> ChatResponse:
    enforce_workspace_scope(workspace_scope, request.workspace_id)
    return await ChatService(runtime).chat(request)
