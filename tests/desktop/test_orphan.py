from __future__ import annotations

import asyncio
import os

from cognigraph.desktop.lifecycle import parent_process_alive, watch_parent_process


def test_process_probe_never_signals_the_process_it_checks() -> None:
    assert parent_process_alive(os.getpid()) is True


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
