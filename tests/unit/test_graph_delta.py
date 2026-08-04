from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from cognigraph.domain.documents import SourceSpan
from cognigraph.domain.enums import (
    ConflictType,
    EpistemicStatus,
    NodeType,
    RelationTypeKey,
)
from cognigraph.graph.applier import GraphSnapshot, InMemoryGraphApplier, InMemoryGraphStore
from cognigraph.graph.delta import (
    AssertionCreate,
    AssertionSupersede,
    ConflictCandidate,
    GraphDelta,
    NodeCreate,
    NodePatch,
)
from cognigraph.graph.validator import GraphDeltaValidator


def _span(document_id: UUID) -> SourceSpan:
    return SourceSpan(
        document_id=document_id,
        page_number=1,
        heading_path=["Probability"],
        text="Bayesian updating requires conditional probability.",
        normalized_text="Bayesian updating requires conditional probability.",
        start_offset=0,
        end_offset=54,
        content_hash="1" * 64,
        parser_name="docling",
        parser_version="2.25",
    )


async def _seed_graph() -> tuple[InMemoryGraphApplier, GraphSnapshot, UUID, UUID, UUID]:
    workspace_id = uuid4()
    document_id = uuid4()
    span = _span(document_id)
    store = InMemoryGraphStore()
    store.set_snapshot(GraphSnapshot(workspace_id=workspace_id, source_spans=[span]))
    applier = InMemoryGraphApplier(store)
    bayes_id = uuid4()
    probability_id = uuid4()
    assertion_id = uuid4()
    delta = GraphDelta(
        workspace_id=workspace_id,
        add_nodes=[
            NodeCreate(
                id=document_id,
                node_type=NodeType.SOURCE_DOCUMENT,
                properties={"name": "probability.pdf"},
                epistemic_status=EpistemicStatus.CONFIRMED,
            ),
            NodeCreate(
                id=bayes_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={
                    "canonical_name": "bayesian updating",
                    "display_name": "Bayesian updating",
                    "domain": "Probability",
                },
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[span.id],
            ),
            NodeCreate(
                id=probability_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={
                    "canonical_name": "conditional probability",
                    "display_name": "Conditional probability",
                    "domain": "Probability",
                },
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[span.id],
            ),
        ],
        add_assertions=[
            AssertionCreate(
                id=assertion_id,
                subject_id=bayes_id,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=probability_id,
                natural_language_description=(
                    "Bayesian updating requires conditional probability."
                ),
                confidence=0.95,
                epistemic_status=EpistemicStatus.CONFIRMED,
                source_span_ids=[span.id],
                created_by="extractor",
            )
        ],
    )
    result = await applier.apply(delta)
    return applier, result.snapshot, bayes_id, probability_id, assertion_id


def test_node_patch_has_no_hard_delete_escape_hatch() -> None:
    with pytest.raises(ValidationError, match="deletion properties"):
        NodePatch(node_id=uuid4(), set_properties={"nested": {"deleted": True}})


def test_graph_delta_rejects_missing_replacement_and_duplicate_spo() -> None:
    subject_id = uuid4()
    object_id = uuid4()
    assertion = AssertionCreate(
        subject_id=subject_id,
        predicate_key=RelationTypeKey.REQUIRES,
        object_id=object_id,
        natural_language_description="A requires B.",
        confidence=0.8,
    )
    with pytest.raises(ValidationError, match="replacement_assertion_id"):
        GraphDelta(
            workspace_id=uuid4(),
            supersede_assertions=[
                AssertionSupersede(
                    assertion_id=uuid4(),
                    replacement_assertion_id=uuid4(),
                    reason="Evidence changed.",
                )
            ],
        )
    with pytest.raises(ValidationError, match="duplicate subject-predicate-object"):
        GraphDelta(
            workspace_id=uuid4(),
            add_assertions=[assertion, assertion.model_copy(update={"id": uuid4()})],
        )


def test_graph_delta_hash_is_deterministic() -> None:
    delta = GraphDelta(
        workspace_id=uuid4(),
        add_nodes=[
            NodeCreate(
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "bayes"},
            )
        ],
    )
    restored = GraphDelta.model_validate_json(delta.model_dump_json())
    assert restored.content_hash() == delta.content_hash()


def test_validator_detects_unmarked_prerequisite_cycle() -> None:
    workspace_id = uuid4()
    first_id = uuid4()
    second_id = uuid4()
    delta = GraphDelta(
        workspace_id=workspace_id,
        add_nodes=[
            NodeCreate(
                id=first_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "first"},
            ),
            NodeCreate(
                id=second_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "second"},
            ),
        ],
        add_assertions=[
            AssertionCreate(
                subject_id=first_id,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=second_id,
                natural_language_description="First requires second.",
                confidence=0.5,
            ),
            AssertionCreate(
                subject_id=second_id,
                predicate_key=RelationTypeKey.REQUIRES,
                object_id=first_id,
                natural_language_description="Second requires first.",
                confidence=0.5,
            ),
        ],
    )
    result = GraphDeltaValidator().validate(delta, GraphSnapshot(workspace_id=workspace_id))
    assert not result.conforms
    assert "PREREQUISITE_CYCLE" in {issue.code for issue in result.issues}


@pytest.mark.asyncio
async def test_applier_is_idempotent_and_supersedes_without_deleting_history() -> None:
    applier, snapshot, bayes_id, probability_id, old_assertion_id = await _seed_graph()
    replacement = AssertionCreate(
        subject_id=bayes_id,
        predicate_key=RelationTypeKey.REQUIRES,
        object_id=probability_id,
        natural_language_description="Bayesian inference depends on conditional probability.",
        confidence=0.98,
        epistemic_status=EpistemicStatus.CONFIRMED,
        source_span_ids=[snapshot.source_spans[0].id],
        created_by="reviewer",
    )
    delta = GraphDelta(
        workspace_id=snapshot.workspace_id,
        base_revision_id=snapshot.revision_id,
        add_assertions=[replacement],
        supersede_assertions=[
            AssertionSupersede(
                assertion_id=old_assertion_id,
                replacement_assertion_id=replacement.id,
                reason="Reviewed wording and confidence.",
            )
        ],
    )
    applied = await applier.apply(delta)
    replay = await applier.apply(delta)

    assert replay.already_applied
    assert replay.revision.id == applied.revision.id
    assertion_map = applied.snapshot.assertion_map()
    assert len(assertion_map) == 2
    assert not assertion_map[old_assertion_id].is_active
    assert assertion_map[replacement.id].supersedes_assertion_id == old_assertion_id


@pytest.mark.asyncio
async def test_competing_non_temporal_assertion_requires_conflict_candidate() -> None:
    _applier, snapshot, bayes_id, _probability_id, old_assertion_id = await _seed_graph()
    alternative_id = uuid4()
    assertion = AssertionCreate(
        subject_id=bayes_id,
        predicate_key=RelationTypeKey.REQUIRES,
        object_id=alternative_id,
        natural_language_description="A competing prerequisite claim.",
        confidence=0.6,
        epistemic_status=EpistemicStatus.INFERRED,
    )
    base_data = {
        "workspace_id": snapshot.workspace_id,
        "base_revision_id": snapshot.revision_id,
        "add_nodes": [
            NodeCreate(
                id=alternative_id,
                node_type=NodeType.KNOWLEDGE_POINT,
                properties={"canonical_name": "alternative"},
            )
        ],
        "add_assertions": [assertion],
    }
    unmarked = GraphDelta(**base_data)
    result = GraphDeltaValidator().validate(unmarked, snapshot)
    assert "UNDECLARED_RELATION_CONFLICT" in {issue.code for issue in result.issues}

    marked = GraphDelta(
        **base_data,
        conflicts=[
            ConflictCandidate(
                conflict_type=ConflictType.COMPETING_OBJECT,
                assertion_ids=[old_assertion_id, assertion.id],
                description="Two non-temporal prerequisite claims need review.",
            )
        ],
    )
    assert GraphDeltaValidator().validate(marked, snapshot).conforms
