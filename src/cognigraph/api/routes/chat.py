from __future__ import annotations

from fastapi import APIRouter

from cognigraph.api.dependencies import RuntimeDependency
from cognigraph.api.schemas import ChatRequest, ChatResponse
from cognigraph.services.chat import ChatService

router = APIRouter(tags=["tutoring"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, runtime: RuntimeDependency) -> ChatResponse:
    return await ChatService(runtime).chat(request)
