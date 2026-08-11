from __future__ import annotations

import asyncio
import logging
import os
import socket
import sys
from collections.abc import AsyncIterator, Mapping, MutableMapping
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import RequestResponseEndpoint
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response as StarletteResponse
from starlette.types import Scope

from cognigraph.config import Settings
from cognigraph.desktop.instance import DesktopInstanceLock
from cognigraph.desktop.lifecycle import PARENT_PID_ENV, parse_parent_pid, watch_parent_process
from cognigraph.desktop.paths import DesktopPaths
from cognigraph.desktop.security import (
    BOOTSTRAP_TOKEN_ENV,
    CONTROL_TOKEN_ENV,
    OneTimeToken,
    ProcessToken,
)
from cognigraph.desktop.state import DesktopDataManager
from cognigraph.logging import JsonFormatter
from cognigraph.main import create_app

HOST = "127.0.0.1"
PORT_ANNOUNCEMENT_PREFIX = "KNOWTIER_DESKTOP_PORT="
FRONTEND_DIR_ENV = "KNOWTIER_DESKTOP_FRONTEND_DIR"
APP_VERSION_ENV = "KNOWTIER_DESKTOP_APP_VERSION"
LIVE_MODEL_ENV = "KNOWTIER_DESKTOP_LIVE_MODEL"
OCR_ENV = "KNOWTIER_DESKTOP_OCR"
SESSION_COOKIE_NAME = "knowtier_desktop_session"
logger = logging.getLogger(__name__)


def _installed_version() -> str:
    try:
        return version("cognigraph-tutor")
    except PackageNotFoundError:
        return "1.0.0-rc.5"


@dataclass(frozen=True, slots=True)
class SidecarEnvironment:
    parent_pid: int
    frontend_dir: Path
    app_version: str
    bootstrap_token: OneTimeToken
    control_token: ProcessToken

    @classmethod
    def consume(cls, environ: MutableMapping[str, str]) -> SidecarEnvironment:
        parent_pid = parse_parent_pid(environ.get(PARENT_PID_ENV))
        frontend_dir = resolve_frontend_directory(environ)
        app_version = environ.get(APP_VERSION_ENV, _installed_version()).strip()
        if not app_version:
            raise RuntimeError("desktop app version must not be empty")
        bootstrap_token = OneTimeToken.consume_environment(environ, BOOTSTRAP_TOKEN_ENV)
        control_token = ProcessToken.consume_environment(environ, CONTROL_TOKEN_ENV)
        return cls(
            parent_pid=parent_pid,
            frontend_dir=frontend_dir,
            app_version=app_version,
            bootstrap_token=bootstrap_token,
            control_token=control_token,
        )


class SpaStaticFiles(StaticFiles):
    """Serve built assets and fall back to index.html for client-side routes."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as error:
            if error.status_code != status.HTTP_404_NOT_FOUND:
                raise
            response = Response(status_code=status.HTTP_404_NOT_FOUND)
        if response.status_code == status.HTTP_404_NOT_FOUND and scope["method"] in {"GET", "HEAD"}:
            return await super().get_response("index.html", scope)
        return response


def resolve_frontend_directory(environ: Mapping[str, str] | None = None) -> Path:
    values = os.environ if environ is None else environ
    configured = values.get(FRONTEND_DIR_ENV, "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root is not None:
        return (Path(str(bundle_root)) / "frontend-dist").resolve()
    return (Path(__file__).resolve().parents[3] / "frontend" / "dist").resolve()


def build_desktop_settings(
    paths: DesktopPaths,
    environ: Mapping[str, str] | None = None,
) -> Settings:
    """Create an offline-first desktop profile while retaining normal model configuration."""

    values = os.environ if environ is None else environ
    live_model = _is_true(values.get(LIVE_MODEL_ENV))
    base = Settings()
    if live_model and base.api_key is None:
        raise RuntimeError(
            f"{LIVE_MODEL_ENV}=1 requires COGNIGRAPH_API_KEY; desktop never falls back silently"
        )
    return base.model_copy(
        update={
            "environment": "desktop",
            "desktop_mode": True,
            "database_url": paths.sqlite_url(),
            "storage_path": paths.uploads,
            "model_config_path": paths.root / "model-profiles.json",
            "neo4j_required": False,
            "workspace_scope_required": False,
            "cors_allowed_origins": (),
            "use_mock_llm": not live_model,
            "ocr_enabled": _is_true(values.get(OCR_ENV)),
            "vision_enabled": live_model and base.vision_enabled,
            "vision_fallback_enabled": live_model and base.vision_fallback_enabled,
        }
    )


def create_desktop_app(
    *,
    paths: DesktopPaths,
    frontend_dir: Path,
    bootstrap_token: OneTimeToken,
    control_token: ProcessToken,
    shutdown_event: asyncio.Event,
    core_app: FastAPI | None = None,
    environ: Mapping[str, str] | None = None,
) -> FastAPI:
    if not (frontend_dir / "index.html").is_file():
        raise RuntimeError(f"desktop frontend is missing index.html: {frontend_dir}")

    api = core_app or create_app(build_desktop_settings(paths, environ))

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        async with api.router.lifespan_context(api):
            yield

    application = FastAPI(
        title="KnowTier Desktop",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[HOST, "localhost"],
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-Workspace-ID",
            "X-Workspace-Provisioning-Token",
        ],
        expose_headers=["X-Request-ID"],
    )

    @application.middleware("http")
    async def desktop_security_headers(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> StarletteResponse:
        path = request.url.path
        is_api_request = path == "/api" or path.startswith("/api/")
        is_authorized = (
            control_token.matches_authorization(request.headers.get("authorization"))
            if is_api_request
            else control_token.matches(request.cookies.get(SESSION_COOKIE_NAME))
        )
        is_exempt = request.method == "OPTIONS" or path in {
            "/desktop/ready",
            "/desktop/shutdown",
        }
        if not is_exempt and not is_authorized:
            return StarletteResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                headers={
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "connect-src 'self'; "
            "font-src 'self' data:; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "img-src 'self' data: blob:; "
            "object-src 'none'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'"
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path == "/" or request.url.path.endswith(".html"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.get("/desktop/ready", include_in_schema=False)
    async def desktop_ready(authorization: str | None = Header(default=None)) -> Response:
        if bootstrap_token.consume_authorization(authorization):
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid handshake")

    @application.post("/desktop/shutdown", include_in_schema=False)
    async def desktop_shutdown(authorization: str | None = Header(default=None)) -> Response:
        if not control_token.matches_authorization(authorization):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid control")
        shutdown_event.set()
        return Response(status_code=status.HTTP_202_ACCEPTED)

    application.mount("/api", api)
    application.mount("/", SpaStaticFiles(directory=frontend_dir, html=True), name="desktop-ui")
    return application


def install_file_logging(log_directory: Path) -> None:
    log_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = log_directory / "knowtier-desktop.jsonl"
    destination_handler = RotatingFileHandler(
        destination,
        maxBytes=2 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    destination_handler.setFormatter(JsonFormatter())
    logging.getLogger().addHandler(destination_handler)


async def serve(
    environment: SidecarEnvironment,
    paths: DesktopPaths,
    listener: socket.socket,
) -> None:
    shutdown_event = asyncio.Event()
    application = create_desktop_app(
        paths=paths,
        frontend_dir=environment.frontend_dir,
        bootstrap_token=environment.bootstrap_token,
        control_token=environment.control_token,
        shutdown_event=shutdown_event,
    )
    configuration = uvicorn.Config(
        application,
        host=HOST,
        port=0,
        access_log=False,
        log_config=None,
        server_header=False,
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(configuration)
    server_task = asyncio.create_task(
        server.serve(sockets=[listener]),
        name="desktop-http-server",
    )
    watchdog_task = asyncio.create_task(
        watch_parent_process(environment.parent_pid, shutdown_event),
        name="desktop-parent-watchdog",
    )
    shutdown_task = asyncio.create_task(shutdown_event.wait(), name="desktop-shutdown-request")
    try:
        completed, _pending = await asyncio.wait(
            {server_task, shutdown_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if shutdown_task in completed:
            server.should_exit = True
        await server_task
    finally:
        shutdown_event.set()
        for task in (shutdown_task, watchdog_task):
            if not task.done():
                task.cancel()
            with suppress(asyncio.CancelledError):
                await task


def main() -> int:
    environment = SidecarEnvironment.consume(os.environ)
    paths = DesktopPaths.discover()
    paths.ensure()
    install_file_logging(paths.logs)
    instance_lock = DesktopInstanceLock(paths.root / "desktop.instance.lock")
    with instance_lock:
        listener = bind_loopback_socket()
        try:
            announce_port(int(listener.getsockname()[1]))
            DesktopDataManager(paths).prepare(app_version=environment.app_version)
            asyncio.run(serve(environment, paths, listener))
        except Exception:
            logger.exception("desktop sidecar startup or runtime failed")
            raise
        finally:
            with suppress(OSError):
                listener.close()
    return 0


def bind_loopback_socket() -> socket.socket:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind((HOST, 0))
        listener.listen(128)
        listener.set_inheritable(False)
        return listener
    except BaseException:
        listener.close()
        raise


def announce_port(port: int) -> None:
    if not 1024 <= port <= 65535:
        raise RuntimeError("operating system returned an invalid desktop loopback port")
    if sys.stdout is None:
        raise RuntimeError("desktop launcher did not provide a control output pipe")
    sys.stdout.write(f"{PORT_ANNOUNCEMENT_PREFIX}{port}\n")
    sys.stdout.flush()


def _is_true(value: str | None) -> bool:
    return value is not None and value.strip().casefold() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    raise SystemExit(main())
