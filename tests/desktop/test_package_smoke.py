from __future__ import annotations

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
