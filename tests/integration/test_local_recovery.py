from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.graph.query_tools import SupportingSourcesParams
from cognigraph.main import create_app


@pytest.mark.integration
def test_local_recovery_lists_are_bounded_scoped_and_hide_internal_documents(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "local-recovery.db"
    app = create_app(
        Settings(
            environment="development",
            workspace_scope_required=False,
            database_url=f"sqlite+aiosqlite:///{database_path.as_posix()}",
            storage_path=tmp_path / "uploads",
            use_mock_llm=True,
            neo4j_required=False,
            outbox_worker_enabled=False,
        )
    )

    with TestClient(app) as client:
        workspace_a = _create_workspace(client, "Data Structures")
        workspace_b = _create_workspace(client, "Operating Systems")

        first_page = client.get("/v1/workspaces", params={"limit": 1, "offset": 0})
        assert first_page.status_code == 200, first_page.text
        assert len(first_page.json()["items"]) == 1
        assert first_page.json()["next_offset"] == 1
        second_page = client.get("/v1/workspaces", params={"limit": 1, "offset": 1})
        assert second_page.status_code == 200, second_page.text
        assert len(second_page.json()["items"]) == 1

        scoped_workspace_list = client.get(
            "/v1/workspaces",
            headers={"X-Workspace-ID": workspace_a},
        )
        assert [item["id"] for item in scoped_workspace_list.json()["items"]] == [workspace_a]

        learner_a = _create_learner(client, workspace_a, "Alex")
        learner_b = _create_learner(client, workspace_a, "Sam")
        _create_learner(client, workspace_b, "Taylor")
        learner_page = client.get(
            f"/v1/workspaces/{workspace_a}/learners",
            params={"limit": 1},
        )
        assert learner_page.status_code == 200, learner_page.text
        assert len(learner_page.json()["items"]) == 1
        assert learner_page.json()["next_offset"] == 1
        assert (
            client.get(
                f"/v1/workspaces/{workspace_a}/learners",
                headers={"X-Workspace-ID": workspace_b},
            ).status_code
            == 403
        )

        uploaded = client.post(
            f"/v1/workspaces/{workspace_a}/documents",
            files={"file": ("lesson.txt", b"A user-managed lesson.", "text/plain")},
        )
        assert uploaded.status_code == 201, uploaded.text
        user_document_id = uploaded.json()["id"]

        internal_prompt = "Teach me the invariant behind a red-black tree rotation."
        chat = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_a,
                "learner_id": learner_a,
                "session_id": str(uuid4()),
                "message": internal_prompt,
                "requested_mode": "learn",
            },
        )
        assert chat.status_code == 200, chat.text
        assert chat.json()["sources"] == []
        internal_node_id = chat.json()["target_knowledge_point"]["id"]

        node_detail = client.get(
            f"/v1/graph/nodes/{internal_node_id}",
            params={"workspace_id": workspace_a},
            headers={"X-Workspace-ID": workspace_a},
        )
        assert node_detail.status_code == 200, node_detail.text
        assert node_detail.json()["data"]["sources"] == []

        subgraph = client.get(
            "/v1/graph/subgraph",
            params={"workspace_id": workspace_a, "node_id": internal_node_id},
            headers={"X-Workspace-ID": workspace_a},
        )
        assert subgraph.status_code == 200, subgraph.text
        assertions = subgraph.json()["data"]["assertions"]
        assert assertions
        assertion_detail = client.get(
            f"/v1/graph/assertions/{assertions[0]['id']}",
            params={"workspace_id": workspace_a},
            headers={"X-Workspace-ID": workspace_a},
        )
        assert assertion_detail.status_code == 200, assertion_detail.text
        assert assertion_detail.json()["data"]["sources"] == []

        exported_graph = client.get(
            "/v1/graph/export",
            params={"workspace_id": workspace_a, "format": "cytoscape"},
            headers={"X-Workspace-ID": workspace_a},
        )
        assert exported_graph.status_code == 200, exported_graph.text
        assert "chat-input.txt" not in exported_graph.text
        assert internal_prompt not in exported_graph.text

        tool_sources = client.app.state.runtime.graph_queries.get_supporting_sources(
            SupportingSourcesParams(
                workspace_id=UUID(workspace_a),
                entity_id=UUID(internal_node_id),
            )
        )
        assert tool_sources.data["items"] == []

        with sqlite3.connect(database_path) as connection:
            raw_internal_id = connection.execute(
                "SELECT id FROM documents WHERE origin = 'INTERNAL_CHAT'"
            ).fetchone()
        assert raw_internal_id is not None
        internal_document_id = str(UUID(str(raw_internal_id[0])))

        documents = client.get(f"/v1/workspaces/{workspace_a}/documents")
        assert documents.status_code == 200, documents.text
        assert [item["id"] for item in documents.json()["items"]] == [user_document_id]
        assert all(item["filename"] != "chat-input.txt" for item in documents.json()["items"])
        internal_document_requests = [
            ("GET", f"/v1/documents/{internal_document_id}"),
            ("POST", f"/v1/documents/{internal_document_id}/ingest"),
            ("GET", f"/v1/documents/{internal_document_id}/chunks"),
            ("GET", f"/v1/documents/{internal_document_id}/extracted-knowledge"),
        ]
        for method, path in internal_document_requests:
            response = client.request(
                method,
                path,
                headers={"X-Workspace-ID": workspace_a},
            )
            assert response.status_code == 404, f"{method} {path}: {response.text}"

        for search_term in ("chat-input", "red-black"):
            search = client.get(
                "/v1/search",
                params={
                    "workspace_id": workspace_a,
                    "learner_id": learner_b,
                    "q": search_term,
                },
                headers={"X-Workspace-ID": workspace_a},
            )
            assert search.status_code == 200, search.text
            assert all(
                item["kind"] not in {"material", "material_content"}
                for item in search.json()["items"]
            )

        hidden_attachment = client.post(
            "/v1/chat",
            headers={"X-Workspace-ID": workspace_a},
            json={
                "workspace_id": workspace_a,
                "learner_id": learner_b,
                "session_id": str(uuid4()),
                "message": "Use the selected material.",
                "attachment_ids": [internal_document_id],
                "requested_mode": "learn",
            },
        )
        assert hidden_attachment.status_code == 404, hidden_attachment.text
        assert (
            client.get(
                f"/v1/workspaces/{workspace_a}/documents",
                headers={"X-Workspace-ID": workspace_b},
            ).status_code
            == 403
        )

        promoted = client.post(
            f"/v1/workspaces/{workspace_a}/documents",
            files={
                "file": (
                    "my-red-black-tree-note.txt",
                    internal_prompt.encode("utf-8"),
                    "text/plain",
                )
            },
        )
        assert promoted.status_code == 201, promoted.text
        assert promoted.json()["id"] == internal_document_id
        assert promoted.json()["filename"] == "my-red-black-tree-note.txt"
        assert (
            client.get(
                f"/v1/documents/{internal_document_id}",
                headers={"X-Workspace-ID": workspace_a},
            ).status_code
            == 200
        )
        visible_ids = {
            item["id"]
            for item in client.get(f"/v1/workspaces/{workspace_a}/documents").json()["items"]
        }
        assert visible_ids == {user_document_id, internal_document_id}

    with sqlite3.connect(database_path) as connection:
        promoted_row = connection.execute(
            "SELECT filename, origin FROM documents WHERE id = ?",
            (UUID(internal_document_id).hex,),
        ).fetchone()
    assert promoted_row == ("my-red-black-tree-note.txt", "USER_UPLOAD")


@pytest.mark.integration
def test_workspace_discovery_rejects_non_local_unscoped_environments(tmp_path: Path) -> None:
    app = create_app(
        Settings(
            environment="staging",
            workspace_scope_required=False,
            database_url=f"sqlite+aiosqlite:///{(tmp_path / 'staging.db').as_posix()}",
            storage_path=tmp_path / "staging-uploads",
            use_mock_llm=True,
            neo4j_required=False,
            outbox_worker_enabled=False,
        )
    )
    with TestClient(app) as client:
        workspace_id = _create_workspace(client, "Staging Topic")
        anonymous = client.get("/v1/workspaces")
        assert anonymous.status_code == 403
        scoped = client.get(
            "/v1/workspaces",
            headers={"X-Workspace-ID": workspace_id},
        )
        assert scoped.status_code == 200, scoped.text
        assert [item["id"] for item in scoped.json()["items"]] == [workspace_id]


def _create_workspace(client: TestClient, name: str) -> str:
    response = client.post(
        "/v1/workspaces",
        json={"name": name, "slug": f"{name.casefold().replace(' ', '-')}-{uuid4().hex[:8]}"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _create_learner(client: TestClient, workspace_id: str, display_name: str) -> str:
    response = client.post(
        "/v1/learners",
        json={"workspace_id": workspace_id, "display_name": display_name},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])
