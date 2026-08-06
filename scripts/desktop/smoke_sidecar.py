from __future__ import annotations

import argparse
import os
import queue
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from cognigraph.desktop.lifecycle import PARENT_PID_ENV
from cognigraph.desktop.paths import DATA_DIR_ENV
from cognigraph.desktop.security import BOOTSTRAP_TOKEN_ENV, CONTROL_TOKEN_ENV
from cognigraph.desktop.sidecar import PORT_ANNOUNCEMENT_PREFIX, SESSION_COOKIE_NAME


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test a built KnowTier desktop sidecar")
    parser.add_argument("binary", type=Path)
    parser.add_argument("--startup-timeout", type=float, default=60.0)
    return parser.parse_args()


def request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    outgoing = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(outgoing, timeout=2) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def run_smoke(binary: Path, *, startup_timeout: float) -> dict[str, int | bool]:
    executable = binary.resolve(strict=True)
    bootstrap_token = secrets.token_hex(32)
    control_token = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix="knowtier-desktop-smoke-") as temporary:
        environment = os.environ.copy()
        environment.update(
            {
                PARENT_PID_ENV: str(os.getpid()),
                BOOTSTRAP_TOKEN_ENV: bootstrap_token,
                CONTROL_TOKEN_ENV: control_token,
                DATA_DIR_ENV: temporary,
            }
        )
        creation_flags = int(getattr(subprocess, "CREATE_NO_WINDOW", 0))
        process = subprocess.Popen(
            [executable],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        try:
            if process.stdout is None:
                raise RuntimeError("sidecar control output pipe was not created")
            output: queue.Queue[bytes] = queue.Queue(maxsize=1)

            def read_announcement() -> None:
                output.put(process.stdout.readline())

            threading.Thread(target=read_announcement, daemon=True).start()
            try:
                announcement = (
                    output.get(timeout=min(startup_timeout, 30.0)).decode("utf-8").strip()
                )
            except queue.Empty as error:
                raise RuntimeError("sidecar did not announce its loopback port") from error
            if not announcement.startswith(PORT_ANNOUNCEMENT_PREFIX):
                raise RuntimeError("sidecar emitted an invalid port announcement")
            try:
                port = int(announcement.removeprefix(PORT_ANNOUNCEMENT_PREFIX))
            except ValueError as error:
                raise RuntimeError("sidecar announced a non-numeric loopback port") from error
            if not 1024 <= port <= 65535:
                raise RuntimeError("sidecar announced an out-of-range loopback port")
            base_url = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + startup_timeout
            ready = False
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    ready_status, _body = request(
                        f"{base_url}/desktop/ready",
                        headers={"Authorization": f"Bearer {bootstrap_token}"},
                    )
                except urllib.error.URLError:
                    time.sleep(0.2)
                    continue
                ready = ready_status == 204
                break
            if not ready:
                raise RuntimeError("sidecar did not complete its authenticated readiness handshake")
            anonymous_status, _body = request(f"{base_url}/")
            if anonymous_status != 401:
                raise RuntimeError(
                    f"anonymous desktop UI returned {anonymous_status}, expected 401"
                )
            authenticated_status, index = request(
                f"{base_url}/",
                headers={"Cookie": f"{SESSION_COOKIE_NAME}={control_token}"},
            )
            if authenticated_status != 200 or b'id="root"' not in index:
                raise RuntimeError("authenticated desktop UI did not serve the React entry point")
            shutdown_status, _body = request(
                f"{base_url}/desktop/shutdown",
                method="POST",
                headers={"Authorization": f"Bearer {control_token}"},
            )
            if shutdown_status != 202:
                raise RuntimeError(f"desktop shutdown returned {shutdown_status}, expected 202")
            exit_code = process.wait(timeout=10)
            if exit_code != 0:
                raise RuntimeError(f"sidecar exited with code {exit_code}")
            return {
                "ready": ready,
                "anonymous_status": anonymous_status,
                "authenticated_status": authenticated_status,
                "exit_code": exit_code,
            }
        finally:
            if process.stdout is not None:
                process.stdout.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def main() -> int:
    arguments = parse_args()
    result = run_smoke(arguments.binary, startup_timeout=float(arguments.startup_timeout))
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
