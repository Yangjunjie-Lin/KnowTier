from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cognigraph.desktop.paths import DATA_DIR_ENV, DesktopPaths
from cognigraph.desktop.security import OneTimeToken, ProcessToken
from cognigraph.desktop.sidecar import (
    SESSION_COOKIE_NAME,
    build_desktop_settings,
    create_desktop_app,
)


def test_desktop_shell_is_same_origin_hidden_handshake_target(tmp_path: Path) -> None:
    frontend = tmp_path / "dist"
    frontend.mkdir()
    (frontend / "index.html").write_text("<main id='app'>ready</main>", encoding="utf-8")
    core = FastAPI()

    @core.get("/v1/ping")
    async def ping() -> dict[str, str]:
        return {"status": "ok"}

    shutdown = asyncio.Event()
    application = create_desktop_app(
        paths=DesktopPaths.discover({DATA_DIR_ENV: str(tmp_path / "profile")}),
        frontend_dir=frontend,
        bootstrap_token=OneTimeToken("r" * 64),
        control_token=ProcessToken("s" * 64),
        shutdown_event=shutdown,
        core_app=core,
    )

    with TestClient(application, base_url="http://127.0.0.1:42000") as client:
        assert client.get("/").status_code == 401
        assert client.get("/api/v1/ping").status_code == 401
        client.cookies.set(SESSION_COOKIE_NAME, "s" * 64)
        assert client.get("/").status_code == 200
        assert client.get("/learning/path").text == "<main id='app'>ready</main>"
        assert client.get("/api/v1/ping").status_code == 401
        api_response = client.get("/api/v1/ping", headers={"Authorization": f"Bearer {'s' * 64}"})
        assert api_response.json() == {"status": "ok"}
        assert api_response.headers["x-content-type-options"] == "nosniff"
        preflight = client.options(
            "/api/v1/ping",
            headers={
                "Origin": "http://tauri.localhost",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == "http://tauri.localhost"
        assert (
            client.get("/desktop/ready", headers={"Authorization": "Bearer no"}).status_code == 401
        )
        assert (
            client.get(
                "/desktop/ready", headers={"Authorization": f"Bearer {'r' * 64}"}
            ).status_code
            == 204
        )
        assert (
            client.get(
                "/desktop/ready", headers={"Authorization": f"Bearer {'r' * 64}"}
            ).status_code
            == 401
        )
        assert not shutdown.is_set()
        assert (
            client.post(
                "/desktop/shutdown", headers={"Authorization": f"Bearer {'s' * 64}"}
            ).status_code
            == 202
        )
        assert shutdown.is_set()


def test_desktop_settings_are_offline_first_and_store_files_in_app_data(tmp_path: Path) -> None:
    paths = DesktopPaths.discover({DATA_DIR_ENV: str(tmp_path / "profile")})
    settings = build_desktop_settings(
        paths,
        {
            "KNOWTIER_DESKTOP_LIVE_MODEL": "0",
            "COGNIGRAPH_USE_MOCK_LLM": "false",
        },
    )

    assert settings.environment == "desktop"
    assert settings.desktop_mode is True
    assert settings.use_mock_llm is True
    assert settings.neo4j_required is False
    assert settings.ocr_enabled is False
    assert settings.vision_enabled is False
    assert settings.database_url == paths.sqlite_url()
    assert settings.storage_path == paths.uploads
    assert settings.model_config_path == paths.root / "model-profiles.json"
