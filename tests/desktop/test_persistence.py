from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from cognigraph.desktop.paths import DATA_DIR_ENV, DesktopPaths
from cognigraph.desktop.security import OneTimeToken, ProcessToken
from cognigraph.desktop.sidecar import SESSION_COOKIE_NAME, create_desktop_app
from cognigraph.desktop.state import DesktopDataManager


def _frontend(tmp_path: Path) -> Path:
    frontend = tmp_path / "dist"
    frontend.mkdir()
    (frontend / "index.html").write_text("<main>KnowTier</main>", encoding="utf-8")
    return frontend


def _application(paths: DesktopPaths, frontend: Path):
    return create_desktop_app(
        paths=paths,
        frontend_dir=frontend,
        bootstrap_token=OneTimeToken("b" * 64),
        control_token=ProcessToken("c" * 64),
        shutdown_event=asyncio.Event(),
    )


def test_workspace_persists_across_full_desktop_runtime_restarts(tmp_path: Path) -> None:
    paths = DesktopPaths.discover({DATA_DIR_ENV: str(tmp_path / "profile")})
    frontend = _frontend(tmp_path)
    manager = DesktopDataManager(paths)
    first = manager.prepare(app_version="1.0.0")

    with TestClient(_application(paths, frontend), base_url="http://127.0.0.1:41871") as client:
        client.cookies.set(SESSION_COOKIE_NAME, "c" * 64)
        response = client.post(
            "/api/v1/workspaces",
            json={"name": "Persistent workspace", "slug": "persistent", "default_language": "en"},
            headers={"Authorization": f"Bearer {'c' * 64}"},
        )
        assert response.status_code == 201

    second = manager.prepare(app_version="1.0.1")
    with TestClient(_application(paths, frontend), base_url="http://127.0.0.1:41872") as client:
        client.cookies.set(SESSION_COOKIE_NAME, "c" * 64)
        duplicate = client.post(
            "/api/v1/workspaces",
            json={"name": "Duplicate", "slug": "persistent", "default_language": "en"},
            headers={"Authorization": f"Bearer {'c' * 64}"},
        )
        assert duplicate.status_code == 409

    assert first.first_launch is True
    assert second.first_launch is False
    assert second.from_version == second.to_version
    assert second.backup_path is None
