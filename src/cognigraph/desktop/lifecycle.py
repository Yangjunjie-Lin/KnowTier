from __future__ import annotations

import asyncio
import errno
import os
import sys
from collections.abc import Callable

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

PARENT_PID_ENV = "KNOWTIER_DESKTOP_PARENT_PID"


def parent_process_alive(process_id: int) -> bool:
    if process_id <= 0:
        return False
    if sys.platform == "win32":
        return _windows_process_alive(process_id)
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError as error:
        return error.errno == errno.EPERM
    return True


if sys.platform == "win32":

    def _windows_process_alive(process_id: int) -> bool:
        synchronize = 0x00100000
        process_query_limited_information = 0x1000
        wait_timeout = 0x00000102
        wait_failed = 0xFFFFFFFF
        error_access_denied = 5
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        open_process = kernel32.OpenProcess
        open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        open_process.restype = wintypes.HANDLE
        wait_for_single_object = kernel32.WaitForSingleObject
        wait_for_single_object.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        wait_for_single_object.restype = wintypes.DWORD
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = [wintypes.HANDLE]
        close_handle.restype = wintypes.BOOL

        handle = open_process(
            synchronize | process_query_limited_information,
            False,
            process_id,
        )
        if not handle:
            return ctypes.get_last_error() == error_access_denied
        try:
            result = int(wait_for_single_object(handle, 0))
            return result in {wait_timeout, wait_failed}
        finally:
            close_handle(handle)

else:

    def _windows_process_alive(process_id: int) -> bool:
        raise RuntimeError(f"Windows process probing is unavailable for process {process_id}")


async def watch_parent_process(
    process_id: int,
    stop_event: asyncio.Event,
    *,
    interval_seconds: float = 1.0,
    is_alive: Callable[[int], bool] = parent_process_alive,
) -> None:
    """Request shutdown when the native parent disappears."""

    if interval_seconds <= 0:
        raise ValueError("parent watchdog interval must be positive")
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            if not is_alive(process_id):
                stop_event.set()
                return


def parse_parent_pid(raw_value: str | None) -> int:
    if raw_value is None:
        raise RuntimeError(f"required desktop environment variable is missing: {PARENT_PID_ENV}")
    try:
        process_id = int(raw_value)
    except ValueError as error:
        raise RuntimeError("desktop parent process ID is invalid") from error
    if process_id <= 0 or process_id == os.getpid():
        raise RuntimeError("desktop parent process ID must identify another live process")
    return process_id
