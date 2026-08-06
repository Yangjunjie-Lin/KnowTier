from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.main import create_app


def test_global_search_is_workspace_bounded_and_links_real_records(tmp_path: Path) -> None:
    app = create_app(
        Settings(
            _env_file=None,
            environment="test",
            database_url=f"sqlite+aiosqlite:///{(tmp_path / 'search.db').as_posix()}",
            storage_path=tmp_path / "uploads",
            use_mock_llm=True,
            neo4j_required=False,
        )
    )
    with TestClient(app) as client:
        workspace = client.post(
            "/v1/workspaces",
            json={"name": "Search Workspace", "slug": f"search-{uuid4().hex[:8]}"},
        ).json()
        workspace_id = workspace["id"]
        learner = client.post(
            "/v1/learners",
            json={"workspace_id": workspace_id, "display_name": "Search Learner"},
        ).json()
        learner_id = learner["id"]
        uploaded = client.post(
            f"/v1/workspaces/{workspace_id}/documents",
            files={
                "file": (
                    "bayesian-notes.txt",
                    (
                        b"Conditional probability foundation supports the Bayesian "
                        b"updating target. Bayesian updating combines prior and likelihood "
                        b"evidence."
                    ),
                    "text/plain",
                )
            },
        )
        assert uploaded.status_code == 201, uploaded.text
        document_id = uploaded.json()["id"]
        ingested = client.post(f"/v1/documents/{document_id}/ingest")
        assert ingested.status_code == 200, ingested.text
        assert ingested.json()["knowledge_point_count"] > 0, ingested.text
        extracted = client.get(f"/v1/documents/{document_id}/extracted-knowledge")
        assert extracted.status_code == 200, extracted.text
        knowledge_point_name = extracted.json()["blueprint"]["knowledge_points"][0][
            "canonical_name"
        ]
        taught = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_id,
                "learner_id": learner_id,
                "session_id": str(uuid4()),
                "message": f"Teach me {knowledge_point_name}.",
                "requested_mode": "learn",
            },
        )
        assert taught.status_code == 200, taught.text

        result = client.get(
            "/v1/search",
            params={
                "workspace_id": workspace_id,
                "learner_id": learner_id,
                "q": "Bayesian",
            },
        )
        assert result.status_code == 200, result.text
        payload = result.json()
        kinds = {item["kind"] for item in payload["items"]}
        assert "material" in kinds
        assert "material_content" in kinds
        assert all(item["path"].startswith("/") for item in payload["items"])
        assert all("{" not in item["description"] for item in payload["items"])

        learner_result = client.get(
            "/v1/search",
            params={
                "workspace_id": workspace_id,
                "learner_id": learner_id,
                "q": knowledge_point_name,
            },
        )
        assert learner_result.status_code == 200, learner_result.text
        learner_kinds = {item["kind"] for item in learner_result.json()["items"]}
        assert "knowledge" in learner_kinds
        assert "learner_state" in learner_kinds

        escaped = client.get(
            "/v1/search",
            params={"workspace_id": workspace_id, "q": "%_"},
        )
        assert escaped.status_code == 200
        assert escaped.json()["items"] == []

        denied = client.get(
            "/v1/search",
            params={"workspace_id": workspace_id, "q": "Bayesian"},
            headers={"X-Workspace-ID": str(uuid4())},
        )
        assert denied.status_code == 403
