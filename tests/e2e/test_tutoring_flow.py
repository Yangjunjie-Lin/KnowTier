from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select

from cognigraph.api.schemas import ChatRequest
from cognigraph.config import Settings
from cognigraph.domain.enums import CognitiveLevel, NodeType, RelationTypeKey
from cognigraph.graph.delta import AssertionCreate, GraphDelta, NodeCreate
from cognigraph.persistence.postgres.models import (
    ConversationTurn,
    GraphRevision,
    MasteryEvidence,
)
from cognigraph.services.chat import ChatService
from cognigraph.services.runtime import ApplicationRuntime


@pytest.mark.e2e
async def test_mock_tutoring_flow_promotes_after_distinct_evidence(tmp_path: Path) -> None:
    database_path = tmp_path / "e2e.db"
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
    )
    runtime = ApplicationRuntime(settings)
    await runtime.startup()
    try:
        workspace_id = uuid4()
        learner_id = uuid4()
        session_id = uuid4()
        async with runtime.database.unit_of_work() as unit:
            await unit.workspaces.create(
                workspace_id=workspace_id,
                name="E2E Workspace",
                slug=f"e2e-{workspace_id.hex[:8]}",
            )
            await unit.learners.create(
                workspace_id=workspace_id,
                learner_id=learner_id,
                display_name="Test Learner",
            )
            await unit.commit()

        chat = ChatService(runtime)
        first = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="Teach me prerequisite knowledge.",
            )
        )
        assert first.cognitive_level is CognitiveLevel.INTUITIVE_RECOGNITION
        assert first.graph_update.revision_id is not None
        assert first.graph_update.nodes_added == 1

        self_report = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="I understand.",
            )
        )
        assert self_report.learner_update.decision == "REQUEST_MORE_EVIDENCE"
        assert self_report.learner_update.current_level is CognitiveLevel.INTUITIVE_RECOGNITION
        async with runtime.database.session() as session:
            self_report_turn = await session.scalar(
                select(ConversationTurn)
                .where(
                    ConversationTurn.session_id == session_id,
                    ConversationTurn.role == "assistant",
                )
                .order_by(ConversationTurn.sequence_number.desc())
                .limit(1)
            )
        assert self_report_turn is not None
        assert self_report_turn.metadata_json["hint_level"] == 2

        partial = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="It is something needed first, but I am not sure why.",
            )
        )
        assert partial.learner_update.decision == "REQUEST_MORE_EVIDENCE"
        assert partial.teaching_action == "GIVE_HINT"
        assert partial.cognitive_level is CognitiveLevel.INTUITIVE_RECOGNITION
        async with runtime.database.session() as session:
            partial_turn = await session.scalar(
                select(ConversationTurn)
                .where(
                    ConversationTurn.session_id == session_id,
                    ConversationTurn.role == "assistant",
                )
                .order_by(ConversationTurn.sequence_number.desc())
                .limit(1)
            )
        assert partial_turn is not None
        assert partial_turn.metadata_json["hint_level"] == 3

        correct = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="It is required first because the later idea depends on it.",
            )
        )
        assert correct.learner_update.decision == "PROMOTE"
        assert correct.learner_update.current_level is CognitiveLevel.GUIDED_IMITATION
        assert correct.cognitive_level is CognitiveLevel.GUIDED_IMITATION

        imitated = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="I follow the demonstrated dependency steps on this similar case.",
            )
        )
        assert imitated.learner_update.decision == "REQUEST_MORE_EVIDENCE"
        assert imitated.learner_update.current_level is CognitiveLevel.GUIDED_IMITATION

        applied = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message=("On a new case I identify what the later step depends on, then apply it."),
            )
        )
        assert applied.learner_update.decision == "PROMOTE"
        assert applied.learner_update.current_level is CognitiveLevel.CONCEPTUAL_UNDERSTANDING
        assert applied.cognitive_level is CognitiveLevel.CONCEPTUAL_UNDERSTANDING

        async with runtime.database.session() as session:
            level_two_forms = set(
                (
                    await session.scalars(
                        select(MasteryEvidence.evidence_type).where(
                            MasteryEvidence.learner_id == learner_id,
                            MasteryEvidence.cognitive_level == int(CognitiveLevel.GUIDED_IMITATION),
                        )
                    )
                ).all()
            )
        assert level_two_forms == {"WORKED_EXAMPLE", "APPLICATION"}

        snapshot = runtime.graph_applier.store.get_snapshot(workspace_id)
        assert snapshot.revision_sequence == 1
        assert snapshot.nodes
        assert snapshot.assertions
        async with runtime.database.session() as session:
            revisions = list(
                (
                    await session.scalars(
                        select(GraphRevision).where(GraphRevision.workspace_id == workspace_id)
                    )
                ).all()
            )
        assert len(revisions) == 1
        assert revisions[0].id == snapshot.revision_id
    finally:
        await runtime.shutdown()


@pytest.mark.e2e
async def test_prerequisite_target_and_explicit_topic_switch(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'routing.db').as_posix()}",
        storage_path=tmp_path / "uploads-routing",
        use_mock_llm=True,
        neo4j_required=False,
    )
    runtime = ApplicationRuntime(settings)
    await runtime.startup()
    try:
        workspace_id = uuid4()
        learner_id = uuid4()
        session_id = uuid4()
        async with runtime.database.unit_of_work() as unit:
            await unit.workspaces.create(
                workspace_id=workspace_id,
                name="Routing Workspace",
                slug=f"routing-{workspace_id.hex[:8]}",
            )
            await unit.learners.create(
                workspace_id=workspace_id,
                learner_id=learner_id,
                display_name="Routing Learner",
            )
            await unit.commit()

        await runtime.ensure_graph_loaded(workspace_id)
        advanced_id = uuid4()
        prerequisite_id = uuid4()
        second_topic_id = uuid4()
        delta = GraphDelta(
            workspace_id=workspace_id,
            add_nodes=[
                NodeCreate(
                    id=advanced_id,
                    node_type=NodeType.KNOWLEDGE_POINT,
                    properties={
                        "canonical_name": "advanced topic",
                        "display_name": "Advanced topic",
                        "plain_language_definition": "An idea with a prerequisite.",
                        "must_cover": ["advanced dependency"],
                    },
                ),
                NodeCreate(
                    id=prerequisite_id,
                    node_type=NodeType.KNOWLEDGE_POINT,
                    properties={
                        "canonical_name": "foundation topic",
                        "display_name": "Foundation topic",
                        "plain_language_definition": "The required foundation.",
                        "must_cover": ["foundation"],
                    },
                ),
                NodeCreate(
                    id=second_topic_id,
                    node_type=NodeType.KNOWLEDGE_POINT,
                    properties={
                        "canonical_name": "second topic",
                        "display_name": "Second topic",
                        "plain_language_definition": "A separate learning target.",
                        "must_cover": ["separate target"],
                    },
                ),
            ],
            add_assertions=[
                AssertionCreate(
                    subject_id=advanced_id,
                    predicate_key=RelationTypeKey.REQUIRES,
                    object_id=prerequisite_id,
                    natural_language_description="The advanced topic requires the foundation.",
                    confidence=0.9,
                )
            ],
        )
        applied = await runtime.graph_applier.apply(delta)
        await runtime.semantic_graph.apply_delta(delta, str(applied.revision.id))

        chat = ChatService(runtime)
        prerequisite_turn = await chat.chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="Teach me advanced topic.",
            )
        )
        assert prerequisite_turn.teaching_action == "REVIEW_PREREQUISITE"
        assert prerequisite_turn.target_knowledge_point.id == prerequisite_id
        assert prerequisite_turn.target_knowledge_point.name == "Foundation topic"

        # API dependency construction creates a fresh service per request; the
        # checkpoint store must still be keyed by the stable session id.
        switched = await ChatService(runtime).chat(
            ChatRequest(
                workspace_id=workspace_id,
                learner_id=learner_id,
                session_id=session_id,
                message="Teach me second topic.",
            )
        )
        assert switched.target_knowledge_point.id == second_topic_id
        assert switched.learner_update.reason.startswith("Initial diagnostic turn")
        async with runtime.database.session() as session:
            evidence_count = len(
                (
                    await session.scalars(
                        select(MasteryEvidence.id).where(MasteryEvidence.learner_id == learner_id)
                    )
                ).all()
            )
        assert evidence_count == 0
    finally:
        await runtime.shutdown()
