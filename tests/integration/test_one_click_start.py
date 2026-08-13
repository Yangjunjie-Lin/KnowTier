from __future__ import annotations

from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _startup_scripts() -> tuple[str, str]:
    powershell = (REPOSITORY_ROOT / "start.ps1").read_text(encoding="utf-8")
    shell = (REPOSITORY_ROOT / "start.sh").read_text(encoding="utf-8")
    return powershell, shell


def test_one_click_start_uses_locked_local_dependencies_and_loopback_services() -> None:
    powershell, shell = _startup_scripts()

    for script in (powershell, shell):
        assert "uv sync --frozen --dev --extra documents" in script
        assert "npm" in script and " ci" in script
        assert "127.0.0.1" in script
        assert "/ready" in script
        assert "COGNIGRAPH_DATABASE_URL" in script
        assert "sqlite+aiosqlite" in script
        assert "COGNIGRAPH_NEO4J_REQUIRED" in script
        assert "COGNIGRAPH_USE_MOCK_LLM" in script
        assert "VITE_DEV_API_PROXY_TARGET" in script
        assert "--reload" not in script

    assert "Start-Process @backendOptions" in powershell
    assert "Stop-Process -Id $backendProcess.Id" in powershell
    assert "$previousEnvironment" in powershell
    assert "[Environment]::SetEnvironmentVariable" in powershell
    assert '"$UV_PROJECT_ENVIRONMENT/bin/uvicorn"' in shell
    assert 'kill -TERM "$BACKEND_PID"' in shell
    assert "trap cleanup EXIT" in shell


def test_one_click_start_isolated_from_persisted_model_profiles_and_credentials() -> None:
    powershell, shell = _startup_scripts()
    provider_keys = (
        "COGNIGRAPH_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "SILICONFLOW_API_KEY",
        "AZURE_API_KEY",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
    )

    for script in (powershell, shell):
        assert "COGNIGRAPH_MODEL_CONFIG_PATH" in script
        assert "knowtier-mock-models" in script
        assert "COGNIGRAPH_USE_MOCK_LLM" in script
        for key in provider_keys:
            assert key in script

    assert '$env:COGNIGRAPH_USE_MOCK_LLM = "true"' in powershell
    assert 'export COGNIGRAPH_USE_MOCK_LLM="true"' in shell
    assert "Remove-Item -LiteralPath $modelConfigPath" in powershell
    assert 'rm -rf -- "$MODEL_CONFIG_DIRECTORY"' in shell
