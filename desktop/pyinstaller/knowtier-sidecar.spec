# -*- mode: python ; coding: utf-8 -*-
from __future__ import annotations

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

project_root = Path(SPECPATH).resolve().parents[1]
frontend_dist = Path(
    os.environ.get("KNOWTIER_DESKTOP_FRONTEND_DIST", project_root / "frontend" / "dist")
).resolve()
if not (frontend_dist / "index.html").is_file():
    raise SystemExit(f"frontend production build is missing: {frontend_dist}")

datas = [
    (str(frontend_dist), "frontend-dist"),
    (str(project_root / "src" / "cognigraph" / "prompts"), "cognigraph/prompts"),
    (str(project_root / "migrations"), "cognigraph/migrations"),
    (str(project_root / "alembic.ini"), "cognigraph"),
]
datas += collect_data_files("litellm")
datas += copy_metadata("cognigraph-tutor")
# owlrl imports its distribution version at module import time.  PyInstaller
# collects the Python package through pySHACL, but not the dist-info metadata
# that importlib.metadata needs unless it is declared explicitly.
datas += copy_metadata("owlrl")

hidden_imports = collect_submodules("cognigraph")
hidden_imports += collect_submodules("keyring.backends")
hidden_imports += [
    "aiosqlite",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
]
sidecar_icon = None
if sys.platform == "win32":
    sidecar_icon = str(project_root / "frontend" / "src-tauri" / "icons" / "icon.ico")
elif sys.platform == "darwin":
    sidecar_icon = str(project_root / "frontend" / "src-tauri" / "icons" / "icon.icns")

analysis = Analysis(
    [str(project_root / "scripts" / "desktop" / "sidecar_entry.py")],
    pathex=[str(project_root / "src")],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "mypy", "ruff"],
    noarchive=False,
    optimize=1,
)
python_archive = PYZ(analysis.pure)

executable = EXE(
    python_archive,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="cognigraph-desktop-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Tauri starts the sidecar with CREATE_NO_WINDOW and captures stdout. The
    # console bootloader is required for the authenticated port control pipe.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=sidecar_icon,
)
