from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from cognigraph.domain.documents import BoundingBox, Document, SourceSpan
from cognigraph.domain.enums import (
    CognitiveLevel,
    EpistemicStatus,
    HintLevel,
    InputKind,
    NodeType,
    RelationTypeKey,
)
from cognigraph.domain.graph import RelationAssertion, RelationType
from cognigraph.domain.knowledge import (
    KnowledgeBlueprint,
    KnowledgePoint,
    KnowledgePointCandidate,
    LearningStage,
    LearningStagePlan,
)


def _stages(knowledge_point_id: UUID) -> list[LearningStage]:
    return [
        LearningStage(
            knowledge_point_id=knowledge_point_id,
            cognitive_level=level,
            learning_objective=f"Objective {level.value}",
            teaching_strategy=f"Strategy {level.value}",
            must_cover_items=["central idea"],
            diagnostic_question_ids=[uuid4()],
            mastery_criteria=["accurate and independent"],
            promotion_requirements=["two forms of evidence"],
            remediation_policy="Offer the next bounded hint.",
        )
        for level in CognitiveLevel
    ]


def _stage_plans() -> list[LearningStagePlan]:
    return [
        LearningStagePlan(
            cognitive_level=level,
            learning_objective=f"Objective {level.value}",
            teaching_strategy=f"Strategy {level.value}",
            must_cover_items=["central idea"],
            diagnostic_questions=["What is the central idea?"],
            mastery_criteria=["Accurate response"],
            promotion_requirements=["Independent response"],
            remediation_policy="Give a bounded hint.",
        )
        for level in CognitiveLevel
    ]


def test_cognitive_and_hint_levels_are_stable_and_contiguous() -> None:
    assert [level.value for level in CognitiveLevel] == [1, 2, 3, 4, 5, 6]
    assert [level.value for level in HintLevel] == [1, 2, 3, 4, 5]


def test_knowledge_point_requires_exactly_one_stage_per_level_and_source() -> None:
    point_id = uuid4()
    source_id = uuid4()
    point = KnowledgePoint(
        id=point_id,
        workspace_id=uuid4(),
        canonical_name="  Bayesian   updating ",
        display_name="Bayesian updating",
        aliases=["Bayes update", "Bayes update"],
        summary="Updating beliefs with evidence.",
        formal_definition="Posterior is proportional to likelihood times prior.",
        plain_language_definition="New evidence changes how plausible a belief is.",
        importance=0.9,
        difficulty=0.6,
        scope="probabilistic inference",
        epistemic_status=EpistemicStatus.CONFIRMED,
        source_confidence=0.95,
        source_span_ids=[source_id],
        learning_stages=_stages(point_id),
    )
    assert point.canonical_name == "bayesian updating"
    assert point.aliases == ["Bayes update"]
    assert {stage.cognitive_level for stage in point.learning_stages} == set(CognitiveLevel)

    duplicated = _stages(point_id)
    duplicated[-1] = duplicated[-1].model_copy(
        update={"cognitive_level": CognitiveLevel.INTUITIVE_RECOGNITION}
    )
    with pytest.raises(ValidationError, match="every cognitive level"):
        point.model_copy(update={"learning_stages": duplicated}).model_validate(
            point.model_copy(update={"learning_stages": duplicated}).model_dump()
        )

    with pytest.raises(ValidationError, match="confirmed knowledge"):
        KnowledgePoint.model_validate({**point.model_dump(), "source_span_ids": []})


def test_knowledge_blueprint_rejects_unknown_candidate_references() -> None:
    source_id = uuid4()
    candidate = KnowledgePointCandidate(
        candidate_id="kp-bayes",
        canonical_name="bayesian updating",
        plain_definition="Evidence changes a prior belief.",
        formal_definition="p(h|e) is proportional to p(e|h)p(h).",
        importance=0.9,
        difficulty=0.6,
        must_cover=["prior", "likelihood", "posterior"],
        source_span_ids=[source_id],
        six_level_plan=_stage_plans(),
        confidence=0.9,
    )
    blueprint = KnowledgeBlueprint(title="Bayes", knowledge_points=[candidate])
    assert blueprint.knowledge_points[0].six_level_plan[-1].cognitive_level == 6

    with pytest.raises(ValidationError, match="relation object_candidate_id is unknown"):
        KnowledgeBlueprint.model_validate(
            {
                **blueprint.model_dump(),
                "relations": [
                    {
                        "subject_candidate_id": "kp-bayes",
                        "predicate": "REQUIRES",
                        "object_candidate_id": "missing",
                        "natural_language_description": "Bayes requires probability.",
                        "source_span_ids": [source_id],
                        "confidence": 0.8,
                    }
                ],
            }
        )


def test_source_span_and_document_preserve_traceable_location() -> None:
    span = SourceSpan(
        document_id=uuid4(),
        page_number=3,
        heading_path=["Chapter 1", "Bayes"],
        text="Posterior combines prior and likelihood.",
        normalized_text="Posterior combines prior and likelihood.",
        start_offset=10,
        end_offset=50,
        bounding_box=BoundingBox(left=1, top=2, right=30, bottom=12),
        content_hash="a" * 64,
        parser_name="docling",
        parser_version="2.25",
    )
    assert span.page_number == 3
    assert span.content_hash == "a" * 64

    with pytest.raises(ValidationError, match="must not contain a path"):
        Document(
            workspace_id=uuid4(),
            original_filename="../secret.pdf",
            storage_path=Path("data/file.pdf"),
            mime_type="application/pdf",
            input_kind=InputKind.PDF,
            content_hash="b" * 64,
            byte_size=10,
        )


def test_relation_assertion_is_first_class_versioned_and_temporal() -> None:
    now = datetime.now(UTC)
    assertion = RelationAssertion(
        workspace_id=uuid4(),
        subject_id=uuid4(),
        predicate_key=RelationTypeKey.REQUIRES,
        object_id=uuid4(),
        natural_language_description="Bayes updating requires conditional probability.",
        confidence=0.95,
        epistemic_status=EpistemicStatus.CONFIRMED,
        valid_from=now,
        created_by="extractor",
        source_span_ids=[uuid4()],
        model_run_id=uuid4(),
        graph_revision_id=uuid4(),
    )
    assert assertion.is_active

    with pytest.raises(ValidationError, match="valid_to cannot precede"):
        RelationAssertion.model_validate(
            {**assertion.model_dump(), "valid_to": now - timedelta(seconds=1)}
        )


def test_relation_type_rejects_incoherent_symmetric_inverse() -> None:
    with pytest.raises(ValidationError, match="symmetric relation"):
        RelationType(
            name=RelationTypeKey.SIMILAR_TO,
            description="Semantic similarity.",
            inverse_name=RelationTypeKey.CONTRASTS_WITH,
            domain_types=[NodeType.KNOWLEDGE_POINT],
            range_types=[NodeType.KNOWLEDGE_POINT],
            symmetric=True,
        )
