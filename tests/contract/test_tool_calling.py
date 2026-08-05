from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from cognigraph.config import Settings
from cognigraph.graph.query_tools import InMemoryToolAuditSink
from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import ModelGateway, ModelProvider, ToolCallRejected
from cognigraph.llm.observability import InMemoryModelRunSink
from cognigraph.llm.schemas import (
    ChatMessage,
    ModelCallContext,
    ModelRole,
    ProviderResponse,
    TeacherOutput,
    ToolCall,
    ToolDefinition,
)


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "use_mock_llm": True,
        "llm_max_retries": 0,
        "max_tool_steps": 2,
        "max_tool_result_bytes": 256,
    }
    values.update(overrides)
    return Settings(**values)


def _teacher() -> TeacherOutput:
    return TeacherOutput(
        acknowledgement="a",
        core_explanation="b",
        illustration="c",
        key_takeaway="d",
        assessment={"type": "RECOGNIZE", "question": "q?"},
    )


def _definition(name: str = "get_node_detail") -> ToolDefinition:
    return ToolDefinition(
        name=name,
        description="Read one bounded node.",
        parameters={
            "type": "object",
            "properties": {
                "workspace_id": {"type": "string"},
                "node_id": {"type": "string"},
            },
            "required": ["workspace_id", "node_id"],
            "additionalProperties": False,
        },
    )


@pytest.mark.contract
async def test_tool_call_loop_returns_final_structured_output() -> None:
    workspace_id = uuid4()
    revision_id = uuid4()
    node_id = uuid4()
    first = ProviderResponse(
        content=None,
        tool_calls=[
            ToolCall(
                id="call-1",
                name="get_node_detail",
                arguments={"workspace_id": str(workspace_id), "node_id": str(node_id)},
            )
        ],
        provider="mock",
        model="model",
    )
    provider = FakeProvider(
        [
            first,
            ProviderResponse(content=_teacher().model_dump_json(), provider="mock", model="model"),
        ]
    )

    async def execute(call: ToolCall, context: ModelCallContext) -> dict[str, object]:
        return {
            "workspace_id": str(workspace_id),
            "graph_revision_id": str(revision_id),
            "data": {"node_id": str(node_id)},
        }

    audit = InMemoryToolAuditSink()
    _, result = await ModelGateway(
        _settings(), provider, tool_audit_sink=audit
    ).generate_structured(
        role=ModelRole.TEACHER,
        messages=[ChatMessage(role="user", content="question")],
        response_model=TeacherOutput,
        context=ModelCallContext(
            workspace_id=workspace_id,
            graph_revision_id=revision_id,
            prompt_name="teacher_system",
        ),
        tools=[_definition()],
        tool_executor=execute,
    )

    assert result.tool_usage == {
        "enabled": True,
        "steps": 1,
        "tools": ["get_node_detail"],
        "fallback": False,
    }
    assert provider.calls[1][1][-1].role == "tool"
    assert len(audit.records) == 1
    assert audit.records[0].model_run_id is not None
    assert audit.records[0].graph_revision_id == revision_id


@pytest.mark.contract
async def test_multiple_tool_steps_preserve_order() -> None:
    workspace_id = uuid4()
    revision_id = uuid4()
    node_id = uuid4()
    provider = FakeProvider(
        [
            ProviderResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        id="call-1",
                        name="get_node_detail",
                        arguments={"node_id": str(node_id)},
                    )
                ],
                provider="mock",
                model="model",
            ),
            ProviderResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        id="call-2",
                        name="get_related_theories",
                        arguments={"node_id": str(node_id)},
                    )
                ],
                provider="mock",
                model="model",
            ),
            ProviderResponse(content=_teacher().model_dump_json(), provider="mock", model="model"),
        ]
    )
    definitions = [
        _definition(),
        ToolDefinition(
            name="get_related_theories",
            description="Read related theories.",
            parameters=_definition().parameters,
        ),
    ]

    async def execute(call: ToolCall, context: ModelCallContext) -> dict[str, object]:
        return {
            "workspace_id": str(workspace_id),
            "graph_revision_id": str(revision_id),
            "data": {"tool": call.name},
        }

    _, result = await ModelGateway(_settings(), provider).generate_structured(
        role=ModelRole.TEACHER,
        messages=[],
        response_model=TeacherOutput,
        context=ModelCallContext(
            workspace_id=workspace_id,
            graph_revision_id=revision_id,
            prompt_name="teacher_system",
        ),
        tools=definitions,
        tool_executor=execute,
    )
    assert result.tool_steps == 2
    assert result.tools_used == ["get_node_detail", "get_related_theories"]
    assert len(provider.calls) == 3


@pytest.mark.contract
async def test_one_provider_response_cannot_bypass_tool_step_budget() -> None:
    workspace_id = uuid4()
    calls = [
        ToolCall(
            id=f"call-{index}",
            name="get_node_detail",
            arguments={"node_id": str(uuid4())},
        )
        for index in range(3)
    ]
    provider = FakeProvider(
        [ProviderResponse(content=None, tool_calls=calls, provider="mock", model="model")]
    )
    executed: list[str] = []

    async def execute(call: ToolCall, context: ModelCallContext) -> dict[str, object]:
        executed.append(call.id)
        return {
            "workspace_id": str(workspace_id),
            "graph_revision_id": str(uuid4()),
            "data": {},
        }

    with pytest.raises(ToolCallRejected, match="maximum tool-call steps"):
        await ModelGateway(_settings(max_tool_steps=2), provider).generate_structured(
            role=ModelRole.TEACHER,
            messages=[],
            response_model=TeacherOutput,
            context=ModelCallContext(workspace_id=workspace_id, prompt_name="teacher_system"),
            tools=[_definition()],
            tool_executor=execute,
        )
    assert executed == []


@pytest.mark.contract
async def test_tool_choice_none_disables_tools_and_forced_choice_is_enforced() -> None:
    none_provider = FakeProvider(
        [ProviderResponse(content=_teacher().model_dump_json(), provider="mock", model="model")]
    )
    _, none_result = await ModelGateway(_settings(), none_provider).generate_structured(
        role=ModelRole.TEACHER,
        messages=[],
        response_model=TeacherOutput,
        context=ModelCallContext(prompt_name="teacher_system"),
        tools=[_definition()],
        tool_choice="none",
        tool_executor=lambda call, context: {},
    )
    assert none_result.tool_calling_enabled is False
    assert none_provider.tool_calls[0] == []

    workspace_id = uuid4()
    forced_provider = FakeProvider(
        [
            ProviderResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        id="wrong-call",
                        name="get_related_theories",
                        arguments={"node_id": str(uuid4())},
                    )
                ],
                provider="mock",
                model="model",
            )
        ]
    )
    definitions = [
        _definition(),
        ToolDefinition(
            name="get_related_theories",
            description="Read related theories.",
            parameters=_definition().parameters,
        ),
    ]
    with pytest.raises(ToolCallRejected, match="forced tool choice"):
        await ModelGateway(_settings(), forced_provider).generate_structured(
            role=ModelRole.TEACHER,
            messages=[],
            response_model=TeacherOutput,
            context=ModelCallContext(
                workspace_id=workspace_id,
                prompt_name="teacher_system",
            ),
            tools=definitions,
            tool_choice="get_node_detail",
            tool_executor=lambda call, context: {},
        )


@pytest.mark.contract
async def test_retry_does_not_reset_the_global_tool_budget() -> None:
    workspace_id = uuid4()
    provider = FakeProvider(
        [
            ProviderResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        id="once",
                        name="get_node_detail",
                        arguments={"node_id": str(uuid4())},
                    )
                ],
                provider="mock",
                model="model",
            ),
            ProviderResponse(content="{}", provider="mock", model="model"),
            ProviderResponse(content=_teacher().model_dump_json(), provider="mock", model="model"),
        ]
    )
    executed: list[str] = []

    async def execute(call: ToolCall, context: ModelCallContext) -> dict[str, object]:
        executed.append(call.id)
        return {
            "workspace_id": str(workspace_id),
            "graph_revision_id": str(uuid4()),
            "data": {},
        }

    _, result = await ModelGateway(
        _settings(llm_max_retries=1, max_tool_steps=1), provider
    ).generate_structured(
        role=ModelRole.TEACHER,
        messages=[],
        response_model=TeacherOutput,
        context=ModelCallContext(workspace_id=workspace_id, prompt_name="teacher_system"),
        tools=[_definition()],
        tool_executor=execute,
    )
    assert executed == ["once"]
    assert result.tool_steps == 1
    assert len(provider.calls) == 3
    assert provider.tool_calls[-1] == []


@pytest.mark.contract
async def test_tool_workspace_mismatch_is_rejected_without_retry() -> None:
    workspace_id = uuid4()
    provider = FakeProvider(
        [
            ProviderResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        id="call-1",
                        name="get_node_detail",
                        arguments={"workspace_id": str(uuid4()), "node_id": str(uuid4())},
                    )
                ],
                provider="mock",
                model="model",
            )
        ]
    )

    with pytest.raises(ToolCallRejected, match="workspace"):
        await ModelGateway(_settings(), provider).generate_structured(
            role=ModelRole.TEACHER,
            messages=[],
            response_model=TeacherOutput,
            context=ModelCallContext(workspace_id=workspace_id, prompt_name="teacher_system"),
            tools=[_definition()],
            tool_executor=lambda call, context: None,
        )
    assert len(provider.calls) == 1


@pytest.mark.contract
async def test_tool_result_is_bounded_and_marked_truncated() -> None:
    workspace_id = uuid4()
    revision_id = uuid4()
    call = ToolCall(
        id="call-1",
        name="get_node_detail",
        arguments={"workspace_id": str(workspace_id), "node_id": str(uuid4())},
    )
    provider = FakeProvider(
        [
            ProviderResponse(content=None, tool_calls=[call], provider="mock", model="model"),
            ProviderResponse(content=_teacher().model_dump_json(), provider="mock", model="model"),
        ]
    )

    async def execute(call: ToolCall, context: ModelCallContext) -> dict[str, object]:
        return {
            "workspace_id": str(workspace_id),
            "graph_revision_id": str(revision_id),
            "data": {"text": "x" * 5_000},
        }

    await ModelGateway(_settings(max_tool_result_bytes=256), provider).generate_structured(
        role=ModelRole.TEACHER,
        messages=[],
        response_model=TeacherOutput,
        context=ModelCallContext(
            workspace_id=workspace_id,
            graph_revision_id=revision_id,
            prompt_name="teacher_system",
        ),
        tools=[_definition()],
        tool_executor=execute,
    )
    tool_content = provider.calls[1][1][-1].content or ""
    assert len(tool_content.encode()) <= 256
    assert '"truncated":true' in tool_content.replace(" ", "")


@pytest.mark.contract
async def test_provider_without_tool_signature_falls_back_to_context() -> None:
    class LegacyProvider(ModelProvider):
        provider_name = "legacy"
        supports_tool_calling = False

        async def complete(self, *, model, messages, response_schema):
            return ProviderResponse(
                content=_teacher().model_dump_json(), provider=self.provider_name, model=model
            )

    _, result = await ModelGateway(_settings(), LegacyProvider()).generate_structured(
        role=ModelRole.TEACHER,
        messages=[ChatMessage(role="system", content="prefetched context")],
        response_model=TeacherOutput,
        context=ModelCallContext(prompt_name="teacher_system"),
        tools=[_definition()],
        tool_executor=lambda call, context: None,
    )
    assert result.tool_calling_fallback is True
    assert result.tool_steps == 0


@pytest.mark.contract
async def test_tool_unsupported_by_a_model_retries_without_tools() -> None:
    class Provider(ModelProvider):
        provider_name = "limited"
        supports_tool_calling = True

        def __init__(self) -> None:
            self.calls = 0

        async def complete(
            self,
            *,
            model: str,
            messages: list[ChatMessage],
            response_schema: dict[str, object],
            tools: list[ToolDefinition] | None = None,
            tool_choice: str | dict[str, object] | None = None,
        ) -> ProviderResponse:
            self.calls += 1
            if tools:
                raise RuntimeError("tools unsupported by this model")
            return ProviderResponse(
                content=_teacher().model_dump_json(), provider=self.provider_name, model=model
            )

    provider = Provider()
    model_runs = InMemoryModelRunSink()
    _, result = await ModelGateway(_settings(), provider, sink=model_runs).generate_structured(
        role=ModelRole.TEACHER,
        messages=[],
        response_model=TeacherOutput,
        context=ModelCallContext(prompt_name="teacher_system"),
        tools=[_definition()],
        tool_executor=lambda call, context: None,
    )
    assert provider.calls == 2
    assert result.tool_calling_fallback is True
    assert [record.status for record in model_runs.records] == ["FAILED", "SUCCEEDED"]
    assert model_runs.records[0].tool_calling_fallback is True
    assert model_runs.records[0].error_type == "RuntimeError"


@pytest.mark.contract
@pytest.mark.parametrize(
    "message",
    [
        "unknown parameter: tools",
        "function calling is disabled for this deployment",
        "tool_choice is not allowed for this model",
    ],
)
async def test_common_provider_tool_rejections_use_prefetched_fallback(message: str) -> None:
    class Provider(ModelProvider):
        provider_name = "limited"

        def __init__(self) -> None:
            self.calls = 0

        async def complete(
            self,
            *,
            model: str,
            messages: list[ChatMessage],
            response_schema: dict[str, object],
            tools: list[ToolDefinition] | None = None,
            tool_choice: str | dict[str, object] | None = None,
        ) -> ProviderResponse:
            self.calls += 1
            if tools:
                raise RuntimeError(message)
            return ProviderResponse(
                content=_teacher().model_dump_json(),
                provider=self.provider_name,
                model=model,
            )

    provider = Provider()
    _, result = await ModelGateway(_settings(), provider).generate_structured(
        role=ModelRole.TEACHER,
        messages=[ChatMessage(role="system", content="prefetched context")],
        response_model=TeacherOutput,
        context=ModelCallContext(prompt_name="teacher_system"),
        tools=[_definition()],
        tool_executor=lambda call, context: None,
    )

    assert provider.calls == 2
    assert result.tool_calling_fallback is True


@pytest.mark.contract
async def test_tool_execution_timeout_is_bounded() -> None:
    workspace_id = uuid4()
    provider = FakeProvider(
        [
            ProviderResponse(
                content=None,
                tool_calls=[
                    ToolCall(
                        id="call-1",
                        name="get_node_detail",
                        arguments={"node_id": str(uuid4())},
                    )
                ],
                provider="mock",
                model="model",
            )
        ]
    )

    async def slow_tool(call: ToolCall, context: ModelCallContext) -> dict[str, object]:
        await asyncio.sleep(0.05)
        return {}

    with pytest.raises(ToolCallRejected, match="TimeoutError"):
        await ModelGateway(_settings(tool_timeout_seconds=0.001), provider).generate_structured(
            role=ModelRole.TEACHER,
            messages=[],
            response_model=TeacherOutput,
            context=ModelCallContext(workspace_id=workspace_id, prompt_name="teacher_system"),
            tools=[_definition()],
            tool_executor=slow_tool,
        )
