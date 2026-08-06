from __future__ import annotations

import argparse
import os
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
    parser.add_argument("--startup-seconds", type=float, default=8.0)
    return parser.parse_args()


def _sidecar_is_running(name: str, *, exclude_pid: int) -> bool:
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {name}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            check=False,
        )
        return any(
            line.startswith('"') and line.split(",", 1)[0].strip('"') == name
            for line in result.stdout.splitlines()
        )

    result = subprocess.run(
        ["ps", "-eo", "pid=,args="], capture_output=True, text=True, check=False
    )
    excluded_pids = {str(exclude_pid), str(os.getpid())}
    return any(
        parts[0] not in excluded_pids and name in parts[1]
        for line in result.stdout.splitlines()
        if line.strip()
        for parts in [line.strip().split(maxsplit=1)]
        if len(parts) == 2
    )


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
    try:
        deadline = time.monotonic() + startup_seconds
        saw_sidecar = False
        while time.monotonic() < deadline:
            code = process.poll()
            if code is not None:
                stderr = process.stderr.read() if process.stderr is not None else ""
                raise RuntimeError(
                    f"packaged application exited before startup (code {code}): {stderr[-2_000:]}"
                )
            saw_sidecar = saw_sidecar or _sidecar_is_running(sidecar_name, exclude_pid=process.pid)
            time.sleep(0.25)
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)

    if not saw_sidecar:
        raise RuntimeError(f"packaged application did not start its sidecar: {sidecar_name}")

    for _ in range(20):
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
