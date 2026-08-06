from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from uuid import uuid4

from cognigraph.desktop.paths import DesktopPaths

CURRENT_DESKTOP_SCHEMA = 1
Migration = Callable[[sqlite3.Connection], None]


def _migration_001(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS desktop_runtime_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        INSERT INTO desktop_runtime_metadata (key, value)
        VALUES ('schema_owner', 'KnowTier desktop')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """
    )


DEFAULT_MIGRATIONS: Mapping[int, Migration] = MappingProxyType({1: _migration_001})


@dataclass(frozen=True, slots=True)
class UpgradeResult:
    first_launch: bool
    from_version: int
    to_version: int
    backup_path: Path | None


@dataclass(frozen=True, slots=True)
class DesktopState:
    schema_version: int
    app_version: str
    last_launch_utc: str


class DesktopDataManager:
    """Prepare durable desktop storage and transactionally advance its schema marker."""

    def __init__(
        self,
        paths: DesktopPaths,
        *,
        schema_version: int = CURRENT_DESKTOP_SCHEMA,
        migrations: Mapping[int, Migration] = DEFAULT_MIGRATIONS,
    ) -> None:
        if schema_version < 1:
            raise ValueError("desktop schema version must be positive")
        missing = [version for version in range(1, schema_version + 1) if version not in migrations]
        if missing:
            raise ValueError(f"missing desktop migrations: {missing}")
        self.paths = paths
        self.schema_version = schema_version
        self.migrations = migrations

    def prepare(self, *, app_version: str) -> UpgradeResult:
        self.paths.ensure()
        first_launch = not self.paths.database.exists()
        database_had_content = (
            self.paths.database.exists() and self.paths.database.stat().st_size > 0
        )
        backup_path: Path | None = None
        with sqlite3.connect(self.paths.database, timeout=30) as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            current_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if current_version > self.schema_version:
                raise RuntimeError(
                    "desktop data was created by a newer KnowTier version "
                    f"(schema {current_version} > supported {self.schema_version})"
                )
            if current_version < self.schema_version and database_had_content:
                backup_path = self._backup(connection, current_version)
            if current_version < self.schema_version:
                connection.execute("BEGIN IMMEDIATE")
                try:
                    for version in range(current_version + 1, self.schema_version + 1):
                        self.migrations[version](connection)
                        connection.execute(f"PRAGMA user_version = {version}")
                    connection.commit()
                except BaseException:
                    connection.rollback()
                    raise
            connection.execute("PRAGMA journal_mode = WAL")
        self._write_state(app_version)
        return UpgradeResult(
            first_launch=first_launch,
            from_version=current_version,
            to_version=self.schema_version,
            backup_path=backup_path,
        )

    def _backup(self, source: sqlite3.Connection, from_version: int) -> Path:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        destination = self.paths.backups / (
            f"knowtier-schema-{from_version}-{timestamp}-{uuid4().hex[:8]}.sqlite3"
        )
        with sqlite3.connect(destination) as backup:
            source.backup(backup)
        if os.name != "nt":
            destination.chmod(0o600)
        return destination

    def _write_state(self, app_version: str) -> None:
        state = DesktopState(
            schema_version=self.schema_version,
            app_version=app_version,
            last_launch_utc=datetime.now(UTC).isoformat(),
        )
        temporary = self.paths.state.with_name(f".{self.paths.state.name}.{uuid4().hex}.tmp")
        temporary.write_text(
            json.dumps(asdict(state), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if os.name != "nt":
            temporary.chmod(0o600)
        temporary.replace(self.paths.state)
