from __future__ import annotations

from pathlib import Path

import pytest

from cognigraph.desktop.instance import DesktopInstanceError, DesktopInstanceLock


def test_data_directory_lock_excludes_a_second_sidecar(tmp_path: Path) -> None:
    lock_path = tmp_path / "desktop.instance.lock"
    first = DesktopInstanceLock(lock_path)
    second = DesktopInstanceLock(lock_path)

    first.acquire()
    try:
        with pytest.raises(DesktopInstanceError):
            second.acquire()
    finally:
        first.release()

    second.acquire()
    second.release()
