from __future__ import annotations

import argparse
import struct
from pathlib import Path

PE_SIGNATURE = b"PE\0\0"
WINDOWS_GUI_SUBSYSTEM = 2


def pe_subsystem(binary: bytes) -> int:
    if len(binary) < 0x40 or binary[:2] != b"MZ":
        raise ValueError("not a PE file: missing DOS header")
    pe_offset = struct.unpack_from("<I", binary, 0x3C)[0]
    optional_header = pe_offset + 4 + 20
    if (
        pe_offset + 24 > len(binary)
        or binary[pe_offset : pe_offset + 4] != PE_SIGNATURE
        or optional_header + 70 > len(binary)
    ):
        raise ValueError("not a PE file: invalid NT headers")
    magic = struct.unpack_from("<H", binary, optional_header)[0]
    if magic not in (0x10B, 0x20B):
        raise ValueError(f"unsupported PE optional-header magic: 0x{magic:X}")
    return struct.unpack_from("<H", binary, optional_header + 68)[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="Require a Windows GUI PE subsystem")
    parser.add_argument("binary", type=Path)
    arguments = parser.parse_args()
    subsystem = pe_subsystem(arguments.binary.read_bytes())
    if subsystem != WINDOWS_GUI_SUBSYSTEM:
        raise SystemExit(
            f"{arguments.binary} uses PE subsystem {subsystem}; expected Windows GUI (2)"
        )
    print(f"Windows GUI PE verified: {arguments.binary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
