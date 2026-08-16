from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.main import create_app


@pytest.mark.integration
def test_conversation_history_is_safe_complete_and_owner_scoped(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'history.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
        outbox_worker_enabled=False,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        workspace = client.post(
            "/v1/workspaces",
            json={"name": "History Workspace", "slug": f"history-{uuid4().hex[:8]}"},
        ).json()
        other_workspace = client.post(
            "/v1/workspaces",
            json={"name": "Other Workspace", "slug": f"other-{uuid4().hex[:8]}"},
        ).json()
        learner = client.post(
            "/v1/learners",
            json={"workspace_id": workspace["id"], "display_name": "History Learner"},
        ).json()
        other_learner = client.post(
            "/v1/learners",
            json={"workspace_id": workspace["id"], "display_name": "Other Learner"},
        ).json()
        cross_workspace_learner = client.post(
            "/v1/learners",
            json={
                "workspace_id": other_workspace["id"],
                "display_name": "Cross Workspace Learner",
            },
        ).json()
        uploaded = client.post(
            f"/v1/workspaces/{workspace['id']}/documents",
            files={
                "file": (
                    "history.txt",
                    b"A prerequisite is knowledge needed before a later topic.",
                    "text/plain",
                )
            },
        )
        assert uploaded.status_code == 201, uploaded.text
        attachment_id = uploaded.json()["id"]
        session_id = str(uuid4())
        message = "Teach me prerequisite knowledge from this material."
        chat = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace["id"],
                "learner_id": learner["id"],
                "session_id": session_id,
                "message": message,
                "attachment_ids": [attachment_id],
                "requested_mode": "learn",
            },
        )
        assert chat.status_code == 200, chat.text
        assert chat.json()["sources"]
        assert {source["document_id"] for source in chat.json()["sources"]} == {attachment_id}

        path = (
            f"/v1/workspaces/{workspace['id']}/learners/{learner['id']}/sessions/{session_id}/turns"
        )
        history = client.get(path)
        assert history.status_code == 200, history.text
        payload = history.json()
        assert payload["workspace_id"] == workspace["id"]
        assert payload["learner_id"] == learner["id"]
        assert payload["session_id"] == session_id
        assert payload["turn_limit"] == 200
        assert payload["truncated"] is False
        assert [item["role"] for item in payload["items"]] == ["user", "assistant"]

        user_turn, assistant_turn = payload["items"]
        assert set(user_turn) == {"id", "role", "content", "attachment_ids", "created_at"}
        assert user_turn["content"] == message
        assert user_turn["attachment_ids"] == [attachment_id]
        assert set(assistant_turn) == {"id", "role", "response", "created_at"}
        assert assistant_turn["response"] == chat.json()
        serialized = history.text.casefold()
        assert "metadata_json" not in serialized
        assert "content_hash" not in serialized
        assert "client_request_id" not in serialized
        assert "success_criteria" not in serialized

        wrong_learner_path = (
            f"/v1/workspaces/{workspace['id']}/learners/{other_learner['id']}"
            f"/sessions/{session_id}/turns"
        )
        assert client.get(wrong_learner_path).json()["items"] == []
        wrong_workspace_path = (
            f"/v1/workspaces/{other_workspace['id']}"
            f"/learners/{cross_workspace_learner['id']}/sessions/{session_id}/turns"
        )
        assert client.get(wrong_workspace_path).json()["items"] == []

        new_session_path = (
            f"/v1/workspaces/{workspace['id']}/learners/{learner['id']}/sessions/{uuid4()}/turns"
        )
        empty_history = client.get(new_session_path)
        assert empty_history.status_code == 200
        assert empty_history.json()["items"] == []
