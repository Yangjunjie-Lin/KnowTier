from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from uuid import uuid4

import httpx
import pytest

from cognigraph.config import Settings
from cognigraph.ingestion.models import VisionDocumentOutput
from cognigraph.llm.gateway import ModelGateway
from cognigraph.llm.openai_compatible import (
    OpenAICompatibleError,
    OpenAICompatibleProvider,
)
from cognigraph.llm.schemas import ChatMessage, ModelCallContext, ModelRole, TeacherOutput


def provider(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    retries: int = 0,
    dimensions: int = 3,
    request_dimensions: bool = True,
    provider_name: str = "contract",
) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        provider_name=provider_name,
        base_url="https://provider.example/v1",
        api_key="contract-test-key",
        timeout_seconds=0.1,
        max_retries=retries,
        temperature=0.2,
        max_tokens=256,
        expected_embedding_dimensions=dimensions,
        request_embedding_dimensions=request_dimensions,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.contract
async def test_siliconflow_uses_prefetched_context_without_undeclared_tools() -> None:
    model_provider = provider(
        lambda _request: httpx.Response(200, json=chat_payload('{"ok":true}')),
        provider_name="siliconflow",
    )

    try:
        assert model_provider.supports_tool_calling is False
    finally:
        await model_provider.aclose()


def chat_payload(content: str) -> dict[str, object]:
    return {
        "choices": [
            {
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 8, "completion_tokens": 12},
    }


@pytest.mark.contract
async def test_vision_multimodal_structured_output_flows_through_model_gateway() -> None:
    image_url = "data:image/png;base64,iVBORw0KGgo="

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["model"] == "discovered-vision-model"
        assert payload["messages"] == [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract visible learning content."},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ]
        response_format = payload["response_format"]
        assert response_format["type"] == "json_schema"
        schema = response_format["json_schema"]["schema"]
        assert "blocks" in schema["properties"]
        return httpx.Response(
            200,
            json=chat_payload(
                json.dumps(
                    {
                        "language": "en",
                        "blocks": [
                            {
                                "text": "Retrieval augmented generation",
                                "block_type": "heading",
                                "page_number": 1,
                                "confidence": 0.97,
                            }
                        ],
                        "warnings": [],
                    }
                )
            ),
        )

    model_provider = provider(handler)
    gateway = ModelGateway(
        Settings(
            _env_file=None,
            use_mock_llm=False,
            vision_model="discovered-vision-model",
            fallback_models=(),
            llm_max_retries=0,
            llm_timeout_seconds=0.2,
        ),
        model_provider,
    )
    try:
        value, result = await gateway.generate_structured(
            role=ModelRole.VISION,
            messages=[
                ChatMessage(
                    role="user",
                    content=[
                        {"type": "text", "text": "Extract visible learning content."},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                )
            ],
            response_model=VisionDocumentOutput,
            context=ModelCallContext(
                workspace_id=uuid4(),
                document_id=uuid4(),
                prompt_name="vision_parser",
            ),
        )
    finally:
        await model_provider.aclose()

    assert value.blocks[0].text == "Retrieval augmented generation"
    assert result.model == "discovered-vision-model"
    assert result.provider == "contract"


@pytest.mark.contract
async def test_chat_and_json_schema_flow_through_model_gateway() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer contract-test-key"
        payload = json.loads(request.content)
        assert payload["response_format"]["type"] == "json_schema"
        assert payload["temperature"] == pytest.approx(0.2)
        return httpx.Response(
            200,
            json=chat_payload(
                json.dumps(
                    {
                        "acknowledgement": "Good question.",
                        "core_explanation": "A prerequisite supports a later idea.",
                        "illustration": "Addition precedes multiplication.",
                        "key_takeaway": "Learn dependencies in order.",
                        "assessment": {
                            "type": "RECOGNIZE",
                            "question": "Which idea comes first?",
                        },
                    }
                )
            ),
        )

    model_provider = provider(handler)
    gateway = ModelGateway(
        Settings(
            _env_file=None,
            use_mock_llm=False,
            teacher_model="discovered-chat-model",
            fallback_models=(),
            llm_max_retries=0,
            llm_timeout_seconds=0.2,
        ),
        model_provider,
    )
    try:
        value, result = await gateway.generate_structured(
            role=ModelRole.TEACHER,
            messages=[ChatMessage(role="user", content="Explain prerequisites")],
            response_model=TeacherOutput,
            context=ModelCallContext(
                workspace_id=uuid4(),
                prompt_name="teacher_system",
            ),
        )
    finally:
        await model_provider.aclose()

    assert value.key_takeaway == "Learn dependencies in order."
    assert result.provider == "contract"
    assert result.model == "discovered-chat-model"
    assert result.usage.output_tokens == 12


@pytest.mark.contract
async def test_siliconflow_uses_json_object_mode_with_a_bounded_schema_instruction() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["response_format"] == {"type": "json_object"}
        messages = payload["messages"]
        assert messages[0]["role"] == "system"
        assert "exactly one concise JSON object" in messages[0]["content"]
        assert '"ok"' in messages[0]["content"]
        assert messages[-1] == {"role": "user", "content": "return the probe"}
        return httpx.Response(200, json=chat_payload('{"ok":true}'))

    model_provider = provider(handler, provider_name="siliconflow")
    try:
        response = await model_provider.complete(
            model="discovered-chat-model",
            messages=[ChatMessage(role="user", content="return the probe")],
            response_schema={
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            },
        )
    finally:
        await model_provider.aclose()

    assert response.content == '{"ok":true}'


@pytest.mark.contract
async def test_stream_parses_openai_sse_without_exposing_raw_events() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=(
                b'data: {"choices":[{"delta":{"content":"Know"}}]}\n\n'
                b'data: {"choices":[{"delta":{"content":"Tier"}}]}\n\n'
                b"data: [DONE]\n\n"
            ),
        )

    model_provider = provider(handler)
    chunks: list[str] = []
    try:
        stream: AsyncIterator[str] = model_provider.stream_text(
            model="discovered-chat-model",
            messages=[ChatMessage(role="user", content="hello")],
        )
        async for chunk in stream:
            chunks.append(chunk)
    finally:
        await model_provider.aclose()
    assert chunks == ["Know", "Tier"]


@pytest.mark.contract
async def test_embedding_contract_preserves_order_and_dimensions() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload == {
            "model": "discovered-embedding-model",
            "input": ["first", "second"],
            "dimensions": 3,
        }
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [0, 1, 0]},
                    {"index": 0, "embedding": [1, 0, 0]},
                ]
            },
        )

    model_provider = provider(handler)
    try:
        vectors = await model_provider.embed(
            model="discovered-embedding-model",
            texts=["first", "second"],
        )
    finally:
        await model_provider.aclose()
    assert vectors == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]


@pytest.mark.contract
async def test_embedding_contract_adapts_native_dimensions_without_request_override() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload == {
            "model": "native-embedding-model",
            "input": ["first"],
        }
        return httpx.Response(
            200,
            json={"data": [{"index": 0, "embedding": [0.6, 0.8]}]},
        )

    model_provider = provider(handler, dimensions=3, request_dimensions=False)
    try:
        vectors = await model_provider.embed(
            model="native-embedding-model",
            texts=["first"],
        )
    finally:
        await model_provider.aclose()
    assert vectors == [[0.6, 0.8, 0.0]]


@pytest.mark.contract
async def test_models_are_discovered_dynamically_and_sorted() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"data": [{"id": "z-chat"}, {"id": "a-embedding"}]},
        )

    model_provider = provider(handler)
    try:
        assert await model_provider.list_models() == ["a-embedding", "z-chat"]
    finally:
        await model_provider.aclose()


@pytest.mark.contract
async def test_timeout_is_sanitized_and_bounded() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("secret response text", request=request)

    model_provider = provider(handler)
    try:
        with pytest.raises(OpenAICompatibleError, match="timed out") as captured:
            await model_provider.list_models()
    finally:
        await model_provider.aclose()
    assert "secret response text" not in str(captured.value)


@pytest.mark.contract
async def test_429_retries_once_then_succeeds() -> None:
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, json={"error": {"message": "quota detail"}})
        return httpx.Response(200, json={"data": [{"id": "available"}]})

    model_provider = provider(handler, retries=1)
    try:
        assert await model_provider.list_models() == ["available"]
    finally:
        await model_provider.aclose()
    assert attempts == 2


@pytest.mark.contract
@pytest.mark.parametrize(
    ("status_code", "message"),
    [(401, "API key"), (404, "not found")],
)
async def test_invalid_key_and_invalid_model_are_clear_but_sanitized(
    status_code: int,
    message: str,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code,
            json={"error": {"message": "do-not-expose-provider-body"}},
        )

    model_provider = provider(handler)
    try:
        with pytest.raises(OpenAICompatibleError, match=message) as captured:
            await model_provider.complete(
                model="invalid-model",
                messages=[ChatMessage(role="user", content="hello")],
                response_schema={"type": "object"},
            )
    finally:
        await model_provider.aclose()
    assert captured.value.status_code == status_code
    assert "do-not-expose-provider-body" not in str(captured.value)


@pytest.mark.contract
async def test_malformed_provider_response_is_rejected() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": "not-a-list"})

    model_provider = provider(handler)
    try:
        with pytest.raises(OpenAICompatibleError, match="choices"):
            await model_provider.complete(
                model="chat-model",
                messages=[ChatMessage(role="user", content="hello")],
                response_schema={"type": "object"},
            )
    finally:
        await model_provider.aclose()


@pytest.mark.contract
async def test_non_finite_embedding_values_are_rejected() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b'{"data":[{"index":0,"embedding":[NaN,0,0]}]}',
            headers={"content-type": "application/json"},
        )

    model_provider = provider(handler)
    try:
        with pytest.raises(OpenAICompatibleError, match="non-finite"):
            await model_provider.embed(model="embedding-model", texts=["text"])
    finally:
        await model_provider.aclose()


@pytest.mark.contract
async def test_oversized_provider_response_is_rejected() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-length": str(4 * 1024 * 1024 + 1)},
            content=b"{}",
        )

    model_provider = provider(handler)
    try:
        with pytest.raises(OpenAICompatibleError, match="size limit"):
            await model_provider.list_models()
    finally:
        await model_provider.aclose()
