from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.llm.gateway import ModelGatewayError
from cognigraph.llm.openai_compatible import OpenAICompatibleError
from cognigraph.main import create_app


def _app(tmp_path: Path) -> FastAPI:
    application = create_app(
        Settings(
            _env_file=None,
            environment="test",
            database_url=f"sqlite+aiosqlite:///{(tmp_path / 'errors.db').as_posix()}",
            storage_path=tmp_path / "uploads",
            model_config_path=tmp_path / "profiles.json",
            use_mock_llm=True,
            neo4j_required=False,
        )
    )

    @application.get("/_test/errors/{kind}")
    async def raise_error(kind: str) -> None:
        if kind == "rate-limit":
            raise OpenAICompatibleError("provider rate limit was reached", status_code=429)
        if kind == "timeout":
            raise OpenAICompatibleError("provider request timed out", status_code=408)
        if kind == "model":
            raise OpenAICompatibleError(
                "Embedding model 'chat-only' failed: provider rejected the request or model",
                status_code=400,
            )
        if kind == "gateway-timeout":
            raise ModelGatewayError("structured model call failed after 1 attempts: TimeoutError")
        if kind == "gateway-timeout-cause":
            raise ModelGatewayError(
                "structured model call failed after 1 attempts: OpenAICompatibleError",
                cause=OpenAICompatibleError("provider request timed out", status_code=408),
            )
        if kind == "gateway-rate-limit-cause":
            raise ModelGatewayError(
                "structured model call failed after 1 attempts: OpenAICompatibleError",
                cause=OpenAICompatibleError("provider rate limit was reached", status_code=429),
            )
        if kind == "gateway-schema":
            raise ModelGatewayError(
                "structured model call failed after 1 attempts: ValidationError"
            )
        raise RuntimeError("sensitive internal diagnostic")

    return application


@pytest.mark.integration
def test_provider_and_internal_errors_are_actionable_safe_and_traceable(
    tmp_path: Path,
) -> None:
    with TestClient(_app(tmp_path), raise_server_exceptions=False) as client:
        expected = {
            "rate-limit": (429, "model provider error: provider rate limit was reached"),
            "timeout": (504, "model provider error: provider request timed out"),
            "model": (
                502,
                "model provider error: Embedding model 'chat-only' failed: "
                "provider rejected the request or model",
            ),
            "gateway-timeout": (
                504,
                "model generation timed out; retry or increase the configured timeout",
            ),
            "gateway-timeout-cause": (
                504,
                "model generation timed out; retry or increase the configured timeout",
            ),
            "gateway-rate-limit-cause": (
                429,
                "model provider error: rate limit reached; retry later",
            ),
            "gateway-schema": (
                502,
                "model output failed validation after the configured retries",
            ),
            "internal": (500, "internal server error"),
        }
        for kind, (status_code, detail) in expected.items():
            request_id = f"error-contract-{kind}"
            response = client.get(
                f"/_test/errors/{kind}",
                headers={"X-Request-ID": request_id},
            )
            assert response.status_code == status_code
            assert response.json() == {"detail": detail}
            assert response.headers["X-Request-ID"] == request_id
            assert "sensitive internal diagnostic" not in response.text

        generated = client.get("/_test/errors/internal")
        assert generated.status_code == 500
        assert UUID(generated.headers["X-Request-ID"])
