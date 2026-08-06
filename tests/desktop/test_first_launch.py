from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from cognigraph.desktop.paths import DATA_DIR_ENV, DesktopPaths
from cognigraph.desktop.state import CURRENT_DESKTOP_SCHEMA, DesktopDataManager


def test_first_launch_initializes_durable_directories_and_schema(tmp_path: Path) -> None:
    paths = DesktopPaths.discover({DATA_DIR_ENV: str(tmp_path / "profile")})

    result = DesktopDataManager(paths).prepare(app_version="1.0.0")

    assert result.first_launch is True
    assert result.from_version == 0
    assert result.to_version == CURRENT_DESKTOP_SCHEMA
    assert result.backup_path is None
    assert paths.database.is_file()
    assert paths.uploads.is_dir()
    assert paths.logs.is_dir()
    assert paths.backups.is_dir()
    with sqlite3.connect(paths.database) as connection:
        version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        owner = connection.execute(
            "SELECT value FROM desktop_runtime_metadata WHERE key = 'schema_owner'"
        ).fetchone()[0]
    assert version == CURRENT_DESKTOP_SCHEMA
    assert owner == "KnowTier desktop"
    state = json.loads(paths.state.read_text(encoding="utf-8"))
    assert state["schema_version"] == CURRENT_DESKTOP_SCHEMA
    assert state["app_version"] == "1.0.0"
