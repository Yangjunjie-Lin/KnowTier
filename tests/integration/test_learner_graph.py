from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from cognigraph.config import Settings
from cognigraph.domain.enums import LearnerRelationType
from cognigraph.domain.learner import LearnerGraphDelta
from cognigraph.main import create_app
from cognigraph.persistence.postgres.database import Database
from cognigraph.persistence.repositories.learner_graph import (
    LearnerGraphRecordValidationError,
    LearnerGraphRevisionConflictError,
)


@pytest.mark.integration
async def test_learner_graph_revisions_are_versioned_and_supersede_relations() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()
    try:
        knowledge_point_id = uuid4()
        async with database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(name="Learner graph", slug="learner-graph")
            learner = await unit.learners.create(workspace_id=workspace.id, display_name="Student")
            session = await unit.sessions.create(workspace_id=workspace.id, learner_id=learner.id)
            user_turn = await unit.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                role="user",
                content="A mistaken explanation.",
            )
            first_turn = await unit.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                role="assistant",
                content="Let us correct that misconception.",
            )
            first = await unit.learner_graph.persist_revision(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                turn_id=first_turn.id,
                assertions=[
                    {
                        "subject_id": learner.id,
                        "predicate": LearnerRelationType.HAS_MISCONCEPTION.value,
                        "object_id": knowledge_point_id,
                        "natural_language_description": (
                            "The learner confuses cause and correlation."
                        ),
                        "confidence": 0.8,
                        "source_turn_id": user_turn.id,
                    }
                ],
                change_summary={"reason": "initial misconception"},
            )
            assert first.sequence_number == 1
            assert first.assertions_added == 1

        async with database.unit_of_work() as unit:
            with pytest.raises(LearnerGraphRecordValidationError, match="unsupported"):
                await unit.learner_graph.persist_revision(
                    workspace_id=workspace.id,
                    learner_id=learner.id,
                    session_id=session.id,
                    turn_id=first_turn.id,
                    assertions=[
                        {
                            "subject_id": learner.id,
                            "predicate": "ARBITRARY_WRITE",
                            "object_id": knowledge_point_id,
                            "natural_language_description": "must be rejected",
                            "confidence": 1.0,
                        }
                    ],
                )
            rejected_turn = await unit.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                role="assistant",
                content="This invalid supersede request must not create a revision.",
            )
            with pytest.raises(LearnerGraphRecordValidationError, match="learner workspace"):
                await unit.learner_graph.persist_revision(
                    workspace_id=workspace.id,
                    learner_id=learner.id,
                    session_id=session.id,
                    turn_id=rejected_turn.id,
                    supersede_assertion_ids=[uuid4()],
                )
            stale_turn = await unit.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                role="assistant",
                content="A stale typed delta must be rejected.",
            )
            with pytest.raises(LearnerGraphRevisionConflictError, match="base revision"):
                await unit.learner_graph.persist_delta(
                    LearnerGraphDelta(
                        workspace_id=workspace.id,
                        learner_id=learner.id,
                        session_id=session.id,
                        turn_id=stale_turn.id,
                        base_revision_id=uuid4(),
                    )
                )
            second_turn = await unit.turns.add(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                role="assistant",
                content="The learner now gives the causal condition.",
            )
            second = await unit.learner_graph.persist_revision(
                workspace_id=workspace.id,
                learner_id=learner.id,
                session_id=session.id,
                turn_id=second_turn.id,
                assertions=[
                    {
                        "subject_id": learner.id,
                        "predicate": LearnerRelationType.HAS_KNOWLEDGE_STATE.value,
                        "object_id": knowledge_point_id,
                        "natural_language_description": "Level two with corrected reasoning.",
                        "confidence": 0.9,
                    }
                ],
                replace_keys=[
                    (
                        LearnerRelationType.HAS_MISCONCEPTION.value,
                        learner.id,
                        knowledge_point_id,
                    )
                ],
                change_summary={"reason": "correction"},
            )
            assert second.sequence_number == 2
            assert second.assertions_added == 1
            assert second.assertions_superseded == 1

        async with database.unit_of_work() as unit:
            revisions = await unit.learner_graph.list_revisions(learner.id)
            assertions = await unit.learner_graph.list_assertions(learner.id, active_only=False)
            active = await unit.learner_graph.list_assertions(learner.id, active_only=True)
        assert [item.sequence_number for item in revisions] == [2, 1]
        misconception = next(
            item
            for item in assertions
            if item.predicate == LearnerRelationType.HAS_MISCONCEPTION.value
        )
        assert misconception.valid_to is not None
        assert misconception.superseded_at is not None
        assert all(item.predicate != LearnerRelationType.HAS_MISCONCEPTION.value for item in active)
    finally:
        await database.dispose()


@pytest.mark.integration
def test_learner_graph_api_exposes_revision_and_clickable_assertion_details(
    tmp_path: Path,
) -> None:
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'learner-graph.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        workspace = client.post(
            "/v1/workspaces",
            json={"name": "Learner API", "slug": f"learner-api-{uuid4().hex[:8]}"},
        ).json()
        learner = client.post(
            "/v1/learners",
            json={"workspace_id": workspace["id"], "display_name": "Graph learner"},
        ).json()
        first = client.post(
            "/v1/chat",
            json={
                "workspace_id": workspace["id"],
                "learner_id": learner["id"],
                "session_id": str(uuid4()),
                "message": "Teach me prerequisite knowledge.",
            },
        )
        assert first.status_code == 200, first.text
        learner_graph_update = first.json()["learner_graph_update"]
        assert learner_graph_update["revision_id"]
        assert learner_graph_update["assertions_added"] >= 3

        revisions = client.get(f"/v1/learners/{learner['id']}/graph/revisions")
        assert revisions.status_code == 200, revisions.text
        revision = revisions.json()["items"][0]
        assert revision["id"] == learner_graph_update["revision_id"]
        detail = client.get(f"/v1/learners/{learner['id']}/graph/revisions/{revision['id']}")
        assert detail.status_code == 200, detail.text
        assertion_id = detail.json()["assertions"][0]["id"]

        assertion = client.get(f"/v1/learners/{learner['id']}/graph/assertions/{assertion_id}")
        assert assertion.status_code == 200, assertion.text
        assertion_data = assertion.json()["data"]
        assert assertion_data["learner_graph_revision_id"] == revision["id"]
        assert "source_turn" in assertion_data

        graph = client.get(f"/v1/learners/{learner['id']}/knowledge-graph")
        assert graph.status_code == 200, graph.text
        graph_edges = graph.json()["elements"]["edges"]
        assert any(
            edge["data"]["relation_type"] == LearnerRelationType.USER_SUPPLIED.value
            for edge in graph_edges
        )
        edge = graph_edges[0]["data"]
        assert UUID(edge["assertion_id"])
        assert edge["relation_type"]
        assert "natural_language_description" in edge
        assert edge["learner_graph_revision_id"] == revision["id"]
