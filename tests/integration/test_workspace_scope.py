from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from cognigraph.api.dependencies import get_workspace_scope
from cognigraph.config import Settings
from cognigraph.main import create_app
from cognigraph.persistence.postgres.database import Database


@pytest.mark.integration
def test_every_tenant_resource_route_declares_workspace_scope(tmp_path: Path) -> None:
    app = create_app(_production_settings(tmp_path))
    exempt = {("/v1/workspaces", "POST")}
    missing: list[str] = []

    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/v1"):
            continue
        for method in route.methods:
            if method in {"HEAD", "OPTIONS"} or (route.path, method) in exempt:
                continue
            dependency_calls = {
                dependency.call for dependency in _walk_dependencies(route.dependant)
            }
            if get_workspace_scope not in dependency_calls:
                missing.append(f"{method} {route.path}")

    assert missing == []


@pytest.mark.integration
def test_production_scope_header_protocol_and_cross_tenant_isolation(tmp_path: Path) -> None:
    app = create_app(_production_settings(tmp_path))
    with TestClient(app) as client:
        workspace_a = _create_workspace(client, "Tenant A")
        workspace_b = _create_workspace(client, "Tenant B")
        headers_a = _scope_headers(workspace_a)
        headers_b = _scope_headers(workspace_b)

        assert client.get("/v1/workspaces").status_code == 401
        scoped_workspaces = client.get("/v1/workspaces", headers=headers_a)
        assert scoped_workspaces.status_code == 200, scoped_workspaces.text
        assert [item["id"] for item in scoped_workspaces.json()["items"]] == [workspace_a]

        missing_scope = client.post(
            "/v1/learners",
            json={"workspace_id": workspace_a, "display_name": "Learner A"},
        )
        assert missing_scope.status_code == 401
        assert missing_scope.json()["detail"] == "x-workspace-id tenant scope is required"

        malformed_scope = client.post(
            "/v1/learners",
            headers={"X-Workspace-ID": "not-a-uuid"},
            json={"workspace_id": workspace_a, "display_name": "Learner A"},
        )
        assert malformed_scope.status_code == 400
        assert malformed_scope.json()["detail"] == "x-workspace-id must be a UUID"

        mismatched_scope = client.post(
            "/v1/learners",
            headers=headers_b,
            json={"workspace_id": workspace_a, "display_name": "Learner A"},
        )
        assert mismatched_scope.status_code == 403
        assert mismatched_scope.json()["detail"] == "workspace access denied"

        learner = client.post(
            "/v1/learners",
            headers=headers_a,
            json={"workspace_id": workspace_a, "display_name": "Learner A"},
        )
        assert learner.status_code == 201, learner.text
        learner_id = learner.json()["id"]

        upload = client.post(
            f"/v1/workspaces/{workspace_a}/documents",
            headers=headers_a,
            files={
                "file": (
                    "tenant-a.md",
                    b"# Tenant A\n\nA prerequisite is knowledge needed first.",
                    "text/markdown",
                )
            },
        )
        assert upload.status_code == 201, upload.text
        document_id = upload.json()["id"]

        session_id = str(uuid4())
        chat_payload = {
            "workspace_id": workspace_a,
            "learner_id": learner_id,
            "session_id": session_id,
            "message": "Teach me prerequisite knowledge.",
            "requested_mode": "learn",
        }
        assert client.post("/v1/chat", json=chat_payload).status_code == 401
        assert client.post("/v1/chat", headers=headers_b, json=chat_payload).status_code == 403
        chat = client.post("/v1/chat", headers=headers_a, json=chat_payload)
        assert chat.status_code == 200, chat.text
        chat_data = chat.json()
        node_id = chat_data["target_knowledge_point"]["id"]
        learner_revision_id = chat_data["learner_graph_update"]["revision_id"]

        graph_revisions = client.get(
            "/v1/graph/revisions",
            headers=headers_a,
            params={"workspace_id": workspace_a},
        )
        assert graph_revisions.status_code == 200, graph_revisions.text
        graph_revision_id = graph_revisions.json()["items"][0]["id"]
        domain_subgraph = client.get(
            "/v1/graph/subgraph",
            headers=headers_a,
            params={"workspace_id": workspace_a, "node_id": node_id},
        )
        assert domain_subgraph.status_code == 200, domain_subgraph.text
        domain_assertion_id = domain_subgraph.json()["data"]["assertions"][0]["id"]

        learner_graph = client.get(
            f"/v1/learners/{learner_id}/knowledge-graph",
            headers=headers_a,
        )
        assert learner_graph.status_code == 200, learner_graph.text
        assertion_id = learner_graph.json()["elements"]["edges"][0]["data"]["assertion_id"]

        cross_tenant_requests = [
            ("GET", f"/v1/workspaces/{workspace_a}/learners", {}),
            ("GET", f"/v1/workspaces/{workspace_a}/documents", {}),
            (
                "GET",
                f"/v1/workspaces/{workspace_a}/learners/{learner_id}/sessions/{session_id}/turns",
                {},
            ),
            ("GET", f"/v1/learners/{learner_id}", {}),
            ("GET", f"/v1/learners/{learner_id}/model", {}),
            ("GET", f"/v1/learners/{learner_id}/model.csv", {}),
            ("GET", f"/v1/learners/{learner_id}/graph/revisions", {}),
            (
                "GET",
                f"/v1/learners/{learner_id}/graph/revisions/{learner_revision_id}",
                {},
            ),
            (
                "GET",
                f"/v1/learners/{learner_id}/graph/assertions/{assertion_id}",
                {},
            ),
            ("GET", f"/v1/learners/{learner_id}/graph/nodes/{node_id}", {}),
            ("GET", f"/v1/learners/{learner_id}/knowledge-graph", {}),
            ("GET", f"/v1/learners/{learner_id}/learning-path", {}),
            ("GET", f"/v1/learners/{learner_id}/evidence", {}),
            ("POST", f"/v1/documents/{document_id}/ingest", {}),
            ("GET", f"/v1/documents/{document_id}", {}),
            ("GET", f"/v1/documents/{document_id}/chunks", {}),
            ("GET", f"/v1/documents/{document_id}/extracted-knowledge", {}),
            ("GET", "/v1/graph/manifest", {"workspace_id": workspace_a}),
            (
                "GET",
                "/v1/graph/subgraph",
                {"workspace_id": workspace_a, "node_id": node_id},
            ),
            (
                "GET",
                f"/v1/graph/nodes/{node_id}",
                {"workspace_id": workspace_a},
            ),
            (
                "GET",
                f"/v1/graph/assertions/{domain_assertion_id}",
                {"workspace_id": workspace_a},
            ),
            ("GET", "/v1/graph/revisions", {"workspace_id": workspace_a}),
            (
                "GET",
                f"/v1/graph/revisions/{graph_revision_id}",
                {"workspace_id": workspace_a},
            ),
            (
                "GET",
                "/v1/graph/export",
                {"workspace_id": workspace_a, "format": "cytoscape"},
            ),
        ]
        for method, path, params in cross_tenant_requests:
            response = client.request(method, path, headers=headers_b, params=params)
            assert response.status_code == 403, f"{method} {path}: {response.text}"

        cross_tenant_upload = client.post(
            f"/v1/workspaces/{workspace_a}/documents",
            headers=headers_b,
            files={"file": ("blocked.txt", b"tenant B must not write here", "text/plain")},
        )
        assert cross_tenant_upload.status_code == 403

        assert client.get(f"/v1/learners/{learner_id}", headers=headers_a).status_code == 200
        assert client.get(f"/v1/documents/{document_id}", headers=headers_a).status_code == 200
        scoped_learners = client.get(
            f"/v1/workspaces/{workspace_a}/learners",
            headers=headers_a,
        )
        assert scoped_learners.status_code == 200, scoped_learners.text
        assert scoped_learners.json()["items"][0]["id"] == learner_id
        scoped_documents = client.get(
            f"/v1/workspaces/{workspace_a}/documents",
            headers=headers_a,
        )
        assert scoped_documents.status_code == 200, scoped_documents.text
        assert scoped_documents.json()["items"][0]["id"] == document_id
        assert (
            client.get(
                "/v1/graph/manifest",
                headers=headers_a,
                params={"workspace_id": workspace_a},
            ).status_code
            == 200
        )


@pytest.mark.integration
def test_production_rejects_anonymous_workspace_creation(tmp_path: Path) -> None:
    app = create_app(_production_settings(tmp_path))
    with TestClient(app) as client:
        response = client.post(
            "/v1/workspaces",
            json={"name": "Unauthorized", "slug": f"unauthorized-{uuid4().hex[:8]}"},
        )
    assert response.status_code == 401


@pytest.mark.integration
async def test_learner_state_repository_rejects_cross_workspace_owner() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as unit:
            workspace_a = await unit.workspaces.create(name="A", slug=f"a-{uuid4().hex[:8]}")
            workspace_b = await unit.workspaces.create(name="B", slug=f"b-{uuid4().hex[:8]}")
            learner_a = await unit.learners.create(
                workspace_id=workspace_a.id,
                display_name="Learner A",
            )
            with pytest.raises(ValueError, match=r"learner.*workspace"):
                await unit.learner_states.get_or_create(
                    workspace_id=workspace_b.id,
                    learner_id=learner_a.id,
                    knowledge_point_id=uuid4(),
                )
    finally:
        await database.dispose()


@pytest.mark.integration
async def test_session_repository_rejects_cross_workspace_owner() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        async with database.unit_of_work() as unit:
            workspace_a = await unit.workspaces.create(name="A", slug=f"a-{uuid4().hex[:8]}")
            workspace_b = await unit.workspaces.create(name="B", slug=f"b-{uuid4().hex[:8]}")
            learner_a = await unit.learners.create(
                workspace_id=workspace_a.id,
                display_name="Learner A",
            )
            with pytest.raises(ValueError, match=r"learner.*workspace"):
                await unit.sessions.get_or_create(
                    workspace_id=workspace_b.id,
                    learner_id=learner_a.id,
                    session_id=uuid4(),
                )
    finally:
        await database.dispose()


def _production_settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="production",
        workspace_scope_required=True,
        database_url=f"sqlite+aiosqlite:///{(tmp_path / f'{uuid4().hex}.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
        outbox_worker_enabled=False,
        workspace_provisioning_token="test-provisioning-token",
    )


def _create_workspace(client: TestClient, label: str) -> str:
    response = client.post(
        "/v1/workspaces",
        headers={"X-Workspace-Provisioning-Token": "test-provisioning-token"},
        json={"name": label, "slug": f"{label.casefold().replace(' ', '-')}-{uuid4().hex[:8]}"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _scope_headers(workspace_id: str) -> dict[str, str]:
    return {"X-Workspace-ID": workspace_id}


def _walk_dependencies(root: Dependant) -> Iterator[Dependant]:
    for dependency in root.dependencies:
        yield dependency
        yield from _walk_dependencies(dependency)
