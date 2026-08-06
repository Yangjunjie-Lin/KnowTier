from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from cognigraph.desktop.lifecycle import PARENT_PID_ENV
from cognigraph.desktop.security import BOOTSTRAP_TOKEN_ENV, CONTROL_TOKEN_ENV
from cognigraph.desktop.sidecar import FRONTEND_DIR_ENV, SidecarEnvironment


def test_tokens_are_consumed_from_environment_and_never_rendered(
    tmp_path: Path,
    caplog,
) -> None:
    bootstrap_secret = "bootstrap-" + "a" * 64
    control_secret = "control-" + "b" * 64
    frontend = tmp_path / "dist"
    frontend.mkdir()
    (frontend / "index.html").write_text("desktop", encoding="utf-8")
    environment = {
        BOOTSTRAP_TOKEN_ENV: bootstrap_secret,
        CONTROL_TOKEN_ENV: control_secret,
        PARENT_PID_ENV: str(os.getppid()),
        FRONTEND_DIR_ENV: str(frontend),
    }

    launch = SidecarEnvironment.consume(environment)
    caplog.set_level(logging.INFO)
    logging.getLogger("desktop-token-test").info("verifier=%r", launch.bootstrap_token)

    assert BOOTSTRAP_TOKEN_ENV not in environment
    assert CONTROL_TOKEN_ENV not in environment
    assert bootstrap_secret not in repr(launch)
    assert control_secret not in repr(launch)
    assert bootstrap_secret not in caplog.text
    assert control_secret not in caplog.text
    assert bootstrap_secret not in " ".join(sys.argv)
    assert launch.bootstrap_token.consume_authorization("Bearer wrong") is False
    assert launch.bootstrap_token.consume_authorization(f"Bearer {bootstrap_secret}") is True
    assert launch.bootstrap_token.consume_authorization(f"Bearer {bootstrap_secret}") is False
    assert launch.control_token.matches(control_secret) is True
    assert launch.control_token.matches(control_secret) is True


def test_native_launcher_transports_tokens_only_as_environment_headers() -> None:
    source = (
        Path(__file__).resolve().parents[2] / "frontend" / "src-tauri" / "src" / "main.rs"
    ).read_text(encoding="utf-8")

    assert ".env(BOOTSTRAP_TOKEN_ENV" in source
    assert ".env(CONTROL_TOKEN_ENV" in source
    assert "Authorization: Bearer {token}" in source
    assert ".initialization_script(script)" in source
    assert 'headers.set("Authorization", authorization)' in source
    assert ".env(PORT_ENV" not in source
    assert "window.navigate" not in source
    assert "?token=" not in source.casefold()
    assert ".arg(&setup_bootstrap)" not in source
    assert "KNOWTIER_DESKTOP_BOOTSTRAP_TOKEN=" not in source
