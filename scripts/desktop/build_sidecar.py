from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

SIDECAR_NAME = "cognigraph-desktop-sidecar"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and stage the PyInstaller desktop sidecar")
    parser.add_argument("--target-triple", required=True, help="Rust target triple used by Tauri")
    parser.add_argument("--frontend-dist", type=Path, default=Path("frontend/dist"))
    parser.add_argument("--binaries-dir", type=Path, default=Path("frontend/src-tauri/binaries"))
    parser.add_argument("--work-dir", type=Path, default=Path("build/desktop-sidecar"))
    return parser.parse_args()


def build_sidecar(
    *,
    project_root: Path,
    target_triple: str,
    frontend_dist: Path,
    binaries_dir: Path,
    work_dir: Path,
) -> Path:
    resolved_frontend = (project_root / frontend_dist).resolve()
    if not (resolved_frontend / "index.html").is_file():
        raise RuntimeError(f"build the React production bundle first: {resolved_frontend}")
    resolved_work = (project_root / work_dir).resolve()
    resolved_binaries = (project_root / binaries_dir).resolve()
    resolved_work.mkdir(parents=True, exist_ok=True)
    resolved_binaries.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["KNOWTIER_DESKTOP_FRONTEND_DIST"] = str(resolved_frontend)
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--distpath",
        str(resolved_work / "dist"),
        "--workpath",
        str(resolved_work / "work"),
        str(project_root / "desktop" / "pyinstaller" / "knowtier-sidecar.spec"),
    ]
    subprocess.run(command, cwd=project_root, env=environment, check=True)
    suffix = ".exe" if os.name == "nt" else ""
    built_binary = resolved_work / "dist" / f"{SIDECAR_NAME}{suffix}"
    if not built_binary.is_file():
        raise RuntimeError(f"PyInstaller did not produce the expected sidecar: {built_binary}")
    staged_binary = resolved_binaries / f"{SIDECAR_NAME}-{target_triple}{suffix}"
    shutil.copy2(built_binary, staged_binary)
    if os.name != "nt":
        staged_binary.chmod(staged_binary.stat().st_mode | 0o111)
    return staged_binary


def main() -> int:
    arguments = parse_args()
    project_root = Path(__file__).resolve().parents[2]
    staged = build_sidecar(
        project_root=project_root,
        target_triple=str(arguments.target_triple),
        frontend_dist=arguments.frontend_dist,
        binaries_dir=arguments.binaries_dir,
        work_dir=arguments.work_dir,
    )
    print(staged)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
