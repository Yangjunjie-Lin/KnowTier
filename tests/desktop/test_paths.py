from __future__ import annotations

from pathlib import Path

from cognigraph.desktop.paths import DATA_DIR_ENV, DesktopPaths


def test_platform_app_data_locations_are_explicit(tmp_path: Path) -> None:
    windows = DesktopPaths.discover(
        {"LOCALAPPDATA": str(tmp_path / "Local")}, platform="win32", home=tmp_path
    )
    macos = DesktopPaths.discover({}, platform="darwin", home=tmp_path)
    linux = DesktopPaths.discover({}, platform="linux", home=tmp_path)

    assert windows.root == (tmp_path / "Local" / "KnowTier").resolve()
    assert macos.root == (tmp_path / "Library" / "Application Support" / "KnowTier").resolve()
    assert linux.root == (tmp_path / ".local" / "share" / "KnowTier").resolve()


def test_relative_xdg_data_home_is_ignored(tmp_path: Path) -> None:
    paths = DesktopPaths.discover(
        {"XDG_DATA_HOME": "relative-data"}, platform="linux", home=tmp_path
    )

    assert paths.root == (tmp_path / ".local" / "share" / "KnowTier").resolve()


def test_data_directory_override_controls_every_mutable_path(tmp_path: Path) -> None:
    paths = DesktopPaths.discover({DATA_DIR_ENV: str(tmp_path / "profile")})
    paths.ensure()

    assert paths.database.parent == paths.root
    assert paths.uploads.parent == paths.root
    assert paths.logs.parent == paths.root
    assert paths.backups.parent == paths.root
    assert all(path.is_dir() for path in (paths.root, paths.uploads, paths.logs, paths.backups))
    assert str(paths.database.resolve().as_posix()) in paths.sqlite_url()
