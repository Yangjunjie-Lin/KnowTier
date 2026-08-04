from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from cognigraph.config import Settings
from cognigraph.extraction.schemas import KnowledgeBlueprint
from cognigraph.graph.delta import GraphDelta
from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import ModelGateway, ModelGatewayError
from cognigraph.llm.schemas import (
    ChatMessage,
    GraderOutput,
    ModelCallContext,
    ModelRole,
    TeacherOutput,
)


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "use_mock_llm": True,
        "llm_max_retries": 1,
        "llm_timeout_seconds": 0.1,
        "fallback_models": (),
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.contract
async def test_structured_teacher_output() -> None:
    provider = FakeProvider()
    gateway = ModelGateway(settings(), provider)

    value, result = await gateway.generate_structured(
        role=ModelRole.TEACHER,
        messages=[ChatMessage(role="user", content="What is a prerequisite?")],
        response_model=TeacherOutput,
        context=ModelCallContext(prompt_name="teacher_system"),
    )

    assert value.assessment.question.endswith("?")
    assert result.provider == "mock"
    assert not result.repaired
    assert len(provider.calls) == 1


@pytest.mark.contract
async def test_structured_extractor_output() -> None:
    provider = FakeProvider()
    gateway = ModelGateway(settings(), provider)
    source_span_id = uuid4()

    value, result = await gateway.generate_structured(
        role=ModelRole.EXTRACTOR,
        messages=[
            ChatMessage(
                role="user",
                content=(
                    f'{{"source_span_id":"{source_span_id}",'
                    '"text":"A prerequisite is needed first."}'
                ),
            )
        ],
        response_model=KnowledgeBlueprint,
        context=ModelCallContext(prompt_name="knowledge_extractor"),
    )

    assert value.knowledge_points[0].source_span_ids == [source_span_id]
    assert result.provider == "mock"


@pytest.mark.contract
async def test_structured_graph_delta_output() -> None:
    delta = GraphDelta(workspace_id=uuid4())
    provider = FakeProvider([delta])
    gateway = ModelGateway(settings(), provider)

    value, result = await gateway.generate_structured(
        role=ModelRole.GRAPH,
        messages=[ChatMessage(role="user", content="Compare candidates to the bounded subgraph.")],
        response_model=GraphDelta,
        context=ModelCallContext(prompt_name="graph_delta_builder"),
    )

    assert value == delta
    assert value.is_empty
    assert result.provider == "mock"


@pytest.mark.contract
async def test_malformed_json_is_repaired_with_limited_retry() -> None:
    provider = FakeProvider(["not-json"])
    gateway = ModelGateway(settings(), provider)

    value, result = await gateway.generate_structured(
        role=ModelRole.GRADER,
        messages=[ChatMessage(role="user", content="A partial answer")],
        response_model=GraderOutput,
        context=ModelCallContext(prompt_name="response_grader"),
    )

    assert value.correctness == pytest.approx(0.75)
    assert result.repaired
    assert len(provider.calls) == 2


@pytest.mark.contract
async def test_provider_failure_uses_fallback_provider() -> None:
    primary = FakeProvider([RuntimeError("provider unavailable"), RuntimeError("still down")])
    fallback = FakeProvider()
    gateway = ModelGateway(settings(), primary, fallback_provider=fallback)

    value, result = await gateway.generate_structured(
        role=ModelRole.GRADER,
        messages=[ChatMessage(role="user", content="answer")],
        response_model=GraderOutput,
        context=ModelCallContext(prompt_name="response_grader"),
    )

    assert value.confidence > 0
    assert result.provider == "mock"
    assert len(fallback.calls) == 1


@pytest.mark.contract
async def test_timeout_is_bounded() -> None:
    provider = FakeProvider(delay_seconds=0.05)
    gateway = ModelGateway(settings(llm_timeout_seconds=0.001, llm_max_retries=0), provider)

    with pytest.raises(ModelGatewayError, match="structured model call failed"):
        await asyncio.wait_for(
            gateway.generate_structured(
                role=ModelRole.GRADER,
                messages=[ChatMessage(role="user", content="answer")],
                response_model=GraderOutput,
                context=ModelCallContext(prompt_name="response_grader"),
            ),
            timeout=0.2,
        )
