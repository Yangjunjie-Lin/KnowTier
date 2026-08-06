from __future__ import annotations

import os
import sys
from pathlib import Path
from types import TracebackType
from typing import BinaryIO

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl


class DesktopInstanceError(RuntimeError):
    """Raised when another sidecar already owns the desktop data directory."""


class DesktopInstanceLock:
    """Hold a non-blocking OS lock for the complete sidecar lifetime."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._stream: BinaryIO | None = None

    def acquire(self) -> None:
        if self._stream is not None:
            raise RuntimeError("desktop instance lock is already acquired")
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        stream = self.path.open("a+b")
        try:
            if sys.platform == "win32":
                stream.seek(0, os.SEEK_END)
                if stream.tell() == 0:
                    stream.write(b"\0")
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            stream.close()
            raise DesktopInstanceError(
                "another KnowTier desktop instance is using this data directory"
            ) from error
        self._stream = stream

    def release(self) -> None:
        stream = self._stream
        if stream is None:
            return
        try:
            if sys.platform == "win32":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        finally:
            stream.close()
            self._stream = None

    def __enter__(self) -> DesktopInstanceLock:
        self.acquire()
        return self

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.release()
