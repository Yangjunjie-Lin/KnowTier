from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import SecretStr

from cognigraph.config import Settings
from cognigraph.llm.openai_compatible import (
    OpenAICompatibleEmbeddingProvider,
    OpenAICompatibleProvider,
)
from cognigraph.main import create_app


def test_model_configuration_api_masks_and_deletes_session_credential(
    tmp_path: Path,
) -> None:
    profile_path = tmp_path / "profiles.json"
    app = create_app(
        Settings(
            _env_file=None,
            environment="test",
            database_url=f"sqlite+aiosqlite:///{(tmp_path / 'config.db').as_posix()}",
            storage_path=tmp_path / "uploads",
            model_config_path=profile_path,
            use_mock_llm=True,
            neo4j_required=False,
        )
    )
    with TestClient(app) as client:
        baseline = client.get("/v1/model-config")
        assert baseline.status_code == 200
        assert baseline.json()["profiles"][0]["provider"] == "mock"

        created = client.post(
            "/v1/model-config/profiles",
            json={
                "name": "SiliconFlow",
                "provider": "siliconflow",
                "api_key": "integration-secret-key",
                "credential_storage": "session",
                "models": {
                    "teacher": "chat-model",
                    "extractor": "chat-model",
                    "grader": "chat-model",
                    "graph": "chat-model",
                    "vision": "vision-model",
                    "embedding": "embedding-model",
                },
                "timeout_seconds": 20,
                "max_retries": 1,
                "temperature": 0.3,
                "max_tokens": 1024,
            },
        )
        assert created.status_code == 201, created.text
        payload = created.json()
        assert payload["base_url"] == "https://api.siliconflow.cn/v1"
        assert payload["credential_present"] is True
        assert payload["credential_masked"] == "••••••••"
        assert "integration-secret-key" not in created.text
        assert "integration-secret-key" not in profile_path.read_text(encoding="utf-8")
        assert "api_key" not in profile_path.read_text(encoding="utf-8")

        activated = client.post(f"/v1/model-config/profiles/{payload['id']}/activate")
        assert activated.status_code == 200, activated.text
        assert activated.json()["active"] is True
        runtime = app.state.runtime
        assert isinstance(runtime.model_gateway.provider, OpenAICompatibleProvider)
        assert runtime.model_gateway.provider.request_embedding_dimensions is False
        assert runtime.settings.teacher_model == "chat-model"
        assert runtime.ingestion.extractor.gateway is runtime.model_gateway
        assert isinstance(
            runtime.ingestion.embedding_provider,
            OpenAICompatibleEmbeddingProvider,
        )

        deleted = client.delete(f"/v1/model-config/profiles/{payload['id']}/credential")
        assert deleted.status_code == 200
        assert deleted.json()["credential_present"] is False
        assert deleted.json()["credential_masked"] is None
        assert deleted.json()["active"] is False
        assert runtime.settings.use_mock_llm is True

        insecure = client.post(
            "/v1/model-config/profiles",
            json={
                "name": "Insecure remote",
                "provider": "custom_openai_compatible",
                "base_url": "http://models.example/v1",
            },
        )
        assert insecure.status_code == 422
        assert "HTTPS" in insecure.text


def test_production_model_configuration_requires_admin_token(tmp_path: Path) -> None:
    app = create_app(
        Settings(
            _env_file=None,
            environment="production",
            database_url=f"sqlite+aiosqlite:///{(tmp_path / 'production.db').as_posix()}",
            storage_path=tmp_path / "uploads",
            model_config_path=tmp_path / "profiles.json",
            model_configuration_token=SecretStr("admin-session-token"),
            use_mock_llm=True,
            neo4j_required=False,
        )
    )
    with TestClient(app) as client:
        denied = client.get("/v1/model-config")
        assert denied.status_code == 401
        allowed = client.get(
            "/v1/model-config",
            headers={"X-Model-Configuration-Token": "admin-session-token"},
        )
        assert allowed.status_code == 200
        assert "admin-session-token" not in allowed.text
