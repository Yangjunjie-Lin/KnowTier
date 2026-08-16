from __future__ import annotations

from uuid import uuid4

from cognigraph.persistence.postgres.models import ConversationTurn
from cognigraph.services.conversation_history import (
    _attachment_ids,
    _recent_turn_window,
    _verified_chat_response,
)


def test_attachment_projection_accepts_only_unique_bounded_uuids() -> None:
    valid_ids = [uuid4() for _ in range(22)]
    projected = _attachment_ids(
        {
            "attachment_ids": [
                "not-a-uuid",
                str(valid_ids[0]),
                str(valid_ids[0]),
                42,
                *[str(value) for value in valid_ids[1:]],
            ],
            "internal_secret": "must never be projected",
        }
    )

    assert projected == valid_ids[:20]


def test_attachment_projection_rejects_non_list_metadata() -> None:
    assert _attachment_ids({"attachment_ids": "not-a-list"}) == []


def test_recent_turn_window_is_bounded_and_does_not_start_with_an_orphan_assistant() -> None:
    turns = [
        ConversationTurn(role="user" if index % 2 == 0 else "assistant") for index in range(201)
    ]

    window, truncated = _recent_turn_window(turns, limit=200)

    assert truncated is True
    assert len(window) == 199
    assert window[0].role == "user"


def test_assistant_projection_requires_a_valid_matching_chat_response() -> None:
    turn_id = uuid4()
    content = "A verified explanation"
    valid_payload: dict[str, object] = {
        "turn_id": str(turn_id),
        "response": content,
        "target_knowledge_point": {"id": str(uuid4()), "name": "Recursion"},
        "cognitive_level": 1,
        "teaching_action": "EXPLAIN",
        "assessment": {"type": "SHORT_ANSWER", "question": "What is the base case?"},
        "learner_update": {
            "decision": "HOLD",
            "reason": "Initial turn",
            "current_level": 1,
            "mastery_score": 0.1,
            "confidence": 0.2,
        },
        "graph_update": {
            "revision_id": None,
            "nodes_added": 0,
            "assertions_added": 0,
            "assertions_superseded": 0,
        },
        "learner_graph_update": None,
        "tool_usage": None,
        "model_fallback": False,
        "sources": [],
    }

    verified = _verified_chat_response(
        {"chat_response": valid_payload, "internal_secret": "hidden"},
        turn_id=turn_id,
        content=content,
    )
    assert verified is not None
    assert verified.turn_id == turn_id
    assert (
        _verified_chat_response(
            {"chat_response": {"response": "incomplete", "internal_secret": "hidden"}},
            turn_id=turn_id,
            content=content,
        )
        is None
    )
    assert (
        _verified_chat_response(
            {"chat_response": valid_payload},
            turn_id=uuid4(),
            content=content,
        )
        is None
    )
