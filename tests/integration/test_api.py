from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.main import create_app


def test_api_chat_graph_and_learner_exports(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'api.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        ready = client.get("/ready")
        assert ready.status_code == 200
        assert ready.json() == {"postgres": True, "neo4j": True, "ready": True}

        workspace = client.post(
            "/v1/workspaces",
            json={"name": "API Workspace", "slug": f"api-{uuid4().hex[:8]}"},
        )
        assert workspace.status_code == 201, workspace.text
        workspace_id = workspace.json()["id"]
        learner = client.post(
            "/v1/learners",
            json={"workspace_id": workspace_id, "display_name": "API Learner"},
        )
        assert learner.status_code == 201, learner.text
        learner_id = learner.json()["id"]
        session_id = str(uuid4())

        first = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_id,
                "learner_id": learner_id,
                "session_id": session_id,
                "message": "Teach me prerequisite knowledge.",
                "requested_mode": "learn",
            },
        )
        assert first.status_code == 200, first.text
        first_payload = first.json()
        assert first_payload["cognitive_level"] == 1
        assert first_payload["graph_update"]["revision_id"]
        node_id = first_payload["target_knowledge_point"]["id"]

        partial = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_id,
                "learner_id": learner_id,
                "session_id": session_id,
                "message": "It is needed first, but I am not sure why.",
            },
        )
        assert partial.status_code == 200, partial.text
        assert partial.json()["learner_update"]["decision"] == "REQUEST_MORE_EVIDENCE"
        assert partial.json()["teaching_action"] == "GIVE_HINT"

        promoted = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_id,
                "learner_id": learner_id,
                "session_id": session_id,
                "message": "It is required because the later idea depends on it.",
            },
        )
        assert promoted.status_code == 200, promoted.text
        assert promoted.json()["learner_update"]["decision"] == "PROMOTE"
        assert promoted.json()["cognitive_level"] == 2

        manifest = client.get(
            "/v1/graph/manifest",
            params={"workspace_id": workspace_id},
        )
        assert manifest.status_code == 200
        assert manifest.json()["data"]["knowledge_point_count"] == 1
        assert set(manifest.json()["data"]) >= {
            "top_level_domains",
            "theories",
            "major_clusters",
        }

        node = client.get(
            f"/v1/graph/nodes/{node_id}",
            params={"workspace_id": workspace_id},
        )
        assert node.status_code == 200, node.text
        assert len(node.json()["data"]["learning_stages"]) == 6

        subgraph = client.get(
            "/v1/graph/subgraph",
            params={"workspace_id": workspace_id, "node_id": node_id},
        )
        assert subgraph.status_code == 200
        assertions = subgraph.json()["data"]["assertions"]
        assert assertions
        assertion_id = assertions[0]["id"]
        assertion = client.get(
            f"/v1/graph/assertions/{assertion_id}",
            params={"workspace_id": workspace_id},
        )
        assert assertion.status_code == 200, assertion.text
        assert assertion.json()["data"]["sources"] == []

        revisions = client.get(
            "/v1/graph/revisions",
            params={"workspace_id": workspace_id},
        )
        assert revisions.status_code == 200
        assert len(revisions.json()["items"]) == 1
        revision_id = revisions.json()["items"][0]["id"]
        scoped_revision = client.get(
            f"/v1/graph/revisions/{revision_id}",
            params={"workspace_id": str(uuid4())},
        )
        assert scoped_revision.status_code == 404

        missing_workspace_id = str(uuid4())
        missing_manifest = client.get(
            "/v1/graph/manifest",
            params={"workspace_id": missing_workspace_id},
        )
        assert missing_manifest.status_code == 404
        missing_export = client.get(
            "/v1/graph/export",
            params={"workspace_id": missing_workspace_id, "format": "cytoscape"},
        )
        assert missing_export.status_code == 404

        for export_format in ("cytoscape", "jsonld", "turtle"):
            exported = client.get(
                "/v1/graph/export",
                params={"workspace_id": workspace_id, "format": export_format},
            )
            assert exported.status_code == 200, exported.text
        cytoscape = client.get(
            "/v1/graph/export",
            params={"workspace_id": workspace_id, "format": "cytoscape"},
        ).json()
        assert cytoscape["elements"]["edges"][0]["data"]["assertion_id"]

        model = client.get(f"/v1/learners/{learner_id}/model")
        assert model.status_code == 200
        assert model.json()["items"][0]["current_level"] == 2
        csv_response = client.get(f"/v1/learners/{learner_id}/model.csv")
        assert csv_response.status_code == 200
        assert "knowledge_point,current_level" in csv_response.text
        learner_graph = client.get(f"/v1/learners/{learner_id}/knowledge-graph")
        assert learner_graph.status_code == 200
        assert learner_graph.json()["meta"]["projection"] == "learner-state-only"
        evidence = client.get(f"/v1/learners/{learner_id}/evidence")
        assert evidence.status_code == 200
        assert len(evidence.json()["items"]) == 2


def test_document_upload_ingest_and_query_api(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'documents.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        workspace = client.post(
            "/v1/workspaces",
            json={"name": "Document Workspace", "slug": f"docs-{uuid4().hex[:8]}"},
        ).json()
        uploaded = client.post(
            f"/v1/workspaces/{workspace['id']}/documents",
            files={
                "file": (
                    "lesson.md",
                    b"# Dependency\n\nA prerequisite is knowledge needed first.",
                    "text/markdown",
                )
            },
        )
        assert uploaded.status_code == 201, uploaded.text
        document_id = uploaded.json()["id"]
        ingested = client.post(f"/v1/documents/{document_id}/ingest")
        assert ingested.status_code == 200, ingested.text
        assert ingested.json()["chunk_count"] == 1
        detail = client.get(f"/v1/documents/{document_id}")
        assert detail.json()["status"] == "INGESTED"
        chunks = client.get(f"/v1/documents/{document_id}/chunks")
        assert chunks.status_code == 200
        assert chunks.json()["items"]
        extracted = client.get(f"/v1/documents/{document_id}/extracted-knowledge")
        assert extracted.status_code == 200
        assert extracted.json()["blueprint"]["knowledge_points"]
