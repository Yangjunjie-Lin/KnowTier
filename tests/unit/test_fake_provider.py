from __future__ import annotations

import json

import pytest

from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.schemas import ChatMessage


@pytest.mark.unit
@pytest.mark.asyncio
async def test_learning_insights_fixture_is_explicit_and_builds_a_prerequisite() -> None:
    default_provider = FakeProvider()
    default_response = await default_provider.complete(
        model="mock",
        messages=[ChatMessage(role="user", content="source")],
        response_schema={"properties": {"knowledge_points": {}}},
    )
    default_payload = json.loads(default_response.content or "{}")
    assert len(default_payload["knowledge_points"]) == 1
    assert default_payload["knowledge_points"][0]["prerequisites"] == []

    fixture_provider = FakeProvider(learning_insights_fixture=True)
    fixture_response = await fixture_provider.complete(
        model="mock",
        messages=[ChatMessage(role="user", content="source")],
        response_schema={"properties": {"knowledge_points": {}}},
    )
    fixture_payload = json.loads(fixture_response.content or "{}")
    assert [item["canonical_name"] for item in fixture_payload["knowledge_points"]] == [
        "conditional probability foundation",
        "bayesian updating target",
    ]
    assert fixture_payload["knowledge_points"][1]["prerequisites"] == [
        "conditional-probability-foundation"
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_learning_insights_fixture_grades_misconception_and_correction() -> None:
    provider = FakeProvider(learning_insights_fixture=True)
    schema = {"properties": {"correctness": {}}}
    wrong = await provider.complete(
        model="mock",
        messages=[ChatMessage(role="user", content="E2E_WRONG_BAYES_ANSWER")],
        response_schema=schema,
    )
    wrong_payload = json.loads(wrong.content or "{}")
    misconception = "Bayesian updating ignores the likelihood evidence."
    assert wrong_payload["misconceptions"] == [misconception]
    assert wrong_payload["correctness"] < 0.5

    corrected = await provider.complete(
        model="mock",
        messages=[ChatMessage(role="user", content="E2E_CORRECT_BAYES_ANSWER")],
        response_schema=schema,
    )
    corrected_payload = json.loads(corrected.content or "{}")
    assert corrected_payload["misconceptions"] == []
    assert corrected_payload["correctness"] >= 0.85
    assert misconception in corrected_payload["explanation"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_teacher_fixture_uses_explicit_response_language() -> None:
    provider = FakeProvider()
    schema = {"properties": {"assessment_question": {}}}

    chinese = await provider.complete(
        model="mock",
        messages=[
            ChatMessage(
                role="user",
                content=json.dumps(
                    {
                        "response_language": "zh-CN",
                        "untrusted_learner_message": "Explain RAG.",
                    }
                ),
            )
        ],
        response_schema=schema,
    )
    english = await provider.complete(
        model="mock",
        messages=[
            ChatMessage(
                role="user",
                content=json.dumps(
                    {
                        "response_language": "en",
                        "untrusted_learner_message": "什么是 RAG?",
                    },
                    ensure_ascii=False,
                ),
            )
        ],
        response_schema=schema,
    )

    chinese_payload = json.loads(chinese.content or "{}")
    english_payload = json.loads(english.content or "{}")
    assert "当前证据" in chinese_payload["core_explanation"]
    assert "current evidence" in english_payload["core_explanation"]
