from __future__ import annotations

import argparse
import json
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
from uuid import uuid4

from cognigraph.desktop.lifecycle import PARENT_PID_ENV
from cognigraph.desktop.paths import DATA_DIR_ENV
from cognigraph.desktop.security import BOOTSTRAP_TOKEN_ENV, CONTROL_TOKEN_ENV
from cognigraph.desktop.sidecar import (
    LIVE_MODEL_ENV,
    PORT_ANNOUNCEMENT_PREFIX,
    SESSION_COOKIE_NAME,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test a built KnowTier desktop sidecar")
    parser.add_argument("binary", type=Path)
    parser.add_argument("--startup-timeout", type=float, default=120.0)
    return parser.parse_args()


def _remaining_startup_time(started_at: float, startup_timeout: float) -> float:
    return max(0.0, startup_timeout - (time.monotonic() - started_at))


def _stop_process_tree(process: subprocess.Popen[bytes]) -> None:
    """Stop a frozen sidecar and all of its PyInstaller bootloader children."""

    if process.poll() is not None:
        process.wait()
        return
    if os.name == "nt":
        # A one-file PyInstaller executable has a bootloader parent and an
        # application child. Terminating only the Popen handle can leave the
        # child holding the SQLite/log files open on Windows.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            capture_output=True,
            timeout=30,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=30)


def request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 2.0,
) -> tuple[int, bytes]:
    outgoing = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers=headers or {},
    )
    try:
        with urllib.request.urlopen(outgoing, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def json_request(
    url: str,
    payload: dict[str, object],
    *,
    control_token: str,
    timeout: float = 30.0,
) -> tuple[int, dict[str, object]]:
    status, body = request(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {control_token}",
            "Content-Type": "application/json",
        },
        body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        timeout=timeout,
    )
    try:
        decoded = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"sidecar returned non-JSON status {status}") from error
    if not isinstance(decoded, dict):
        raise RuntimeError(f"sidecar returned a non-object JSON payload with status {status}")
    return status, decoded


def _wait_until_ready(
    base_url: str,
    bootstrap_token: str,
    process: subprocess.Popen[bytes],
    *,
    startup_timeout: float,
) -> bool:
    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline and process.poll() is None:
        remaining = max(0.0, deadline - time.monotonic())
        if remaining <= 0.0:
            break
        try:
            ready_status, _body = request(
                f"{base_url}/desktop/ready",
                headers={"Authorization": f"Bearer {bootstrap_token}"},
                timeout=remaining,
            )
        except (TimeoutError, urllib.error.URLError):
            time.sleep(0.2)
            continue
        if ready_status == 204:
            return True
        if ready_status == 401:
            raise RuntimeError("sidecar rejected the bootstrap readiness token")
        time.sleep(0.2)
    return False


def run_smoke(binary: Path, *, startup_timeout: float) -> dict[str, int | bool]:
    if startup_timeout <= 0:
        raise ValueError("startup_timeout must be positive")
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
                LIVE_MODEL_ENV: "0",
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
        started_at = time.monotonic()
        try:
            if process.stdout is None:
                raise RuntimeError("sidecar control output pipe was not created")
            control_output = process.stdout
            output: queue.Queue[bytes] = queue.Queue(maxsize=1)

            def read_announcement() -> None:
                output.put(control_output.readline())

            threading.Thread(target=read_announcement, daemon=True).start()
            try:
                announcement = (
                    output.get(timeout=_remaining_startup_time(started_at, startup_timeout))
                    .decode("utf-8")
                    .strip()
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
            ready = _wait_until_ready(
                base_url,
                bootstrap_token,
                process,
                startup_timeout=_remaining_startup_time(started_at, startup_timeout),
            )
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

            workspace_status, workspace = json_request(
                f"{base_url}/api/v1/workspaces",
                {
                    "name": "Packaged sidecar smoke",
                    "slug": f"packaged-smoke-{uuid4().hex[:12]}",
                    "default_language": "zh-CN",
                },
                control_token=control_token,
            )
            workspace_id = workspace.get("id")
            if workspace_status != 201 or not isinstance(workspace_id, str):
                raise RuntimeError(
                    f"packaged workspace creation returned {workspace_status}, expected 201"
                )
            learner_status, learner = json_request(
                f"{base_url}/api/v1/learners",
                {
                    "workspace_id": workspace_id,
                    "display_name": "Packaged smoke learner",
                },
                control_token=control_token,
            )
            learner_id = learner.get("id")
            if learner_status != 201 or not isinstance(learner_id, str):
                raise RuntimeError(
                    f"packaged learner creation returned {learner_status}, expected 201"
                )
            chat_status, chat = json_request(
                f"{base_url}/api/v1/chat",
                {
                    "workspace_id": workspace_id,
                    "learner_id": learner_id,
                    "session_id": str(uuid4()),
                    "message": "什么是 RAG?",
                    "requested_mode": "learn",
                },
                control_token=control_token,
                timeout=60.0,
            )
            graph_update = chat.get("graph_update")
            target = chat.get("target_knowledge_point")
            if (
                chat_status != 200
                or not isinstance(graph_update, dict)
                or not isinstance(graph_update.get("revision_id"), str)
                or not isinstance(target, dict)
                or not isinstance(target.get("id"), str)
            ):
                detail = chat.get("detail")
                safe_detail = str(detail)[:200] if detail is not None else "invalid response"
                raise RuntimeError(f"packaged Mock chat returned {chat_status}: {safe_detail}")
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
                "workspace_status": workspace_status,
                "learner_status": learner_status,
                "chat_status": chat_status,
                "exit_code": exit_code,
            }
        finally:
            if process.poll() is None:
                _stop_process_tree(process)
            if process.stdout is not None:
                process.stdout.close()


def main() -> int:
    arguments = parse_args()
    result = run_smoke(arguments.binary, startup_timeout=float(arguments.startup_timeout))
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
