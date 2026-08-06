from __future__ import annotations

import sqlite3
from pathlib import Path

from cognigraph.desktop.paths import DATA_DIR_ENV, DesktopPaths
from cognigraph.desktop.state import DEFAULT_MIGRATIONS, DesktopDataManager


def test_upgrade_backs_up_then_migrates_without_losing_user_data(tmp_path: Path) -> None:
    paths = DesktopPaths.discover({DATA_DIR_ENV: str(tmp_path / "profile")})
    DesktopDataManager(paths).prepare(app_version="1.0.0")
    with sqlite3.connect(paths.database) as connection:
        connection.execute("CREATE TABLE user_notes (body TEXT NOT NULL)")
        connection.execute("INSERT INTO user_notes (body) VALUES ('keep me')")

    def migration_002(connection: sqlite3.Connection) -> None:
        connection.execute("ALTER TABLE user_notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")

    migrations = {1: DEFAULT_MIGRATIONS[1], 2: migration_002}
    result = DesktopDataManager(paths, schema_version=2, migrations=migrations).prepare(
        app_version="2.0.0"
    )

    assert result.from_version == 1
    assert result.to_version == 2
    assert result.backup_path is not None and result.backup_path.is_file()
    with sqlite3.connect(paths.database) as upgraded:
        assert upgraded.execute("SELECT body, pinned FROM user_notes").fetchone() == ("keep me", 0)
        assert int(upgraded.execute("PRAGMA user_version").fetchone()[0]) == 2
    with sqlite3.connect(result.backup_path) as backup:
        assert backup.execute("SELECT body FROM user_notes").fetchone() == ("keep me",)
        columns = {row[1] for row in backup.execute("PRAGMA table_info(user_notes)")}
        assert "pinned" not in columns
        assert int(backup.execute("PRAGMA user_version").fetchone()[0]) == 1
