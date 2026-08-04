from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import UUID, uuid4

from cognigraph.domain.documents import Document, SourceSpan
from cognigraph.domain.enums import CognitiveLevel, InputKind
from cognigraph.extraction.schemas import (
    AssessmentQuestionCandidate,
    ExampleCandidate,
    KnowledgeBlueprint,
    KnowledgePointCandidate,
    RelationCandidate,
    SixLevelPlanCandidate,
)


def source_document(workspace_id: UUID | None = None) -> tuple[Document, SourceSpan]:
    workspace_id = workspace_id or uuid4()
    text = "A prerequisite is knowledge required before learning a dependent concept."
    document = Document(
        workspace_id=workspace_id,
        original_filename="lesson.txt",
        storage_path=Path("data/uploads/lesson.txt"),
        mime_type="text/plain",
        input_kind=InputKind.DOCUMENT,
        content_hash=hashlib.sha256(text.encode()).hexdigest(),
        byte_size=len(text.encode()),
        language="en",
        parser_name="text",
        parser_version="1",
        page_count=1,
    )
    span = SourceSpan(
        document_id=document.id,
        page_number=1,
        heading_path=["Prerequisites"],
        text=text,
        normalized_text=text,
        start_offset=0,
        end_offset=len(text),
        content_hash=hashlib.sha256(text.encode()).hexdigest(),
        parser_name="text",
        parser_version="1",
    )
    return document, span


def six_stages() -> list[SixLevelPlanCandidate]:
    return [
        SixLevelPlanCandidate(
            cognitive_level=level,
            learning_objective=f"Objective for level {int(level)}",
            teaching_strategy=f"Strategy for level {int(level)}",
            must_cover=["the central idea"],
            diagnostic_question=f"What demonstrates level {int(level)}?",
            mastery_criteria=["correct and reasoned response"],
            promotion_requirements=["two distinct forms of evidence"],
            remediation_policy="Increase hints one level at a time.",
        )
        for level in CognitiveLevel
    ]


def blueprint(span_id: UUID) -> KnowledgeBlueprint:
    return KnowledgeBlueprint(
        title="Prerequisite lesson",
        domain="learning science",
        knowledge_points=[
            KnowledgePointCandidate(
                candidate_key="prerequisite",
                canonical_name="Prerequisite knowledge",
                plain_definition="Something you need to know first.",
                formal_definition="Knowledge required before a dependent objective.",
                importance=0.9,
                difficulty=0.2,
                prerequisites=[],
                must_cover=["dependency"],
                common_confusions=["mere chronological order"],
                applicability=["sequenced learning"],
                limitations=["not every related concept is a prerequisite"],
                source_span_ids=[span_id],
                six_level_plan=six_stages(),
                confidence=0.92,
            )
        ],
        examples=[
            ExampleCandidate(
                candidate_key="example-key",
                knowledge_point_candidate_id="prerequisite",
                content="Addition is often a prerequisite for long multiplication.",
                source_span_ids=[span_id],
            )
        ],
        questions=[
            AssessmentQuestionCandidate(
                candidate_key="question-key",
                knowledge_point_candidate_id="prerequisite",
                cognitive_level=CognitiveLevel.INTUITIVE_RECOGNITION,
                question="Which earlier skill is required first?",
                success_criteria=["identifies a necessary earlier skill"],
                source_span_ids=[span_id],
            )
        ],
        relations=[
            RelationCandidate(
                subject_candidate_id="example-key",
                predicate="EXAMPLE_OF",
                object_candidate_id="prerequisite",
                natural_language_description="The example illustrates prerequisite knowledge.",
                source_span_ids=[span_id],
                confidence=0.9,
                temporal=False,
            )
        ],
    )
