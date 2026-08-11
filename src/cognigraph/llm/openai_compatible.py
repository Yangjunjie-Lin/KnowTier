from __future__ import annotations

import asyncio
import json
import math
from collections.abc import AsyncIterator, Mapping, Sequence
from typing import cast

import httpx
from pydantic import SecretStr

from cognigraph.llm.gateway import ModelProvider
from cognigraph.llm.schemas import (
    ChatMessage,
    ModelUsage,
    ProviderResponse,
    ToolCall,
    ToolDefinition,
)

MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_PROVIDER_SSE_LINE_BYTES = 256 * 1024


class OpenAICompatibleError(RuntimeError):
    """A sanitized provider error that never includes credentials or response bodies."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenAICompatibleProvider(ModelProvider):
    """Strict OpenAI-compatible chat, stream, model-discovery and embedding client."""

    supports_tool_calling = True

    def __init__(
        self,
        *,
        provider_name: str,
        base_url: str,
        api_key: SecretStr | str,
        timeout_seconds: float,
        max_retries: int,
        temperature: float,
        max_tokens: int,
        expected_embedding_dimensions: int = 1536,
        request_embedding_dimensions: bool = True,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if max_retries < 0:
            raise ValueError("max_retries cannot be negative")
        if not 0 <= temperature <= 2:
            raise ValueError("temperature must be between 0 and 2")
        if max_tokens <= 0:
            raise ValueError("max_tokens must be positive")
        if expected_embedding_dimensions <= 0:
            raise ValueError("expected_embedding_dimensions must be positive")
        secret = api_key.get_secret_value() if isinstance(api_key, SecretStr) else api_key
        if not secret:
            raise ValueError("an API key is required for an external provider")
        self.provider_name = provider_name
        # SiliconFlow discovery does not expose per-model tool capability. Sending
        # function tools to an arbitrary discovered model can leave a valid chat
        # pending until timeout; the gateway retains its bounded prefetched context.
        self.supports_tool_calling = not provider_name.casefold().startswith("siliconflow")
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.expected_embedding_dimensions = expected_embedding_dimensions
        self.request_embedding_dimensions = request_embedding_dimensions
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {secret}"},
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            follow_redirects=False,
            trust_env=False,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def list_models(self) -> list[str]:
        payload = await self._request_json("GET", "models")
        data = _list_field(payload, "data")
        model_ids: set[str] = set()
        for item in data:
            record = _mapping(item, "model entry")
            model_id = record.get("id")
            if isinstance(model_id, str) and model_id.strip():
                model_ids.add(model_id.strip())
        if not model_ids:
            raise OpenAICompatibleError("provider returned no usable models")
        return sorted(model_ids, key=str.casefold)

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        response_schema: dict[str, object],
        tools: list[ToolDefinition] | None = None,
        tool_choice: str | dict[str, object] | None = None,
    ) -> ProviderResponse:
        provider_messages = [_message_payload(message) for message in messages]
        if self.provider_name.casefold().startswith("siliconflow"):
            compact_schema = json.dumps(
                response_schema,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            provider_messages.insert(
                0,
                {
                    "role": "system",
                    "content": (
                        "Return exactly one concise JSON object and no other text. "
                        "The object must satisfy this JSON Schema:\n" + compact_schema
                    ),
                },
            )
            response_format: dict[str, object] = {"type": "json_object"}
        else:
            response_format = {
                "type": "json_schema",
                "json_schema": {
                    "name": "structured_response",
                    "strict": True,
                    "schema": response_schema,
                },
            }
        request: dict[str, object] = {
            "model": model,
            "messages": provider_messages,
            "response_format": response_format,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if tools:
            request["tools"] = [_tool_payload(item) for item in tools]
            if tool_choice is not None:
                request["tool_choice"] = tool_choice
        payload = await self._request_json("POST", "chat/completions", json_body=request)
        choices = _list_field(payload, "choices")
        if not choices:
            raise OpenAICompatibleError("provider response did not contain a choice")
        choice = _mapping(choices[0], "choice")
        message = _mapping(choice.get("message"), "choice message")
        content_value = message.get("content")
        content = content_value if isinstance(content_value, str) else None
        tool_calls = _parse_tool_calls(message.get("tool_calls"))
        if content is None and not tool_calls:
            raise OpenAICompatibleError("provider response contained neither content nor tools")
        usage = _usage(payload.get("usage"))
        finish_reason_value = choice.get("finish_reason")
        return ProviderResponse(
            content=content,
            tool_calls=tool_calls,
            finish_reason=(finish_reason_value if isinstance(finish_reason_value, str) else None),
            provider=self.provider_name,
            model=model,
            usage=usage,
        )

    async def stream_text(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
    ) -> AsyncIterator[str]:
        request: dict[str, object] = {
            "model": model,
            "messages": [_message_payload(message) for message in messages],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": False},
        }
        try:
            async with self._client.stream("POST", "chat/completions", json=request) as response:
                if not response.is_success:
                    raise _http_status_error(response.status_code)
                _check_response_size(response)
                received_bytes = 0
                async for line in response.aiter_lines():
                    received_bytes += len(line.encode("utf-8")) + 1
                    if len(line.encode("utf-8")) > MAX_PROVIDER_SSE_LINE_BYTES:
                        raise OpenAICompatibleError("provider stream line exceeded the size limit")
                    if received_bytes > MAX_PROVIDER_RESPONSE_BYTES:
                        raise OpenAICompatibleError("provider stream exceeded the size limit")
                    text = line.strip()
                    if not text or text.startswith(":"):
                        continue
                    if not text.startswith("data:"):
                        raise OpenAICompatibleError("provider returned malformed SSE data")
                    data = text[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        event_value = cast(object, json.loads(data))
                    except json.JSONDecodeError as exc:
                        raise OpenAICompatibleError("provider returned malformed SSE JSON") from exc
                    event = _mapping(event_value, "SSE event")
                    choices = _list_field(event, "choices")
                    if not choices:
                        continue
                    delta = _mapping(_mapping(choices[0], "SSE choice").get("delta"), "delta")
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        yield content
        except httpx.TimeoutException as exc:
            raise OpenAICompatibleError("provider stream timed out") from exc
        except httpx.RequestError as exc:
            raise OpenAICompatibleError("provider stream could not be reached") from exc

    async def embed(self, *, model: str, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        request: dict[str, object] = {
            "model": model,
            "input": texts,
        }
        if self.request_embedding_dimensions:
            request["dimensions"] = self.expected_embedding_dimensions
        payload = await self._request_json(
            "POST",
            "embeddings",
            json_body=request,
        )
        data = _list_field(payload, "data")
        indexed: list[tuple[int, list[float]]] = []
        for fallback_index, value in enumerate(data):
            record = _mapping(value, "embedding entry")
            index_value = record.get("index", fallback_index)
            if not isinstance(index_value, int):
                raise OpenAICompatibleError("provider returned an invalid embedding index")
            vector_value = record.get("embedding")
            if not isinstance(vector_value, list):
                raise OpenAICompatibleError("provider returned an invalid embedding vector")
            try:
                vector = [float(item) for item in vector_value]
            except (TypeError, ValueError) as exc:
                raise OpenAICompatibleError(
                    "provider returned a non-numeric embedding vector"
                ) from exc
            if not all(math.isfinite(item) for item in vector):
                raise OpenAICompatibleError("provider returned a non-finite embedding vector")
            if not vector:
                raise OpenAICompatibleError("provider returned an empty embedding vector")
            if len(vector) > self.expected_embedding_dimensions:
                raise OpenAICompatibleError(
                    "embedding dimensions exceed the configured vector store"
                )
            if len(vector) < self.expected_embedding_dimensions:
                if self.request_embedding_dimensions:
                    raise OpenAICompatibleError(
                        "embedding dimensions do not match the configured vector store"
                    )
                # Zero-padding preserves dot products, cosine similarity, and norms
                # while adapting fixed native provider vectors to the store width.
                vector.extend([0.0] * (self.expected_embedding_dimensions - len(vector)))
            indexed.append((index_value, vector))
        indexed.sort(key=lambda item: item[0])
        vectors = [item[1] for item in indexed]
        if len(vectors) != len(texts):
            raise OpenAICompatibleError("provider returned the wrong embedding row count")
        return vectors

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        last_error: OpenAICompatibleError | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.request(method, path, json=json_body)
                _check_response_size(response)
                if not response.is_success:
                    error = _http_status_error(response.status_code)
                    if not _retryable_status(response.status_code) or attempt >= self.max_retries:
                        raise error
                    last_error = error
                else:
                    try:
                        payload = cast(object, response.json())
                    except (json.JSONDecodeError, ValueError) as exc:
                        raise OpenAICompatibleError("provider returned malformed JSON") from exc
                    return _mapping(payload, "provider response")
            except httpx.TimeoutException as exc:
                last_error = OpenAICompatibleError("provider request timed out")
                if attempt >= self.max_retries:
                    raise last_error from exc
            except httpx.RequestError as exc:
                last_error = OpenAICompatibleError("provider could not be reached")
                if attempt >= self.max_retries:
                    raise last_error from exc
            if attempt < self.max_retries:
                await asyncio.sleep(min(0.1 * (2**attempt), 0.5))
        raise last_error or OpenAICompatibleError("provider request failed")


class OpenAICompatibleEmbeddingProvider:
    def __init__(self, provider: OpenAICompatibleProvider, model: str) -> None:
        self.provider = provider
        self.model = model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            return await self.provider.embed(model=self.model, texts=texts)
        except OpenAICompatibleError as exc:
            raise OpenAICompatibleError(
                f"Embedding model '{self.model}' failed: {exc}",
                status_code=exc.status_code,
            ) from exc


def _message_payload(message: ChatMessage) -> dict[str, object]:
    payload: dict[str, object] = {"role": message.role}
    if message.content is not None:
        payload["content"] = message.content
    if message.name is not None:
        payload["name"] = message.name
    if message.tool_call_id is not None:
        payload["tool_call_id"] = message.tool_call_id
    if message.tool_calls:
        payload["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                },
            }
            for call in message.tool_calls
        ]
    return payload


def _tool_payload(definition: ToolDefinition) -> dict[str, object]:
    return {
        "type": "function",
        "function": {
            "name": definition.name,
            "description": definition.description,
            "parameters": definition.parameters,
        },
    }


def _parse_tool_calls(value: object) -> list[ToolCall]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise OpenAICompatibleError("provider returned invalid tool calls")
    parsed: list[ToolCall] = []
    for item in value:
        record = _mapping(item, "tool call")
        call_id = record.get("id")
        function = _mapping(record.get("function"), "tool function")
        name = function.get("name")
        arguments_value = function.get("arguments", {})
        if isinstance(arguments_value, str):
            try:
                arguments_value = cast(object, json.loads(arguments_value))
            except json.JSONDecodeError as exc:
                raise OpenAICompatibleError("provider returned malformed tool arguments") from exc
        if not isinstance(call_id, str) or not isinstance(name, str):
            raise OpenAICompatibleError("provider returned an incomplete tool call")
        arguments = _mapping(arguments_value, "tool arguments")
        parsed.append(ToolCall(id=call_id, name=name, arguments=dict(arguments)))
    return parsed


def _usage(value: object) -> ModelUsage:
    if value is None:
        return ModelUsage()
    record = _mapping(value, "usage")
    prompt = record.get("prompt_tokens", 0)
    completion = record.get("completion_tokens", 0)
    if not isinstance(prompt, int) or not isinstance(completion, int):
        raise OpenAICompatibleError("provider returned invalid usage metadata")
    return ModelUsage(input_tokens=prompt, output_tokens=completion)


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise OpenAICompatibleError(f"provider returned an invalid {label}")
    return cast(Mapping[str, object], value)


def _list_field(payload: Mapping[str, object], name: str) -> list[object]:
    value = payload.get(name)
    if not isinstance(value, list):
        raise OpenAICompatibleError(f"provider response field {name} is not a list")
    return cast(list[object], value)


def _retryable_status(status_code: int) -> bool:
    return status_code in {408, 429} or status_code >= 500


def _check_response_size(response: httpx.Response) -> None:
    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except ValueError as exc:
            raise OpenAICompatibleError("provider returned an invalid content length") from exc
        if declared_length > MAX_PROVIDER_RESPONSE_BYTES:
            raise OpenAICompatibleError("provider response exceeded the size limit")
    if response.is_stream_consumed and len(response.content) > MAX_PROVIDER_RESPONSE_BYTES:
        raise OpenAICompatibleError("provider response exceeded the size limit")


def _http_status_error(status_code: int) -> OpenAICompatibleError:
    summary = {
        400: "provider rejected the request or model",
        401: "provider rejected the API key",
        403: "provider denied access",
        404: "provider endpoint or model was not found",
        408: "provider request timed out",
        429: "provider rate limit was reached",
    }.get(status_code, "provider request failed")
    return OpenAICompatibleError(summary, status_code=status_code)
