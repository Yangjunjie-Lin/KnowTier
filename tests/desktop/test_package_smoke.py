from __future__ import annotations

from scripts.desktop.smoke_package import _command_executable_name


def test_command_executable_name_ignores_sidecar_name_arguments() -> None:
    sidecar_name = "cognigraph-desktop-sidecar-x86_64-unknown-linux-gnu"

    assert (
        _command_executable_name(f"/usr/bin/python smoke_package.py --sidecar-name {sidecar_name}")
        == "python"
    )
    assert _command_executable_name(f"/tmp/KnowTier/usr/bin/{sidecar_name}") == sidecar_name
    assert _command_executable_name("'unterminated") is None
