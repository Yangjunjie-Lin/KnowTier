from __future__ import annotations

from uuid import UUID, uuid4

from cognigraph.api.schemas import ChatRequest
from cognigraph.domain.enums import CognitiveLevel, EpistemicStatus, EvidenceType, NodeType
from cognigraph.domain.learner import MasteryEvidence
from cognigraph.graph.applier import GraphNode
from cognigraph.services.chat import ChatService, ChatTurnContext


def _evidence(
    context: ChatTurnContext,
    level: CognitiveLevel,
    evidence_type: EvidenceType,
) -> MasteryEvidence:
    return MasteryEvidence(
        learner_id=context.request.learner_id,
        knowledge_point_id=uuid4(),
        session_id=context.request.session_id,
        turn_id=uuid4(),
        evidence_type=evidence_type,
        cognitive_level=level,
        correctness_score=0.9,
        reasoning_score=0.8,
        independence_score=0.8,
        transfer_score=0.7,
        grader_confidence=0.9,
        raw_answer="A reasoned answer.",
        grader_explanation="The answer meets the rubric.",
    )


def test_every_cognitive_level_rotates_two_distinct_evidence_forms() -> None:
    context = ChatTurnContext(
        request=ChatRequest(
            workspace_id=uuid4(),
            learner_id=uuid4(),
            session_id=uuid4(),
            message="answer",
        )
    )

    for level in CognitiveLevel:
        context.evidence_history = []
        first = ChatService._next_evidence_type(context, level)
        context.evidence_history = [_evidence(context, level, first)]
        second = ChatService._next_evidence_type(context, level)
        assert second is not first
        assert second is not EvidenceType.SELF_REPORT


def test_learning_request_and_self_report_classification_are_separate() -> None:
    assert ChatService._looks_like_learning_request("Teach me graph traversal.")
    assert ChatService._looks_like_learning_request("请解释条件概率")
    assert not ChatService._looks_like_learning_request(
        "It is required first because the later idea depends on it."
    )
    assert ChatService._is_pure_self_report("I understand.")
    assert ChatService._is_pure_self_report("我明白了\uff01")
    assert not ChatService._is_pure_self_report("I understand because it is required first.")


def test_response_language_prefers_learner_and_safely_falls_back_to_workspace() -> None:
    assert ChatService._preferred_response_language("zh-CN", "en") == "zh-CN"
    assert ChatService._preferred_response_language("", "en") == "en"
    assert ChatService._preferred_response_language("not a language tag", "zh-CN") == "zh-CN"
    assert ChatService._preferred_response_language("", "") == "zh-CN"


def test_search_terms_split_cjk_learning_prefix_from_ascii_topic() -> None:
    assert ChatService._search_terms("我想学习什么是RAG") == ["rag"]
    assert ChatService._search_terms("请解释条件概率") == ["条件概率"]


def test_current_ingestion_target_selection_handles_multiple_knowledge_points() -> None:
    workspace_id = uuid4()
    revision_id = uuid4()
    secondary = GraphNode(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        workspace_id=workspace_id,
        node_type=NodeType.KNOWLEDGE_POINT,
        properties={
            "canonical_name": "grounding evidence",
            "summary": "Evidence supplied to a generator.",
            "importance": 0.7,
        },
        epistemic_status=EpistemicStatus.UNVERIFIED,
        source_confidence=0.85,
        graph_revision_id=revision_id,
    )
    rag = GraphNode(
        id=UUID("00000000-0000-0000-0000-000000000002"),
        workspace_id=workspace_id,
        node_type=NodeType.KNOWLEDGE_POINT,
        properties={
            "canonical_name": "retrieval-augmented generation",
            "summary": "RAG retrieves evidence before generating an answer.",
            "importance": 0.95,
        },
        epistemic_status=EpistemicStatus.UNVERIFIED,
        source_confidence=0.9,
        graph_revision_id=revision_id,
    )

    selected = ChatService._select_target(
        [secondary, rag],
        "什么是RAG",
        allow_unmatched=True,
    )

    assert selected is not None
    assert selected.id == rag.id
