from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from time import perf_counter
from typing import Any, TypeVar
from uuid import uuid4

from pydantic import BaseModel, SecretStr, ValidationError

from cognigraph.config import Settings
from cognigraph.llm.observability import (
    InMemoryModelRunSink,
    ModelRunSink,
    model_run_record,
)
from cognigraph.llm.routing import ModelRouter
from cognigraph.llm.schemas import (
    ChatMessage,
    ModelCallContext,
    ModelRole,
    ModelUsage,
    ProviderResponse,
    StructuredCallResult,
)

SchemaT = TypeVar("SchemaT", bound=BaseModel)


class ModelGatewayError(RuntimeError):
    """Raised after all configured provider attempts fail."""


class ModelProvider(ABC):
    provider_name: str

    @abstractmethod
    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        response_schema: dict[str, Any],
    ) -> ProviderResponse:
        raise RuntimeError("provider implementation must override complete")


class LiteLLMProvider(ModelProvider):
    provider_name = "litellm"

    def __init__(self, api_key: SecretStr | str | None = None) -> None:
        self._api_key = api_key.get_secret_value() if isinstance(api_key, SecretStr) else api_key

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        response_schema: dict[str, Any],
    ) -> ProviderResponse:
        try:
            from litellm import acompletion
        except ImportError as exc:  # pragma: no cover - dependency error is environment-specific
            raise ModelGatewayError(
                "LiteLLM is not installed; enable MockProvider or install dependencies"
            ) from exc
        call_options: dict[str, Any] = {}
        if self._api_key:
            call_options["api_key"] = self._api_key
        response = await acompletion(
            model=model,
            messages=[message.model_dump() for message in messages],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "structured_response", "schema": response_schema},
            },
            **call_options,
        )
        content = response.choices[0].message.content or "{}"
        usage_obj = getattr(response, "usage", None)
        hidden = getattr(response, "_hidden_params", {})
        estimated_cost = (
            float(hidden.get("response_cost") or 0.0) if isinstance(hidden, dict) else 0.0
        )
        usage = ModelUsage(
            input_tokens=int(getattr(usage_obj, "prompt_tokens", 0) or 0),
            output_tokens=int(getattr(usage_obj, "completion_tokens", 0) or 0),
            estimated_cost=estimated_cost,
        )
        return ProviderResponse(
            content=content,
            provider=self.provider_name,
            model=model,
            usage=usage,
        )


class ModelGateway:
    def __init__(
        self,
        settings: Settings,
        provider: ModelProvider,
        *,
        fallback_provider: ModelProvider | None = None,
        sink: ModelRunSink | None = None,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.fallback_provider = fallback_provider
        self.router = ModelRouter(settings)
        self.sink = sink or InMemoryModelRunSink()
        self._semaphore = asyncio.Semaphore(settings.llm_max_concurrency)

    async def generate_structured(
        self,
        *,
        role: ModelRole,
        messages: list[ChatMessage],
        response_model: type[SchemaT],
        context: ModelCallContext,
    ) -> tuple[SchemaT, StructuredCallResult]:
        candidates = self.router.route(role).candidates
        providers = (
            (self.provider,)
            if self.fallback_provider is None
            else (
                self.provider,
                self.fallback_provider,
            )
        )
        errors: list[Exception] = []
        attempt = 0
        for model in candidates:
            for provider in providers:
                for repair_index in range(self.settings.llm_max_retries + 1):
                    attempt += 1
                    run_id = uuid4()
                    started = perf_counter()
                    call_messages = list(messages)
                    if repair_index:
                        call_messages.append(
                            ChatMessage(
                                role="system",
                                content="Return only valid JSON matching the supplied schema.",
                            )
                        )
                    try:
                        async with self._semaphore:
                            raw = await asyncio.wait_for(
                                provider.complete(
                                    model=model,
                                    messages=call_messages,
                                    response_schema=response_model.model_json_schema(),
                                ),
                                timeout=self.settings.llm_timeout_seconds,
                            )
                        parsed = self._validate_json(raw.content, response_model)
                        latency = int((perf_counter() - started) * 1000)
                        await self.sink.record_model_run(
                            model_run_record(
                                run_id=run_id,
                                context=context,
                                provider=raw.provider,
                                model=raw.model,
                                role=role,
                                usage=raw.usage,
                                latency_ms=latency,
                                status="SUCCEEDED",
                            )
                        )
                        result = StructuredCallResult(
                            value=parsed.model_dump(mode="json"),
                            model_run_id=run_id,
                            provider=raw.provider,
                            model=raw.model,
                            usage=raw.usage,
                            latency_ms=latency,
                            repaired=repair_index > 0,
                        )
                        return parsed, result
                    except (
                        TimeoutError,
                        ValidationError,
                        json.JSONDecodeError,
                        RuntimeError,
                    ) as exc:
                        errors.append(exc)
                        latency = int((perf_counter() - started) * 1000)
                        await self.sink.record_model_run(
                            model_run_record(
                                run_id=run_id,
                                context=context,
                                provider=provider.provider_name,
                                model=model,
                                role=role,
                                usage=ModelUsage(),
                                latency_ms=latency,
                                status="FAILED",
                                error_type=type(exc).__name__,
                            )
                        )
                        if attempt > 1:
                            await asyncio.sleep(min(0.05 * (2 ** min(attempt, 5)), 0.5))
        summary = "; ".join(type(item).__name__ for item in errors[-3:])
        raise ModelGatewayError(f"structured model call failed after {attempt} attempts: {summary}")

    @staticmethod
    def _validate_json(content: str, response_model: type[SchemaT]) -> SchemaT:
        normalized = content.strip()
        if normalized.startswith("```"):
            lines = normalized.splitlines()
            normalized = "\n".join(lines[1:-1]).strip()
        try:
            return response_model.model_validate_json(normalized)
        except (ValidationError, json.JSONDecodeError):
            start = normalized.find("{")
            end = normalized.rfind("}")
            if start < 0 or end <= start:
                raise
            return response_model.model_validate(json.loads(normalized[start : end + 1]))
