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

from cognigraph.api.routes import chat, documents, graph, learners, workspaces
from cognigraph.config import Settings
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
        version="0.1.0",
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
            ],
            expose_headers=["X-Request-ID"],
        )

    @application.middleware("http")
    async def request_context(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> StarletteResponse:
        request_id = request.headers.get("x-request-id", str(uuid4()))
        token = request_id_context.set(request_id)
        try:
            response = await call_next(request)
            response.headers["x-request-id"] = request_id
            return response
        finally:
            request_id_context.reset(token)

    @application.exception_handler(LookupError)
    async def lookup_error(_request: Request, exception: LookupError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exception)})

    @application.exception_handler(ValueError)
    async def validation_error(_request: Request, exception: ValueError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exception)})

    @application.exception_handler(Exception)
    async def internal_error(_request: Request, exception: Exception) -> JSONResponse:
        logger.error("unhandled request error", extra={"error_type": type(exception).__name__})
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

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
    return application


app = create_app()
