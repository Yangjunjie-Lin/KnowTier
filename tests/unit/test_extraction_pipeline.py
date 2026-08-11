from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from cognigraph.config import Settings
from cognigraph.domain.documents import DocumentChunk
from cognigraph.domain.enums import (
    CognitiveLevel,
    ConflictType,
    EpistemicStatus,
    NodeType,
    RelationTypeKey,
)
from cognigraph.domain.graph import RelationAssertion
from cognigraph.extraction.blueprint_builder import BlueprintGraphDeltaBuilder
from cognigraph.extraction.canonicalizer import canonical_text
from cognigraph.extraction.conflict_detector import ConflictDetector
from cognigraph.extraction.deduplicator import EntityDeduplicator
from cognigraph.extraction.knowledge_extractor import KnowledgeExtractor
from cognigraph.extraction.schemas import (
    ChatTopicCandidate,
    ChatTopicSeed,
    KnowledgeBlueprint,
    KnowledgePointCandidate,
)
from cognigraph.graph.applier import GraphNode, GraphSnapshot, InMemoryGraphApplier
from cognigraph.graph.delta import AssertionCreate
from cognigraph.graph.validator import GraphDeltaValidator
from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import ModelGateway
from cognigraph.llm.observability import InMemoryModelRunSink
from tests.fixtures.factories import blueprint, six_stages, source_document


def test_blueprint_requires_complete_six_level_plan() -> None:
    _document, span = source_document()
    payload = KnowledgePointCandidate(
        candidate_key="point",
        canonical_name="Point",
        plain_definition="plain",
        formal_definition="formal",
        importance=0.5,
        difficulty=0.5,
        must_cover=["one thing"],
        source_span_ids=[span.id],
        six_level_plan=six_stages(),
        confidence=0.8,
    ).model_dump()
    payload["six_level_plan"] = payload["six_level_plan"][:-1]
    with pytest.raises(ValidationError, match="six_level_plan"):
        KnowledgePointCandidate.model_validate(payload)


def test_blueprint_rejects_unknown_candidate_references() -> None:
    _document, span = source_document()
    payload = blueprint(span.id).model_dump()
    payload["relations"][0]["object_candidate_id"] = "unknown"
    with pytest.raises(ValidationError, match="unknown candidate"):
        KnowledgeBlueprint.model_validate(payload)


def test_chat_topic_normalizes_only_bounded_provider_aliases_with_safe_scores() -> None:
    topic = ChatTopicCandidate.model_validate(
        {
            "title": "RAG",
            "domain": "AI",
            "canonical_name": "RAG",
            "plain_definition": "Retrieval-grounded generation.",
            "formal": "A retriever supplies context to a generator.",
            "must_cover_cover": ["retrieval", "generation"],
            "applicability": [{"scenario": "grounded question answering"}],
        }
    )

    assert topic.canonical_name == "rag"
    assert topic.formal_definition.startswith("A retriever")
    assert topic.must_cover == ["retrieval", "generation"]
    assert topic.applicability == ["grounded question answering"]
    assert topic.importance == pytest.approx(0.5)
    assert topic.difficulty == pytest.approx(0.5)
    assert topic.confidence == pytest.approx(0.4)


def test_chat_topic_still_rejects_unknown_provider_fields() -> None:
    with pytest.raises(ValidationError, match="unexpected_field"):
        ChatTopicCandidate.model_validate(
            {
                "title": "RAG",
                "canonical_name": "RAG",
                "plain_definition": "Retrieval-grounded generation.",
                "formal_definition": "A retriever supplies context to a generator.",
                "must_cover": ["retrieval", "generation"],
                "unexpected_field": "must remain forbidden",
            }
        )


def test_chat_topic_seed_normalizes_known_provider_aliases() -> None:
    seed = ChatTopicSeed.model_validate(
        {
            "topic": "RAG",
            "definition": "Retrieval-grounded generation.",
        }
    )

    assert seed.canonical_name == "RAG"
    assert seed.plain_definition == "Retrieval-grounded generation."


def test_chat_topic_seed_rejects_unknown_provider_fields() -> None:
    with pytest.raises(ValidationError, match="unexpected_field"):
        ChatTopicSeed.model_validate(
            {
                "canonical_name": "RAG",
                "plain_definition": "Retrieval-grounded generation.",
                "unexpected_field": "must remain forbidden",
            }
        )


@pytest.mark.asyncio
async def test_blueprint_builds_source_grounded_delta_and_applies() -> None:
    workspace_id = uuid4()
    document, span = source_document(workspace_id)
    snapshot = GraphSnapshot(workspace_id=workspace_id)
    delta = BlueprintGraphDeltaBuilder().build(
        workspace_id=workspace_id,
        document=document,
        source_spans=[span],
        blueprint=blueprint(span.id),
        snapshot=snapshot,
    )
    result = GraphDeltaValidator().validate(delta, snapshot)
    assert result.conforms, result.issues
    assert sum(node.node_type is NodeType.LEARNING_STAGE for node in delta.add_nodes) == 6
    assert all(item.source_span_ids for item in delta.add_assertions)

    applied = await InMemoryGraphApplier().apply(delta)
    assert applied.revision.sequence == 1
    assert applied.snapshot.source_spans[0].id == span.id


@pytest.mark.asyncio
async def test_extractor_audit_records_source_document_context() -> None:
    workspace_id = uuid4()
    document, span = source_document(workspace_id)
    chunk = DocumentChunk(
        document_id=document.id,
        sequence=0,
        text=span.text,
        normalized_text=span.normalized_text,
        page_start=span.page_number,
        page_end=span.page_number,
        source_span_ids=[span.id],
        token_count=8,
    )
    sink = InMemoryModelRunSink()
    gateway = ModelGateway(Settings(use_mock_llm=True), FakeProvider(), sink=sink)

    await KnowledgeExtractor(gateway).extract(
        workspace_id=workspace_id,
        chunks=[chunk],
        spans=[span],
    )

    assert len(sink.records) == 1
    assert sink.records[0].context.workspace_id == workspace_id
    assert sink.records[0].context.document_id == document.id


@pytest.mark.asyncio
async def test_compact_chat_topic_expands_to_a_complete_unverified_plan() -> None:
    workspace_id = uuid4()
    document, source = source_document(workspace_id)
    span = source.model_copy(update={"text": "什么是RAG", "normalized_text": "什么是rag"})
    chunk = DocumentChunk(
        document_id=document.id,
        sequence=0,
        text=span.text,
        normalized_text=span.normalized_text,
        page_start=span.page_number,
        page_end=span.page_number,
        source_span_ids=[span.id],
        token_count=4,
    )
    sink = InMemoryModelRunSink()
    extractor = KnowledgeExtractor(
        ModelGateway(Settings(use_mock_llm=True), FakeProvider(), sink=sink)
    )

    compact, _call = await extractor.extract(
        workspace_id=workspace_id,
        chunks=[chunk],
        spans=[span],
        compact_chat_topic=True,
    )

    assert len(compact.knowledge_points) == 1
    point = compact.knowledge_points[0]
    assert point.canonical_name == "retrieval-augmented generation"
    assert len(point.six_level_plan) == 6
    assert {stage.cognitive_level for stage in point.six_level_plan} == set(CognitiveLevel)
    assert point.source_span_ids == [span.id]
    assert point.confidence <= 0.8
    assert sink.records[0].context.prompt_name == "chat_topic_extractor"


def test_canonicalization_and_deduplication_normalize_unicode() -> None:
    workspace = uuid4()
    node = GraphNode(
        id=uuid4(),
        workspace_id=workspace,
        node_type=NodeType.KNOWLEDGE_POINT,
        properties={"canonical_name": "Bayesian   Knowledge Tracing"},
        epistemic_status=EpistemicStatus.UNVERIFIED,
        graph_revision_id=uuid4(),
    )
    fullwidth = "\uff22\uff21\uff39\uff25\uff33\uff29\uff21\uff2e knowledge tracing"
    match = EntityDeduplicator().find(fullwidth, [node])
    assert canonical_text(" A  B ") == "a b"
    assert match is not None and match.node_id == node.id


def test_conflict_detector_keeps_non_temporal_competing_assertions() -> None:
    workspace = uuid4()
    subject = uuid4()
    old_object = uuid4()
    new_object = uuid4()
    revision = uuid4()
    existing = RelationAssertion(
        workspace_id=workspace,
        subject_id=subject,
        predicate_key=RelationTypeKey.APPLIES_TO,
        object_id=old_object,
        natural_language_description="Old supported scope",
        confidence=0.8,
        created_by="test",
        graph_revision_id=revision,
    )
    candidate = AssertionCreate(
        subject_id=subject,
        predicate_key=RelationTypeKey.APPLIES_TO,
        object_id=new_object,
        natural_language_description="Competing supported scope",
        confidence=0.8,
    )
    conflicts = ConflictDetector().detect(candidate, [existing], temporal=False)
    assert conflicts[0].conflict_type is ConflictType.COMPETING_OBJECT
    assert not conflicts[0].should_supersede
