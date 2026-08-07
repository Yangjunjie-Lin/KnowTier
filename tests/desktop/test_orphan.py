from __future__ import annotations

import asyncio
import os

import pytest

from cognigraph.desktop.lifecycle import (
    _linux_process_is_zombie,
    parent_process_alive,
    watch_parent_process,
)


def test_process_probe_never_signals_the_process_it_checks() -> None:
    assert parent_process_alive(os.getpid()) is True


def test_linux_zombie_probe_reads_proc_process_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def zombie_stat(*_args: object, **_kwargs: object) -> str:
        return "4242 (KnowTier parent) Z 1 2 3"

    monkeypatch.setattr("pathlib.Path.read_text", zombie_stat)
    assert _linux_process_is_zombie(4242) is True

    def running_stat(*_args: object, **_kwargs: object) -> str:
        return "4242 (KnowTier parent) S 1 2 3"

    monkeypatch.setattr("pathlib.Path.read_text", running_stat)
    assert _linux_process_is_zombie(4242) is False

    def raise_os_error(*_args: object, **_kwargs: object) -> str:
        raise OSError("proc entry disappeared")

    monkeypatch.setattr("pathlib.Path.read_text", raise_os_error)
    assert _linux_process_is_zombie(4242) is False


async def test_parent_watchdog_requests_shutdown_after_parent_disappears() -> None:
    checks: list[int] = []
    shutdown = asyncio.Event()

    def parent_is_alive(process_id: int) -> bool:
        checks.append(process_id)
        return len(checks) == 1

    await asyncio.wait_for(
        watch_parent_process(
            4242,
            shutdown,
            interval_seconds=0.001,
            is_alive=parent_is_alive,
        ),
        timeout=1,
    )

    assert shutdown.is_set()
    assert checks == [4242, 4242]
