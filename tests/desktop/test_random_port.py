from __future__ import annotations

import io
import sys

from cognigraph.desktop.sidecar import (
    PORT_ANNOUNCEMENT_PREFIX,
    announce_port,
    bind_loopback_socket,
)


def test_sidecar_owns_random_port_before_announcing_it(monkeypatch) -> None:
    output = io.StringIO()
    monkeypatch.setattr(sys, "stdout", output)
    listener = bind_loopback_socket()
    try:
        host, port = listener.getsockname()[:2]
        announce_port(int(port))
    finally:
        listener.close()

    assert host == "127.0.0.1"
    assert 1024 <= port <= 65535
    assert output.getvalue() == f"{PORT_ANNOUNCEMENT_PREFIX}{port}\n"
