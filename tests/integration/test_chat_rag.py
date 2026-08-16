from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.main import create_app


@pytest.mark.integration
def test_mock_chat_rag_returns_teacher_response(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'chat-rag.db').as_posix()}",
        storage_path=tmp_path / "uploads-chat-rag",
        use_mock_llm=True,
        neo4j_required=False,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        workspace = client.post(
            "/v1/workspaces",
            json={"name": "RAG API", "slug": f"rag-api-{uuid4().hex[:8]}"},
        )
        assert workspace.status_code == 201, workspace.text
        workspace_id = workspace.json()["id"]
        learner = client.post(
            "/v1/learners",
            json={"workspace_id": workspace_id, "display_name": "RAG API learner"},
        )
        assert learner.status_code == 201, learner.text

        session_id = str(uuid4())
        response = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_id,
                "learner_id": learner.json()["id"],
                "session_id": session_id,
                "message": "什么是RAG",
                "requested_mode": "learn",
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["response"]
        assert payload["target_knowledge_point"]["name"] == ("retrieval-augmented generation")
        assert payload["graph_update"]["nodes_added"] == 1
        assert payload["graph_update"]["revision_id"]
        assert payload["learner_graph_update"]["revision_id"]
        assert payload["sources"] == []
        assert "什么是RAG" not in response.text

        runtime = app.state.runtime
        internal_documents = [
            document
            for document in runtime.document_registry.documents.values()
            if document.origin.value == "INTERNAL_CHAT"
        ]
        assert len(internal_documents) == 1
        internal_document = internal_documents[0]
        internal_span = runtime.document_registry.spans[internal_document.id][0]
        snapshot = runtime.graph_applier.store.get_snapshot(UUID(workspace_id))
        target_id = UUID(payload["target_knowledge_point"]["id"])
        legacy_nodes = [
            node.model_copy(update={"source_span_ids": [internal_span.id]})
            if node.id == target_id
            else node
            for node in snapshot.nodes
        ]
        runtime.graph_applier.store.set_snapshot(
            snapshot.model_copy(
                update={
                    "nodes": legacy_nodes,
                    "source_spans": [*snapshot.source_spans, internal_span],
                }
            )
        )

        follow_up = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace_id,
                "learner_id": learner.json()["id"],
                "session_id": session_id,
                "message": "它会先检索相关信息, 再生成回答。",
                "requested_mode": "learn",
            },
        )
        assert follow_up.status_code == 200, follow_up.text
        assert follow_up.json()["sources"] == []
        assert internal_span.text not in follow_up.text


@pytest.mark.integration
def test_failed_chat_retry_reuses_user_turn_and_completed_response(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "chat-idempotency.db"
    app = create_app(
        Settings(
            database_url=f"sqlite+aiosqlite:///{database_path.as_posix()}",
            storage_path=tmp_path / "uploads-idempotency",
            use_mock_llm=True,
            neo4j_required=False,
        )
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        workspace = client.post(
            "/v1/workspaces",
            json={"name": "Idempotency", "slug": f"idempotency-{uuid4().hex[:8]}"},
        ).json()
        learner = client.post(
            "/v1/learners",
            json={
                "workspace_id": workspace["id"],
                "display_name": "Retry learner",
            },
        ).json()
        request_id = str(uuid4())
        payload = {
            "workspace_id": workspace["id"],
            "learner_id": learner["id"],
            "session_id": str(uuid4()),
            "client_request_id": request_id,
            "message": "什么是RAG",
            "requested_mode": "learn",
        }
        embedding_provider = app.state.runtime.ingestion.embedding_provider
        original_embed = embedding_provider.embed
        attempts = 0

        async def fail_first_embedding(texts: list[str]) -> list[list[float]]:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("simulated transient embedding failure")
            return await original_embed(texts)

        monkeypatch.setattr(embedding_provider, "embed", fail_first_embedding)

        first = client.post("/v1/chat", json=payload)
        assert first.status_code == 500
        second = client.post("/v1/chat", json=payload)
        assert second.status_code == 200, second.text

        with sqlite3.connect(database_path) as connection:
            roles = dict(
                connection.execute("select role, count(*) from turns group by role").fetchall()
            )
            model_runs_before_replay = connection.execute(
                "select count(*) from model_runs"
            ).fetchone()[0]
        assert roles == {"assistant": 1, "user": 1}

        replay = client.post("/v1/chat", json=payload)
        assert replay.status_code == 200, replay.text
        assert replay.json() == second.json()
        changed = client.post(
            "/v1/chat",
            json={**payload, "message": "换一个不同的问题"},
        )
        assert changed.status_code == 422
        assert "cannot be reused" in changed.text

        with sqlite3.connect(database_path) as connection:
            roles_after = dict(
                connection.execute("select role, count(*) from turns group by role").fetchall()
            )
            model_runs_after_replay = connection.execute(
                "select count(*) from model_runs"
            ).fetchone()[0]
        assert roles_after == roles
        assert model_runs_after_replay == model_runs_before_replay
