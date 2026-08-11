from __future__ import annotations

import struct

import pytest

from scripts.desktop.check_windows_gui import pe_subsystem


def _pe_binary(subsystem: int) -> bytes:
    binary = bytearray(256)
    binary[:2] = b"MZ"
    pe_offset = 0x40
    struct.pack_into("<I", binary, 0x3C, pe_offset)
    binary[pe_offset : pe_offset + 4] = b"PE\0\0"
    optional_header = pe_offset + 4 + 20
    struct.pack_into("<H", binary, optional_header, 0x20B)
    struct.pack_into("<H", binary, optional_header + 68, subsystem)
    return bytes(binary)


def test_pe_subsystem_reads_gui_and_console_binaries() -> None:
    assert pe_subsystem(_pe_binary(2)) == 2
    assert pe_subsystem(_pe_binary(3)) == 3


def test_pe_subsystem_rejects_non_pe_input() -> None:
    with pytest.raises(ValueError, match="missing DOS header"):
        pe_subsystem(b"not a PE file")
