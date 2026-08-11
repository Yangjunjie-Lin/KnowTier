from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response as StarletteResponse

from cognigraph import __version__
from cognigraph.api.routes import (
    chat,
    documents,
    graph,
    learners,
    model_config,
    search,
    workspaces,
)
from cognigraph.config import Settings
from cognigraph.llm.gateway import ModelGatewayError
from cognigraph.llm.openai_compatible import OpenAICompatibleError
from cognigraph.logging import configure_logging, request_id_context
from cognigraph.services.runtime import ApplicationRuntime

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    runtime: ApplicationRuntime | None = None,
) -> FastAPI:
    application_runtime = runtime or ApplicationRuntime(settings)
    configure_logging(application_runtime.settings.log_level)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.runtime = application_runtime
        await application_runtime.startup()
        try:
            yield
        finally:
            await application_runtime.shutdown()

    application = FastAPI(
        title="Cognigraph Tutor API",
        version=__version__,
        description="Six-level traceable tutoring and learner knowledge graph backend.",
        lifespan=lifespan,
    )

    cors_origins = application_runtime.settings.cors_allowed_origins
    if cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=list(cors_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=[
                "Accept",
                "Content-Type",
                "X-Workspace-ID",
                "X-Workspace-Provisioning-Token",
                "X-Request-ID",
                "X-Model-Configuration-Token",
            ],
            expose_headers=["X-Request-ID"],
        )

    @application.middleware("http")
    async def request_context(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> StarletteResponse:
        request_id = request.headers.get("x-request-id", str(uuid4()))
        request.state.request_id = request_id
        token = request_id_context.set(request_id)
        try:
            response = await call_next(request)
            response.headers["x-request-id"] = request_id
            return response
        finally:
            request_id_context.reset(token)

    @application.exception_handler(LookupError)
    async def lookup_error(request: Request, exception: LookupError) -> JSONResponse:
        return _error_response(404, str(exception), request=request)

    @application.exception_handler(ValueError)
    async def validation_error(request: Request, exception: ValueError) -> JSONResponse:
        return _error_response(422, str(exception), request=request)

    @application.exception_handler(OpenAICompatibleError)
    async def model_provider_error(
        request: Request,
        exception: OpenAICompatibleError,
    ) -> JSONResponse:
        if exception.status_code == 429:
            status_code = 429
        elif exception.status_code == 408 or "timed out" in str(exception).casefold():
            status_code = 504
        else:
            status_code = 502
        return _error_response(
            status_code,
            f"model provider error: {exception}",
            request=request,
        )

    @application.exception_handler(ModelGatewayError)
    async def model_gateway_error(
        request: Request,
        exception: ModelGatewayError,
    ) -> JSONResponse:
        cause = exception.cause
        cause_text = " ".join(
            text for text in (str(exception), str(cause) if cause is not None else "") if text
        ).casefold()
        if exception.status_code == 429 or getattr(cause, "status_code", None) == 429:
            return _error_response(
                429,
                "model provider error: rate limit reached; retry later",
                request=request,
            )
        if (
            exception.status_code == 408
            or getattr(cause, "status_code", None) == 408
            or "timeouterror" in cause_text
            or "timed out" in cause_text
        ):
            return _error_response(
                504,
                "model generation timed out; retry or increase the configured timeout",
                request=request,
            )
        return _error_response(
            502,
            "model output failed validation after the configured retries",
            request=request,
        )

    @application.exception_handler(Exception)
    async def internal_error(request: Request, exception: Exception) -> JSONResponse:
        request_id = _request_id(request)
        logger.error(
            "unhandled request error",
            extra={
                "error_type": type(exception).__name__,
                "request_id": request_id,
            },
            exc_info=(type(exception), exception, exception.__traceback__),
        )
        return _error_response(500, "internal server error", request=request)

    def _error_response(
        status_code: int,
        detail: str,
        *,
        request: Request,
    ) -> JSONResponse:
        request_id = _request_id(request)
        headers = {"X-Request-ID": request_id} if request_id else None
        return JSONResponse(
            status_code=status_code,
            content={"detail": detail},
            headers=headers,
        )

    def _request_id(request: Request) -> str | None:
        state_value = getattr(request.state, "request_id", None)
        if isinstance(state_value, str) and state_value:
            return state_value
        return request_id_context.get() or request.headers.get("x-request-id")

    @application.get("/health", tags=["operations"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/ready", tags=["operations"])
    async def ready() -> JSONResponse:
        checks = await application_runtime.readiness()
        return JSONResponse(status_code=200 if checks["ready"] else 503, content=checks)

    application.include_router(workspaces.router, prefix="/v1")
    application.include_router(documents.router, prefix="/v1")
    application.include_router(chat.router, prefix="/v1")
    application.include_router(graph.router, prefix="/v1")
    application.include_router(learners.router, prefix="/v1")
    application.include_router(model_config.router, prefix="/v1")
    application.include_router(search.router, prefix="/v1")
    return application


app = create_app()
