from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

DATA_DIR_ENV = "KNOWTIER_DESKTOP_DATA_DIR"
APP_DIRECTORY_NAME = "KnowTier"


@dataclass(frozen=True, slots=True)
class DesktopPaths:
    """All mutable desktop data, rooted in the operating system's app-data folder."""

    root: Path
    database: Path
    uploads: Path
    logs: Path
    backups: Path
    state: Path

    @classmethod
    def discover(
        cls,
        environ: Mapping[str, str] | None = None,
        *,
        platform: str | None = None,
        home: Path | None = None,
    ) -> DesktopPaths:
        values = os.environ if environ is None else environ
        platform_name = sys.platform if platform is None else platform
        home_dir = Path.home() if home is None else home
        override = values.get(DATA_DIR_ENV, "").strip()
        if override:
            root = Path(override).expanduser()
        elif platform_name == "win32":
            windows_base = values.get("LOCALAPPDATA") or values.get("APPDATA")
            root = (
                Path(windows_base) if windows_base else home_dir / "AppData" / "Local"
            ) / APP_DIRECTORY_NAME
        elif platform_name == "darwin":
            root = home_dir / "Library" / "Application Support" / APP_DIRECTORY_NAME
        else:
            xdg_data_home = values.get("XDG_DATA_HOME", "").strip()
            configured_xdg = Path(xdg_data_home).expanduser() if xdg_data_home else None
            xdg_base = (
                configured_xdg
                if configured_xdg is not None and configured_xdg.is_absolute()
                else home_dir / ".local" / "share"
            )
            root = xdg_base / APP_DIRECTORY_NAME
        resolved_root = root.resolve()
        return cls(
            root=resolved_root,
            database=resolved_root / "knowtier.sqlite3",
            uploads=resolved_root / "uploads",
            logs=resolved_root / "logs",
            backups=resolved_root / "backups",
            state=resolved_root / "desktop-state.json",
        )

    def ensure(self) -> None:
        for directory in (self.root, self.uploads, self.logs, self.backups):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            if os.name != "nt":
                with suppress(OSError):
                    directory.chmod(0o700)

    def sqlite_url(self) -> str:
        """Return a SQLAlchemy async URL that is valid for absolute Windows and POSIX paths."""

        database_path = self.database.resolve().as_posix()
        if "?" in database_path or "#" in database_path:
            raise RuntimeError("desktop data paths must not contain '?' or '#'")
        return f"sqlite+aiosqlite:///{database_path}"
