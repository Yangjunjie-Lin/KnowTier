from __future__ import annotations

import asyncio
import io
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from reportlab.pdfgen import canvas

pytestmark = [pytest.mark.e2e, pytest.mark.postgres, pytest.mark.neo4j]


def _sample_pdf() -> bytes:
    stream = io.BytesIO()
    document = canvas.Canvas(stream)
    document.drawString(72, 760, "A source-grounded production smoke test.")
    document.drawString(72, 740, "A claim needs evidence before it becomes authoritative.")
    document.save()
    return stream.getvalue()


@pytest.mark.skipif(
    os.getenv("COGNIGRAPH_RUN_PRODUCTION_E2E") != "1",
    reason="set COGNIGRAPH_RUN_PRODUCTION_E2E=1 with live PostgreSQL and Neo4j",
)
async def test_production_api_workflow_survives_graph_and_learner_updates() -> None:
    base_url = os.getenv("COGNIGRAPH_E2E_BASE_URL", "http://127.0.0.1:8000")
    timeout = httpx.Timeout(20.0, connect=5.0)
    # Production smoke targets a loopback service. Ignore workstation proxy
    # settings so a system HTTP proxy cannot intercept or reject localhost.
    async with httpx.AsyncClient(base_url=base_url, timeout=timeout, trust_env=False) as client:
        ready = await client.get("/ready")
        assert ready.status_code == 200, ready.text

        provisioning_token = os.getenv("COGNIGRAPH_E2E_PROVISIONING_TOKEN")
        if provisioning_token:
            anonymous = await client.post(
                "/v1/workspaces",
                json={"name": "Blocked", "slug": f"blocked-{uuid4().hex[:8]}"},
            )
            assert anonymous.status_code == 401, anonymous.text
        workspace_response = await client.post(
            "/v1/workspaces",
            headers=(
                {"X-Workspace-Provisioning-Token": provisioning_token}
                if provisioning_token
                else None
            ),
            json={"name": "Production smoke", "slug": f"production-smoke-{uuid4().hex[:8]}"},
        )
        assert workspace_response.status_code == 201, workspace_response.text
        workspace_id = workspace_response.json()["id"]
        client.headers["X-Workspace-ID"] = workspace_id
        learner_response = await client.post(
            "/v1/learners",
            json={"workspace_id": workspace_id, "display_name": "Smoke learner"},
        )
        assert learner_response.status_code == 201, learner_response.text
        learner_id = learner_response.json()["id"]

        upload = await client.post(
            f"/v1/workspaces/{workspace_id}/documents",
            files={"file": ("smoke.pdf", _sample_pdf(), "application/pdf")},
        )
        assert upload.status_code == 201, upload.text
        document_id = upload.json()["id"]
        ingested = await client.post(f"/v1/documents/{document_id}/ingest")
        assert ingested.status_code == 200, ingested.text
        graph_revision_id = ingested.json()["graph_revision_id"]
        assert graph_revision_id

        revision = None
        for _ in range(30):
            response = await client.get(
                f"/v1/graph/revisions/{graph_revision_id}",
                params={"workspace_id": workspace_id},
            )
            if response.status_code == 200 and response.json()["projection_status"] == "PROJECTED":
                revision = response.json()
                break
            await asyncio.sleep(1)
        assert revision is not None
        assert revision["id"] == graph_revision_id

        manifest = None
        for _ in range(30):
            response = await client.get("/v1/graph/manifest", params={"workspace_id": workspace_id})
            if (
                response.status_code == 200
                and response.json().get("graph_revision_id") == graph_revision_id
            ):
                manifest = response.json()
                break
            await asyncio.sleep(1)
        assert manifest is not None

        cytoscape: dict[str, object] | None = None
        for format_name in ("cytoscape", "jsonld", "turtle"):
            exported = await client.get(
                "/v1/graph/export",
                params={"workspace_id": workspace_id, "format": format_name},
            )
            assert exported.status_code == 200, exported.text
            if format_name == "cytoscape":
                cytoscape = exported.json()
        assert cytoscape is not None
        elements = cytoscape["elements"]
        assert isinstance(elements, dict)
        nodes = elements["nodes"]
        edges = elements["edges"]
        assert isinstance(nodes, list) and nodes
        assert isinstance(edges, list) and edges
        node_id = nodes[0]["data"]["id"]
        assertion_id = edges[0]["data"]["assertion_id"]

        node = await client.get(
            f"/v1/graph/nodes/{node_id}",
            params={"workspace_id": workspace_id},
        )
        assert node.status_code == 200, node.text
        assert node.json()["graph_revision_id"] == graph_revision_id
        assertion = await client.get(
            f"/v1/graph/assertions/{assertion_id}",
            params={"workspace_id": workspace_id},
        )
        assert assertion.status_code == 200, assertion.text
        assert assertion.json()["graph_revision_id"] == graph_revision_id

        session_id = str(uuid4())
        for message in (
            "Teach me the central claim.",
            "I think evidence is optional.",
            "Now explain when that claim could fail.",
        ):
            response = await client.post(
                "/v1/chat",
                json={
                    "workspace_id": workspace_id,
                    "learner_id": learner_id,
                    "session_id": session_id,
                    "message": message,
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["learner_graph_update"]["revision_id"]

        domain_revisions = await client.get(
            "/v1/graph/revisions",
            params={"workspace_id": workspace_id},
        )
        assert domain_revisions.status_code == 200, domain_revisions.text
        # Chat may create a newer domain revision when the graph-model proposal
        # is accepted. The ingestion revision must remain present and auditable,
        # but it is not required to remain the latest revision forever.
        domain_revision_ids = {item["id"] for item in domain_revisions.json()["items"]}
        assert graph_revision_id in domain_revision_ids

        learner_graph = await client.get(f"/v1/learners/{learner_id}/knowledge-graph")
        assert learner_graph.status_code == 200, learner_graph.text
        learner_edges = learner_graph.json()["elements"]["edges"]
        assert learner_edges
        learner_assertion_id = learner_edges[0]["data"]["assertion_id"]
        learner_assertion = await client.get(
            f"/v1/learners/{learner_id}/graph/assertions/{learner_assertion_id}"
        )
        assert learner_assertion.status_code == 200, learner_assertion.text
        revisions = await client.get(f"/v1/learners/{learner_id}/graph/revisions")
        assert revisions.status_code == 200, revisions.text
        assert len(revisions.json()["items"]) >= 3
        learner_revision_id = revisions.json()["items"][0]["id"]

        state_path = os.getenv("COGNIGRAPH_E2E_STATE_PATH")
        if state_path:
            state_payload = json.dumps(
                {
                    "workspace_id": workspace_id,
                    "learner_id": learner_id,
                    "graph_revision_id": graph_revision_id,
                    "node_id": node_id,
                    "assertion_id": assertion_id,
                    "learner_revision_id": learner_revision_id,
                    "learner_assertion_id": learner_assertion_id,
                },
                sort_keys=True,
            )
            await asyncio.to_thread(Path(state_path).write_text, state_payload, encoding="utf-8")


@pytest.mark.skipif(
    os.getenv("COGNIGRAPH_VERIFY_PRODUCTION_RECOVERY") != "1",
    reason="set COGNIGRAPH_VERIFY_PRODUCTION_RECOVERY=1 after restarting the production API",
)
async def test_production_api_recovery_after_restart() -> None:
    state_path = Path(os.getenv("COGNIGRAPH_E2E_STATE_PATH", "production-e2e-state.json"))
    state = json.loads(await asyncio.to_thread(state_path.read_text, encoding="utf-8"))
    base_url = os.getenv("COGNIGRAPH_E2E_BASE_URL", "http://127.0.0.1:8000")
    async with httpx.AsyncClient(base_url=base_url, timeout=20.0, trust_env=False) as client:
        ready = await client.get("/ready")
        assert ready.status_code == 200, ready.text
        client.headers["X-Workspace-ID"] = state["workspace_id"]

        revision = await client.get(
            f"/v1/graph/revisions/{state['graph_revision_id']}",
            params={"workspace_id": state["workspace_id"]},
        )
        assert revision.status_code == 200, revision.text
        assert revision.json()["projection_status"] == "PROJECTED"

        node = await client.get(
            f"/v1/graph/nodes/{state['node_id']}",
            params={"workspace_id": state["workspace_id"]},
        )
        assertion = await client.get(
            f"/v1/graph/assertions/{state['assertion_id']}",
            params={"workspace_id": state["workspace_id"]},
        )
        assert node.status_code == 200, node.text
        assert assertion.status_code == 200, assertion.text

        learner_revision = await client.get(
            f"/v1/learners/{state['learner_id']}/graph/revisions/{state['learner_revision_id']}"
        )
        learner_assertion = await client.get(
            f"/v1/learners/{state['learner_id']}/graph/assertions/{state['learner_assertion_id']}"
        )
        assert learner_revision.status_code == 200, learner_revision.text
        assert learner_assertion.status_code == 200, learner_assertion.text

        for format_name in ("cytoscape", "jsonld", "turtle"):
            exported = await client.get(
                "/v1/graph/export",
                params={"workspace_id": state["workspace_id"], "format": format_name},
            )
            assert exported.status_code == 200, exported.text
