from __future__ import annotations

import json
import subprocess
from unittest.mock import Mock, call

import pytest

from scripts.desktop import smoke_sidecar
from scripts.desktop.smoke_package import _command_executable_name, _sidecar_parent_pid


def test_command_executable_name_ignores_sidecar_name_arguments() -> None:
    sidecar_name = "cognigraph-desktop-sidecar-x86_64-unknown-linux-gnu"

    assert (
        _command_executable_name(f"/usr/bin/python smoke_package.py --sidecar-name {sidecar_name}")
        == "python"
    )
    assert _command_executable_name(f"/tmp/KnowTier/usr/bin/{sidecar_name}") == sidecar_name
    assert _command_executable_name("'unterminated") is None


def test_sidecar_parent_pid_selects_the_top_level_bootloader() -> None:
    assert _sidecar_parent_pid([(101, 42), (102, 101)]) == 42
    assert _sidecar_parent_pid([(101, 102), (102, 101)]) is None


def test_sidecar_readiness_retries_timeouts_and_non_ready_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses: list[TimeoutError | tuple[int, bytes]] = [
        TimeoutError("cold-start request timed out"),
        (503, b"starting"),
        (204, b""),
    ]
    timeouts: list[float] = []

    def fake_request(
        _url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        timeout: float = 2.0,
    ) -> tuple[int, bytes]:
        del method, headers, body
        timeouts.append(timeout)
        response = responses.pop(0)
        if isinstance(response, TimeoutError):
            raise response
        return response

    process: Mock = Mock()
    process.poll.return_value = None
    monkeypatch.setattr(smoke_sidecar, "request", fake_request)
    monkeypatch.setattr(smoke_sidecar.time, "sleep", lambda _seconds: None)

    assert smoke_sidecar._wait_until_ready(
        "http://127.0.0.1:41000",
        "bootstrap-token",
        process,
        startup_timeout=10,
    )
    assert responses == []
    assert timeouts[0] > 2.0


def test_sidecar_readiness_fails_fast_when_bootstrap_token_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def fake_request(
        _url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        timeout: float = 2.0,
    ) -> tuple[int, bytes]:
        nonlocal calls
        del method, headers, body, timeout
        calls += 1
        return 401, b"invalid handshake"

    process: Mock = Mock()
    process.poll.return_value = None
    monkeypatch.setattr(smoke_sidecar, "request", fake_request)

    with pytest.raises(RuntimeError, match="bootstrap readiness token"):
        smoke_sidecar._wait_until_ready(
            "http://127.0.0.1:41000",
            "bootstrap-token",
            process,
            startup_timeout=120,
        )

    assert calls == 1


def test_json_request_sends_authenticated_utf8_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_request(
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        timeout: float = 2.0,
    ) -> tuple[int, bytes]:
        captured.update(
            url=url,
            method=method,
            headers=headers,
            body=body,
            timeout=timeout,
        )
        return 200, b'{"id":"response-id"}'

    monkeypatch.setattr(smoke_sidecar, "request", fake_request)

    status, payload = smoke_sidecar.json_request(
        "http://127.0.0.1:41000/api/v1/chat",
        {"message": "什么是 RAG?"},
        control_token="control-token",
        timeout=60.0,
    )

    assert status == 200
    assert payload == {"id": "response-id"}
    assert captured["method"] == "POST"
    assert captured["timeout"] == 60.0
    assert captured["headers"] == {
        "Authorization": "Bearer control-token",
        "Content-Type": "application/json",
    }
    assert json.loads(bytes(captured["body"]).decode("utf-8")) == {"message": "什么是 RAG?"}


def test_remaining_startup_time_uses_one_end_to_end_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(smoke_sidecar.time, "monotonic", lambda: 145.0)

    assert smoke_sidecar._remaining_startup_time(100.0, 120.0) == 75.0
    assert smoke_sidecar._remaining_startup_time(100.0, 40.0) == 0.0


def test_stop_process_tree_terminates_and_reaps_posix_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process: Mock = Mock()
    process.poll.return_value = None
    monkeypatch.setattr(smoke_sidecar.os, "name", "posix")

    smoke_sidecar._stop_process_tree(process)

    assert process.method_calls == [call.poll(), call.terminate(), call.wait(timeout=30)]


def test_stop_process_tree_forcibly_ends_windows_bootloader_children(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process: Mock = Mock(pid=4242)
    process.poll.return_value = None
    run = Mock()
    monkeypatch.setattr(smoke_sidecar.os, "name", "nt")
    monkeypatch.setattr(smoke_sidecar.subprocess, "run", run)

    smoke_sidecar._stop_process_tree(process)

    run.assert_called_once_with(
        ["taskkill", "/PID", "4242", "/T", "/F"],
        check=False,
        capture_output=True,
        timeout=30,
    )
    process.wait.assert_called_once_with(timeout=30)


def test_stop_process_tree_kills_a_process_that_does_not_terminate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process: Mock = Mock()
    process.poll.return_value = None
    process.wait.side_effect = [subprocess.TimeoutExpired("sidecar", 30), 0]
    monkeypatch.setattr(smoke_sidecar.os, "name", "posix")

    smoke_sidecar._stop_process_tree(process)

    assert process.method_calls == [
        call.poll(),
        call.terminate(),
        call.wait(timeout=30),
        call.kill(),
        call.wait(timeout=30),
    ]
