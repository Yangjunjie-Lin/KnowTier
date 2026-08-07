from __future__ import annotations

import argparse
import os
import shlex
import signal
import subprocess
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke-test a packaged KnowTier desktop executable"
    )
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--sidecar-name", required=True)
    # A one-file PyInstaller sidecar must unpack before the native shell can
    # announce readiness. Keep the smoke deterministic on a cold, clean disk
    # (Windows Defender can make this noticeably slower than a warm restart).
    parser.add_argument("--startup-seconds", type=float, default=60.0)
    return parser.parse_args()


def _command_executable_name(arguments: str) -> str | None:
    try:
        tokens = shlex.split(arguments, posix=True)
    except ValueError:
        return None
    if not tokens:
        return None
    return Path(tokens[0]).name


def _sidecar_processes(name: str, *, exclude_pid: int) -> list[tuple[int, int]]:
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            check=False,
        )
        return [
            (0, 0)
            for line in result.stdout.splitlines()
            if line.startswith('"') and line.split(",", 1)[0].strip('"') == name
        ]

    result = subprocess.run(
        ["ps", "-eo", "pid=,ppid=,args="], capture_output=True, text=True, check=False
    )
    excluded_pids = {exclude_pid, os.getpid()}
    matches: list[tuple[int, int]] = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) != 3:
            continue
        try:
            process_id = int(parts[0])
            parent_id = int(parts[1])
        except ValueError:
            continue
        if process_id not in excluded_pids and _command_executable_name(parts[2]) == name:
            matches.append((process_id, parent_id))
    return matches


def _sidecar_is_running(name: str, *, exclude_pid: int) -> bool:
    return bool(_sidecar_processes(name, exclude_pid=exclude_pid))


def _terminate_packaged_process(
    process: subprocess.Popen[str],
    sidecar_parent_pid: int | None,
) -> None:
    if os.name != "nt" and sidecar_parent_pid is not None and sidecar_parent_pid != process.pid:
        try:
            os.kill(sidecar_parent_pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _run_once(
    executable: Path,
    data_dir: Path,
    sidecar_name: str,
    startup_seconds: float,
) -> None:
    environment = os.environ.copy()
    environment["KNOWTIER_DESKTOP_DATA_DIR"] = str(data_dir)
    process = subprocess.Popen(
        [str(executable)],
        cwd=executable.parent,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    saw_sidecar = False
    sidecar_parent_pid: int | None = None
    try:
        deadline = time.monotonic() + startup_seconds
        while time.monotonic() < deadline:
            code = process.poll()
            if code is not None:
                stderr = process.stderr.read() if process.stderr is not None else ""
                raise RuntimeError(
                    f"packaged application exited before startup (code {code}): {stderr[-2_000:]}"
                )
            sidecars = _sidecar_processes(sidecar_name, exclude_pid=process.pid)
            if sidecars:
                saw_sidecar = True
                if os.name != "nt":
                    sidecar_parent_pid = sidecars[0][1]
            time.sleep(0.25)
    finally:
        _terminate_packaged_process(process, sidecar_parent_pid)

    if not saw_sidecar:
        raise RuntimeError(f"packaged application did not start its sidecar: {sidecar_name}")

    for _ in range(60):
        if not _sidecar_is_running(sidecar_name, exclude_pid=process.pid):
            return
        time.sleep(0.25)
    raise RuntimeError(f"packaged application left an orphan sidecar: {sidecar_name}")


def main() -> int:
    arguments = parse_args()
    executable = arguments.executable.resolve()
    data_dir = arguments.data_dir.resolve()
    if not executable.is_file():
        raise SystemExit(f"packaged executable does not exist: {executable}")
    if arguments.startup_seconds <= 0:
        raise SystemExit("--startup-seconds must be positive")
    data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    sentinel = data_dir / "package-smoke-sentinel.txt"
    sentinel.write_text("desktop persistence smoke\n", encoding="utf-8")
    _run_once(executable, data_dir, arguments.sidecar_name, arguments.startup_seconds)
    if not (data_dir / "desktop-state.json").is_file():
        raise SystemExit("desktop sidecar did not create its App Data state marker")
    if not sentinel.is_file():
        raise SystemExit("desktop data directory was not retained after first launch")
    _run_once(executable, data_dir, arguments.sidecar_name, arguments.startup_seconds)
    if sentinel.read_text(encoding="utf-8") != "desktop persistence smoke\n":
        raise SystemExit("desktop data changed unexpectedly across restart")
    print(f"packaged smoke passed: executable={executable} data_dir={data_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
