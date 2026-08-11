from __future__ import annotations

import asyncio
import inspect
import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any, Protocol, TypeVar, cast
from uuid import UUID, uuid4

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
    ToolCall,
    ToolDefinition,
    ToolResult,
)

SchemaT = TypeVar("SchemaT", bound=BaseModel)
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _ToolBudget:
    """Shared across provider/retry attempts so retries cannot repeat reads."""

    used: int = 0
    names: list[str] = field(default_factory=list)


class ModelGatewayError(RuntimeError):
    """Raised after all configured provider attempts fail."""

    def __init__(self, message: str, *, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.cause = cause
        status_code = getattr(cause, "status_code", None)
        self.status_code = status_code if isinstance(status_code, int) else None


class ToolCallRejected(ModelGatewayError):
    """Raised when an untrusted model requests an unknown or unsafe operation."""


class ToolExecutor(Protocol):
    async def execute_tool(
        self, call: ToolCall, *, context: ModelCallContext
    ) -> ToolResult | Mapping[str, object]: ...


ToolExecutorCallable = Callable[
    [ToolCall, ModelCallContext], Awaitable[ToolResult | Mapping[str, object]]
]


class ToolAuditSink(Protocol):
    def record(self, call: Any) -> None: ...


class ModelProvider(ABC):
    provider_name: str
    supports_tool_calling: bool = True

    @abstractmethod
    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        response_schema: dict[str, Any],
        tools: list[ToolDefinition] | None = None,
        tool_choice: str | dict[str, object] | None = None,
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
        tools: list[ToolDefinition] | None = None,
        tool_choice: str | dict[str, object] | None = None,
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
        request_options: dict[str, Any] = {
            "model": model,
            "messages": _provider_messages(messages),
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "structured_response", "schema": response_schema},
            },
        }
        if tools:
            request_options["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": definition.name,
                        "description": definition.description,
                        "parameters": definition.parameters,
                    },
                }
                for definition in tools
            ]
            if tool_choice is not None:
                request_options["tool_choice"] = tool_choice
        request_options.update(call_options)
        response = await acompletion(**request_options)
        message = response.choices[0].message
        content_obj = getattr(message, "content", None)
        content = str(content_obj) if content_obj is not None else None
        tool_calls = _parse_provider_tool_calls(getattr(message, "tool_calls", None))
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
            tool_calls=tool_calls,
            finish_reason=(
                str(getattr(response.choices[0], "finish_reason", ""))
                if getattr(response.choices[0], "finish_reason", None) is not None
                else None
            ),
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
        tool_executor: ToolExecutor | ToolExecutorCallable | None = None,
        tool_definitions: Sequence[ToolDefinition] | None = None,
        tool_audit_sink: ToolAuditSink | None = None,
    ) -> None:
        self.settings = settings
        self.provider = provider
        self.fallback_provider = fallback_provider
        self.router = ModelRouter(settings)
        self.sink = sink or InMemoryModelRunSink()
        self.tool_executor = tool_executor
        self.tool_definitions = list(tool_definitions or ())
        self.tool_audit_sink = tool_audit_sink
        self._semaphore = asyncio.Semaphore(settings.llm_max_concurrency)

    async def generate_structured(
        self,
        *,
        role: ModelRole,
        messages: list[ChatMessage],
        response_model: type[SchemaT],
        context: ModelCallContext,
        tools: Sequence[ToolDefinition] | None = None,
        tool_choice: str | dict[str, object] | None = None,
        tool_executor: ToolExecutor | ToolExecutorCallable | None = None,
    ) -> tuple[SchemaT, StructuredCallResult]:
        """Generate a structured response, optionally running bounded read tools.

        Tool calls are treated as untrusted model output.  The executor is the
        only component allowed to perform a read, and every argument is checked
        against the registered names and request context before execution.
        """

        requested_tools = list(tools if tools is not None else self.tool_definitions)
        executor = tool_executor if tool_executor is not None else self.tool_executor
        _validate_tool_choice(tool_choice, requested_tools)
        use_tools = bool(
            requested_tools
            and executor
            and self.settings.tool_calling_enabled
            and not _tool_choice_is_none(tool_choice)
        )
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
        tool_budget = _ToolBudget()
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
                        parsed, result = await self._complete_attempt(
                            provider=provider,
                            model=model,
                            messages=call_messages,
                            response_model=response_model,
                            context=context,
                            role=role,
                            requested_tools=requested_tools,
                            allow_tools=use_tools,
                            tool_choice=tool_choice,
                            executor=executor,
                            repaired=repair_index > 0,
                            tool_budget=tool_budget,
                        )
                        return parsed, result
                    except ToolCallRejected:
                        # Security violations are deterministic and must never be
                        # retried against another provider.
                        raise
                    except Exception as exc:
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
        last_error = errors[-1] if errors else None
        message = f"structured model call failed after {attempt} attempts: {summary}"
        raise ModelGatewayError(message, cause=last_error) from last_error

    async def _complete_attempt(
        self,
        *,
        provider: ModelProvider,
        model: str,
        messages: list[ChatMessage],
        response_model: type[SchemaT],
        context: ModelCallContext,
        role: ModelRole,
        requested_tools: list[ToolDefinition],
        allow_tools: bool,
        tool_choice: str | dict[str, object] | None,
        executor: ToolExecutor | ToolExecutorCallable | None,
        repaired: bool,
        tool_budget: _ToolBudget,
    ) -> tuple[SchemaT, StructuredCallResult]:
        started = perf_counter()
        provider_supports_tools = _provider_supports_tools(provider)
        choice_none = _tool_choice_is_none(tool_choice)
        fallback = bool(
            requested_tools and not choice_none and (not allow_tools or not provider_supports_tools)
        )
        active_tools = (
            requested_tools
            if requested_tools and allow_tools and provider_supports_tools and not choice_none
            else []
        )
        call_messages = list(messages)
        if fallback:
            call_messages.append(
                ChatMessage(
                    role="system",
                    content=(
                        "Tool calling is unavailable for this model. Use only the supplied "
                        "bounded context bundle; do not claim to have queried the graph."
                    ),
                )
            )
            logger.info(
                "tool calling fallback activated",
                extra={
                    "tool_calling_fallback": True,
                    "provider": provider.provider_name,
                    "model": model,
                },
            )
        tool_steps = tool_budget.used
        tools_used = tool_budget.names
        seen_call_ids: set[str] = set()
        last_usage = ModelUsage()
        last_model_run_id = uuid4()
        while True:
            if active_tools and tool_budget.used >= self.settings.max_tool_steps:
                # Make one final response-only request after the deterministic
                # budget is exhausted.  A model that still emits calls is rejected.
                active_tools = []
                call_messages.append(
                    ChatMessage(
                        role="system",
                        content="Tool-call budget exhausted. Return the final JSON response now.",
                    )
                )
            call_run_id = uuid4()
            last_model_run_id = call_run_id
            try:
                async with self._semaphore:
                    raw = await asyncio.wait_for(
                        _provider_complete(
                            provider,
                            model=model,
                            messages=call_messages,
                            response_schema=response_model.model_json_schema(),
                            tools=active_tools or None,
                            tool_choice=tool_choice if active_tools else None,
                        ),
                        timeout=self.settings.llm_timeout_seconds,
                    )
            except Exception as exc:
                if active_tools and _is_unsupported_tool_calling_error(exc):
                    fallback = True
                    await self.sink.record_model_run(
                        model_run_record(
                            run_id=call_run_id,
                            context=context,
                            provider=provider.provider_name,
                            model=model,
                            role=role,
                            usage=ModelUsage(),
                            latency_ms=max(0, int((perf_counter() - started) * 1000)),
                            status="FAILED",
                            error_type=type(exc).__name__,
                            tool_step_count=tool_budget.used,
                            tool_calling_fallback=True,
                        )
                    )
                    active_tools = []
                    call_messages.append(
                        ChatMessage(
                            role="system",
                            content=(
                                "Tool calling is unavailable for this model. Use only the "
                                "prefetched bounded context and return the final JSON response."
                            ),
                        )
                    )
                    logger.info(
                        "tool calling fallback activated",
                        extra={
                            "tool_calling_fallback": True,
                            "provider": provider.provider_name,
                            "model": model,
                        },
                    )
                    continue
                raise
            last_usage = raw.usage
            if raw.tool_calls:
                if not active_tools or executor is None:
                    for rejected_call in raw.tool_calls:
                        self._record_tool_audit(
                            rejected_call,
                            context=context,
                            model_run_id=call_run_id,
                            result=None,
                            latency_ms=0,
                            tool_step=tool_budget.used + 1,
                            status="REJECTED",
                        )
                    raise ToolCallRejected(
                        "model returned tool calls when tool calling is disabled"
                    )
                batch_size = len(raw.tool_calls)
                await self.sink.record_model_run(
                    model_run_record(
                        run_id=call_run_id,
                        context=context,
                        provider=raw.provider,
                        model=raw.model,
                        role=role,
                        usage=raw.usage,
                        latency_ms=max(0, int((perf_counter() - started) * 1000)),
                        status="TOOL_CALL",
                        tool_step_count=tool_budget.used + batch_size,
                        tool_calling_fallback=fallback,
                    )
                )
                if tool_budget.used + batch_size > self.settings.max_tool_steps:
                    for index, rejected_call in enumerate(raw.tool_calls, start=1):
                        self._record_tool_audit(
                            rejected_call,
                            context=context,
                            model_run_id=call_run_id,
                            result=None,
                            latency_ms=0,
                            tool_step=tool_budget.used + index,
                            status="REJECTED",
                        )
                    raise ToolCallRejected("maximum tool-call steps exceeded")

                bound_calls: list[ToolCall] = []
                forced_tool_name = _forced_tool_name(tool_choice)
                batch_call_ids: set[str] = set()
                for index, call in enumerate(raw.tool_calls, start=1):
                    if call.id in seen_call_ids or call.id in batch_call_ids:
                        self._record_tool_audit(
                            call,
                            context=context,
                            model_run_id=call_run_id,
                            result=None,
                            latency_ms=0,
                            tool_step=tool_budget.used + index,
                            status="REJECTED",
                        )
                        raise ToolCallRejected("provider returned duplicate tool call ids")
                    batch_call_ids.add(call.id)
                    if call.name not in {item.name for item in requested_tools}:
                        self._record_tool_audit(
                            call,
                            context=context,
                            model_run_id=call_run_id,
                            result=None,
                            latency_ms=0,
                            tool_step=tool_budget.used + index,
                            status="REJECTED",
                        )
                        raise ToolCallRejected(f"unknown graph tool: {call.name}")
                    if forced_tool_name is not None and call.name != forced_tool_name:
                        self._record_tool_audit(
                            call,
                            context=context,
                            model_run_id=call_run_id,
                            result=None,
                            latency_ms=0,
                            tool_step=tool_budget.used + index,
                            status="REJECTED",
                        )
                        raise ToolCallRejected(
                            f"provider did not honor forced tool choice: {forced_tool_name}"
                        )
                    try:
                        bound_call = _validate_tool_call(
                            call,
                            definitions=requested_tools,
                            context=context,
                            settings=self.settings,
                        )
                    except ToolCallRejected:
                        self._record_tool_audit(
                            call,
                            context=context,
                            model_run_id=call_run_id,
                            result=None,
                            latency_ms=0,
                            tool_step=tool_budget.used + index,
                            status="REJECTED",
                        )
                        raise
                    bound_calls.append(bound_call)

                seen_call_ids.update(batch_call_ids)
                call_messages.append(
                    ChatMessage(role="assistant", content=raw.content, tool_calls=raw.tool_calls)
                )
                for bound_call in bound_calls:
                    tool_budget.used += 1
                    tool_steps = tool_budget.used
                    if bound_call.name not in tools_used:
                        tools_used.append(bound_call.name)
                    result = await self._run_tool(
                        executor,
                        bound_call,
                        context=context,
                        model_run_id=call_run_id,
                        tool_step=tool_steps,
                    )
                    call_messages.append(
                        ChatMessage(
                            role="tool",
                            name=result.name,
                            tool_call_id=result.tool_call_id,
                            content=json.dumps(
                                result.content,
                                ensure_ascii=False,
                                separators=(",", ":"),
                                sort_keys=True,
                            ),
                        )
                    )
                continue
            if raw.content is None:
                raise ValueError("provider returned neither content nor tool calls")
            if tool_choice in ("required",) or _forced_tool_name(tool_choice) is not None:
                raise ToolCallRejected("provider did not honor the required tool choice")
            try:
                parsed = self._validate_json(raw.content, response_model)
            except (ValidationError, json.JSONDecodeError):
                encoded = raw.content.encode("utf-8")
                logger.warning(
                    "invalid structured output metadata schema=%s provider=%s model=%s "
                    "finish_reason=%s output_tokens=%s response_bytes=%s "
                    "has_open_brace=%s has_close_brace=%s starts_fence=%s",
                    response_model.__name__,
                    raw.provider,
                    raw.model,
                    raw.finish_reason or "unknown",
                    raw.usage.output_tokens,
                    len(encoded),
                    "{" in raw.content,
                    "}" in raw.content,
                    raw.content.lstrip().startswith("```"),
                )
                raise
            latency = int((perf_counter() - started) * 1000)
            await self.sink.record_model_run(
                model_run_record(
                    run_id=last_model_run_id,
                    context=context,
                    provider=raw.provider,
                    model=raw.model,
                    role=role,
                    usage=last_usage,
                    latency_ms=latency,
                    status="SUCCEEDED",
                    tool_step_count=tool_budget.used,
                    tool_calling_fallback=fallback,
                )
            )
            return parsed, StructuredCallResult(
                value=parsed.model_dump(mode="json"),
                model_run_id=last_model_run_id,
                provider=raw.provider,
                model=raw.model,
                usage=last_usage,
                latency_ms=latency,
                repaired=repaired,
                tool_calling_enabled=bool(requested_tools and not choice_none),
                tool_calling_fallback=fallback,
                tool_steps=tool_budget.used,
                tools_used=tools_used,
                context_truncated=context.context_truncated,
            )

    async def _run_tool(
        self,
        executor: ToolExecutor | ToolExecutorCallable,
        call: ToolCall,
        *,
        context: ModelCallContext,
        model_run_id: UUID,
        tool_step: int,
    ) -> ToolResult:
        started = perf_counter()
        try:
            if hasattr(executor, "execute_tool"):
                execute = cast(ToolExecutor, executor).execute_tool
                raw = await asyncio.wait_for(
                    execute(call, context=context), timeout=self.settings.tool_timeout_seconds
                )
            elif hasattr(executor, "execute"):
                execute = cast(Any, executor).execute
                raw = await asyncio.wait_for(
                    _invoke_compatible_executor(execute, call, context),
                    timeout=self.settings.tool_timeout_seconds,
                )
            elif isinstance(executor, Mapping):
                operation = executor.get(call.name)
                if not callable(operation):
                    raise ToolCallRejected(f"tool {call.name} has no registered executor")
                raw = await asyncio.wait_for(
                    _invoke_compatible_executor(operation, call, context),
                    timeout=self.settings.tool_timeout_seconds,
                )
            else:
                raw = await asyncio.wait_for(
                    _invoke_compatible_executor(executor, call, context),
                    timeout=self.settings.tool_timeout_seconds,
                )
            result = _coerce_tool_result(raw, call)
            result = _bound_tool_result(result, call=call, context=context, settings=self.settings)
            self._record_tool_audit(
                call,
                context=context,
                model_run_id=model_run_id,
                result=result,
                latency_ms=max(0, int((perf_counter() - started) * 1000)),
                tool_step=tool_step,
                status="SUCCEEDED",
            )
            return result
        except ToolCallRejected:
            self._record_tool_audit(
                call,
                context=context,
                model_run_id=model_run_id,
                result=None,
                latency_ms=max(0, int((perf_counter() - started) * 1000)),
                tool_step=tool_step,
                status="REJECTED",
            )
            raise
        except Exception as exc:
            self._record_tool_audit(
                call,
                context=context,
                model_run_id=model_run_id,
                result=None,
                latency_ms=max(0, int((perf_counter() - started) * 1000)),
                tool_step=tool_step,
                status="FAILED",
            )
            raise ToolCallRejected(f"tool {call.name} failed: {type(exc).__name__}") from exc

    def _record_tool_audit(
        self,
        call: ToolCall,
        *,
        context: ModelCallContext,
        model_run_id: UUID,
        result: ToolResult | None,
        latency_ms: int,
        tool_step: int,
        status: str,
    ) -> None:
        if self.tool_audit_sink is None or context.workspace_id is None:
            return
        try:
            from cognigraph.graph.query_tools import ToolCallRecord

            self.tool_audit_sink.record(
                ToolCallRecord(
                    tool_name=call.name,
                    workspace_id=context.workspace_id,
                    parameters={
                        str(key): _sanitize_argument_value(str(key), value)
                        for key, value in call.arguments.items()
                    },
                    graph_revision_id=(
                        _optional_uuid(result.content.get("graph_revision_id"))
                        if result is not None
                        else context.graph_revision_id
                    ),
                    learner_id=context.learner_id,
                    session_id=context.session_id,
                    model_run_id=model_run_id,
                    result_count=(
                        _result_count_from_content(result.content) if result is not None else 0
                    ),
                    latency_ms=latency_ms,
                    result_bytes=(
                        len(
                            json.dumps(
                                result.content,
                                ensure_ascii=False,
                                separators=(",", ":"),
                                sort_keys=True,
                            ).encode()
                        )
                        if result is not None
                        else 0
                    ),
                    truncated=(
                        bool(result.content.get("truncated")) if result is not None else False
                    ),
                    tool_step=tool_step,
                    status=status,
                )
            )
        except Exception:
            # Auditing must not make a successful, bounded read fail.
            logger.debug("tool audit sink rejected a record", exc_info=True)

    @staticmethod
    def _validate_json(content: str, response_model: type[SchemaT]) -> SchemaT:
        normalized = content.strip()
        if normalized.startswith("```"):
            lines = normalized.splitlines()
            normalized = "\n".join(lines[1:-1]).strip()
        try:
            return response_model.model_validate_json(normalized)
        except (ValidationError, json.JSONDecodeError) as initial_error:
            start = normalized.find("{")
            end = normalized.rfind("}")
            if start < 0 or end <= start:
                _log_schema_validation_failure(response_model, initial_error)
                raise
            try:
                return response_model.model_validate(json.loads(normalized[start : end + 1]))
            except (ValidationError, json.JSONDecodeError) as final_error:
                _log_schema_validation_failure(response_model, final_error)
                raise


def _log_schema_validation_failure(
    response_model: type[BaseModel],
    error: ValidationError | json.JSONDecodeError,
) -> None:
    if isinstance(error, ValidationError):
        summaries: list[str] = []
        for item in error.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )[:12]:
            location = ".".join(str(part) for part in item.get("loc", ())) or "<root>"
            summaries.append(f"{location}:{item.get('type', 'validation_error')}")
        detail = "|".join(summaries) or "validation_error"
    else:
        detail = "invalid_json"
    logger.warning(
        "model output schema validation failed schema=%s errors=%s",
        response_model.__name__,
        detail,
    )


async def _provider_complete(
    provider: ModelProvider,
    *,
    model: str,
    messages: list[ChatMessage],
    response_schema: dict[str, Any],
    tools: list[ToolDefinition] | None,
    tool_choice: str | dict[str, object] | None,
) -> ProviderResponse:
    """Call providers while retaining compatibility with pre-tool adapters."""

    if tools is None:
        response = await provider.complete(
            model=model,
            messages=messages,
            response_schema=response_schema,
        )
    else:
        response = await provider.complete(
            model=model,
            messages=messages,
            response_schema=response_schema,
            tools=tools,
            tool_choice=tool_choice,
        )
    return _coerce_provider_response(response, model=model, provider=provider.provider_name)


def _coerce_provider_response(
    response: ProviderResponse | object,
    *,
    model: str,
    provider: str,
) -> ProviderResponse:
    if isinstance(response, ProviderResponse):
        return response
    if isinstance(response, Mapping):
        return ProviderResponse.model_validate(response)
    # A few lightweight test adapters return an OpenAI-like response object.
    choices = getattr(response, "choices", None)
    if choices:
        message = getattr(choices[0], "message", choices[0])
        return ProviderResponse(
            content=(
                str(message.content) if getattr(message, "content", None) is not None else None
            ),
            tool_calls=_parse_provider_tool_calls(getattr(message, "tool_calls", None)),
            finish_reason=(
                str(choices[0].finish_reason)
                if getattr(choices[0], "finish_reason", None) is not None
                else None
            ),
            provider=provider,
            model=model,
        )
    raise TypeError("provider returned an unsupported response object")


async def _invoke_compatible_executor(
    executor: Callable[
        ..., Awaitable[ToolResult | Mapping[str, object]] | ToolResult | Mapping[str, object]
    ],
    call: ToolCall,
    context: ModelCallContext,
) -> ToolResult | Mapping[str, object]:
    """Accept both the native ``(ToolCall, context)`` and simple test adapters."""

    try:
        parameters = list(inspect.signature(executor).parameters.values())
    except (TypeError, ValueError):
        parameters = []
    first_name = parameters[0].name.casefold() if parameters else ""
    if first_name in {"name", "tool", "tool_name"}:
        value = executor(call.name, call.arguments)
    else:
        value = executor(call, context)
    if inspect.isawaitable(value):
        return await value
    return value


def _provider_messages(messages: Sequence[ChatMessage]) -> list[dict[str, object]]:
    """Render our neutral messages into the OpenAI/LiteLLM tool format."""

    rendered: list[dict[str, object]] = []
    for message in messages:
        item = message.model_dump(mode="json", exclude_none=True)
        calls = item.get("tool_calls")
        if isinstance(calls, list):
            item["tool_calls"] = [
                {
                    "id": str(call.get("id", "")),
                    "type": "function",
                    "function": {
                        "name": str(call.get("name", "")),
                        "arguments": json.dumps(
                            call.get("arguments", {}),
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                    },
                }
                for call in calls
                if isinstance(call, dict)
            ]
        rendered.append(item)
    return rendered


def _parse_provider_tool_calls(raw_calls: object) -> list[ToolCall]:
    if raw_calls is None:
        return []
    if not isinstance(raw_calls, (list, tuple)):
        raise TypeError("provider tool_calls must be a list")
    parsed: list[ToolCall] = []
    for raw in raw_calls:
        if isinstance(raw, ToolCall):
            parsed.append(raw)
            continue
        if isinstance(raw, Mapping):
            function = raw.get("function")
            if isinstance(function, Mapping):
                name = function.get("name")
                arguments = function.get("arguments", {})
            else:
                name = raw.get("name")
                arguments = raw.get("arguments", {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError as exc:
                    raise ToolCallRejected("provider returned malformed tool arguments") from exc
            parsed.append(
                ToolCall(
                    id=str(raw.get("id") or uuid4()),
                    name=str(name or ""),
                    arguments=arguments if isinstance(arguments, dict) else {},
                )
            )
            continue
        function = getattr(raw, "function", None)
        name = (
            getattr(function, "name", None) if function is not None else getattr(raw, "name", None)
        )
        arguments = (
            getattr(function, "arguments", {})
            if function is not None
            else getattr(raw, "arguments", {})
        )
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError as exc:
                raise ToolCallRejected("provider returned malformed tool arguments") from exc
        parsed.append(
            ToolCall(
                id=str(getattr(raw, "id", None) or uuid4()),
                name=str(name or ""),
                arguments=arguments if isinstance(arguments, dict) else {},
            )
        )
    return parsed


def _provider_supports_tools(provider: ModelProvider) -> bool:
    explicit = getattr(provider, "supports_tool_calling", None)
    if explicit is False:
        return False
    try:
        signature = inspect.signature(provider.complete)
    except (TypeError, ValueError):
        return bool(explicit is not False)
    parameters = signature.parameters.values()
    return bool(
        explicit is not False
        and any(item.name == "tools" or item.kind is item.VAR_KEYWORD for item in parameters)
    )


def _validate_tool_choice(
    tool_choice: str | dict[str, object] | None,
    definitions: Sequence[ToolDefinition],
) -> None:
    if tool_choice is None:
        return
    names = {item.name for item in definitions}
    if isinstance(tool_choice, str):
        if tool_choice in {"auto", "none", "required"}:
            return
        if tool_choice not in names:
            raise ToolCallRejected(f"unknown tool choice: {tool_choice}")
        return
    name = _forced_tool_name(tool_choice)
    if not isinstance(name, str) or name not in names:
        raise ToolCallRejected("tool choice names an unregistered tool")


def _tool_choice_is_none(tool_choice: str | dict[str, object] | None) -> bool:
    return isinstance(tool_choice, str) and tool_choice == "none"


def _forced_tool_name(tool_choice: str | dict[str, object] | None) -> str | None:
    if isinstance(tool_choice, str):
        return tool_choice if tool_choice not in {"auto", "none", "required"} else None
    if not isinstance(tool_choice, dict):
        return None
    function = tool_choice.get("function")
    if isinstance(function, dict):
        function_name = function.get("name")
        if isinstance(function_name, str):
            return function_name
    name = tool_choice.get("name")
    return name if isinstance(name, str) else None


def _is_unsupported_tool_calling_error(exc: Exception) -> bool:
    message = str(exc).casefold()
    unsupported_markers = (
        "unsupported",
        "not support",
        "does not support",
        "unavailable",
        "unknown parameter",
        "unrecognized",
        "not allowed",
        "disabled",
        "invalid parameter",
    )
    tool_markers = ("tool", "function call", "function_call")
    return any(marker in message for marker in unsupported_markers) and any(
        marker in message for marker in tool_markers
    )


def _validate_tool_call(
    call: ToolCall,
    *,
    definitions: Sequence[ToolDefinition],
    context: ModelCallContext,
    settings: Settings,
) -> ToolCall:
    if context.workspace_id is None:
        raise ToolCallRejected("tool calls require a workspace context")
    definition = next((item for item in definitions if item.name == call.name), None)
    if definition is None:
        raise ToolCallRejected(f"unknown graph tool: {call.name}")
    arguments = dict(call.arguments)
    workspace_value = arguments.get("workspace_id")
    if context.workspace_id is not None:
        if (
            workspace_value is not None
            and _matches_context_uuid(workspace_value, context.workspace_id) is False
        ):
            raise ToolCallRejected("tool workspace does not match request workspace")
        arguments["workspace_id"] = str(context.workspace_id)
    learner_value = arguments.get("learner_id")
    if learner_value is not None and context.learner_id is None:
        raise ToolCallRejected("learner-scoped tools require a learner context")
    if context.learner_id is not None and learner_value is not None:
        if _matches_context_uuid(learner_value, context.learner_id) is False:
            raise ToolCallRejected("tool learner does not match request learner")
    session_value = arguments.get("session_id")
    if context.session_id is not None and session_value is not None:
        if _matches_context_uuid(session_value, context.session_id) is False:
            raise ToolCallRejected("tool session does not match request session")
    for key, maximum in (
        ("max_depth", settings.max_graph_depth),
        ("max_nodes", settings.max_graph_nodes),
        ("limit", settings.max_graph_nodes),
    ):
        value = arguments.get(key)
        if isinstance(value, bool):
            raise ToolCallRejected(f"tool parameter {key} must be an integer")
        if isinstance(value, (int, float)) and int(value) > maximum:
            raise ToolCallRejected(f"tool parameter {key} exceeds configured limit")
    _validate_json_schema_arguments(arguments, definition.parameters)
    return call.model_copy(update={"arguments": arguments})


def _validate_json_schema_arguments(
    arguments: dict[str, object], schema: dict[str, object]
) -> None:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return
    required = schema.get("required", [])
    if isinstance(required, list):
        missing = [str(key) for key in required if str(key) not in arguments]
        if missing:
            raise ToolCallRejected(f"missing tool parameters: {', '.join(sorted(missing))}")
    if schema.get("additionalProperties") is False:
        unknown = sorted(set(arguments) - {str(key) for key in properties})
        if unknown:
            raise ToolCallRejected(f"unknown tool parameters: {', '.join(unknown)}")
    for key, value in arguments.items():
        specification = properties.get(key)
        if not isinstance(specification, dict):
            continue
        expected = specification.get("type")
        if expected == "string" and not isinstance(value, str):
            raise ToolCallRejected(f"tool parameter {key} must be a string")
        if isinstance(value, str):
            minimum = specification.get("minLength")
            maximum = specification.get("maxLength")
            if isinstance(minimum, int) and len(value) < minimum:
                raise ToolCallRejected(f"tool parameter {key} is too short")
            if isinstance(maximum, int) and len(value) > maximum:
                raise ToolCallRejected(f"tool parameter {key} is too long")
        if expected == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
            raise ToolCallRejected(f"tool parameter {key} must be an integer")
        if expected == "number" and (not isinstance(value, int | float) or isinstance(value, bool)):
            raise ToolCallRejected(f"tool parameter {key} must be numeric")
        if expected in {"integer", "number"} and isinstance(value, int | float):
            minimum = specification.get("minimum")
            maximum = specification.get("maximum")
            if isinstance(minimum, int | float) and value < minimum:
                raise ToolCallRejected(f"tool parameter {key} is below its minimum")
            if isinstance(maximum, int | float) and value > maximum:
                raise ToolCallRejected(f"tool parameter {key} exceeds its maximum")
        enum = specification.get("enum")
        if isinstance(enum, list) and value not in enum:
            raise ToolCallRejected(f"tool parameter {key} has an invalid value")


def _coerce_tool_result(raw: ToolResult | Mapping[str, object], call: ToolCall) -> ToolResult:
    if isinstance(raw, ToolResult):
        return raw.model_copy(update={"tool_call_id": call.id, "name": call.name})
    if not isinstance(raw, Mapping):
        raise ToolCallRejected("tool executor returned a non-object result")
    raw_content = raw.get("content")
    if isinstance(raw_content, dict):
        content = {str(key): value for key, value in raw_content.items()}
    elif isinstance(raw.get("data"), dict):
        content = {
            key: raw[key]
            for key in (
                "workspace_id",
                "graph_revision_id",
                "revision_id",
                "tool_name",
                "result_count",
                "truncated",
            )
            if key in raw
        }
        content["data"] = raw["data"]
    else:
        content = dict(raw)
    return ToolResult(tool_call_id=call.id, name=call.name, content=content)


def _bound_tool_result(
    result: ToolResult,
    *,
    call: ToolCall,
    context: ModelCallContext,
    settings: Settings,
) -> ToolResult:
    content = dict(result.content)
    raw_workspace = content.get("workspace_id")
    if context.workspace_id is not None:
        if raw_workspace is None or _optional_uuid(raw_workspace) != context.workspace_id:
            raise ToolCallRejected("tool result belongs to a different workspace")
    revision = _optional_uuid(content.get("graph_revision_id") or content.get("revision_id"))
    if context.graph_revision_id is not None:
        if revision is None or revision != context.graph_revision_id:
            raise ToolCallRejected("tool result is stale for the requested graph revision")
    workspace_id = (
        str(context.workspace_id) if context.workspace_id is not None else str(raw_workspace or "")
    )
    result_count = _result_count_from_content(content)
    payload_data = content.get("data") if isinstance(content.get("data"), dict) else content
    payload: dict[str, object] = {
        "workspace_id": workspace_id,
        "graph_revision_id": (
            str(revision or context.graph_revision_id)
            if (revision is not None or context.graph_revision_id is not None)
            else None
        ),
        "tool_name": call.name,
        "result_count": result_count,
        "truncated": False,
        "data": payload_data,
    }
    payload, truncated = _truncate_payload(payload, settings.max_tool_result_bytes)
    payload["truncated"] = truncated
    if truncated:
        payload = _fit_truncated_payload(payload, settings.max_tool_result_bytes)
    return ToolResult(tool_call_id=call.id, name=call.name, content=payload)


def _truncate_payload(payload: dict[str, object], maximum: int) -> tuple[dict[str, object], bool]:
    if maximum <= 0:
        raise ToolCallRejected("tool result byte budget must be positive")
    encoded = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    if len(encoded) <= maximum:
        return payload, False
    data = payload.get("data")
    if isinstance(data, dict):
        reduced: dict[str, object] = {}
        for key in sorted(data):
            candidate = dict(payload)
            reduced[key] = data[key]
            candidate["data"] = reduced
            if (
                len(
                    json.dumps(
                        candidate, ensure_ascii=False, separators=(",", ":"), sort_keys=True
                    ).encode()
                )
                > maximum
            ):
                reduced.pop(key)
                break
        payload = dict(payload)
        payload["data"] = reduced
    encoded = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    if len(encoded) > maximum:
        # Keep metadata and a deterministic UTF-8-safe preview of the data.
        budget = max(0, maximum - 180)
        preview = json.dumps(payload.get("data"), ensure_ascii=False, sort_keys=True)
        payload["data"] = {"preview": preview[:budget]}
    return payload, True


def _fit_truncated_payload(payload: dict[str, object], maximum: int) -> dict[str, object]:
    """Fit the final ``truncated=true`` envelope deterministically."""

    encoded = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    if len(encoded) <= maximum:
        return payload
    data = payload.get("data")
    preview = ""
    if isinstance(data, dict) and isinstance(data.get("preview"), str):
        preview = data["preview"]
    low, high = 0, len(preview)
    best = ""
    while low <= high:
        middle = (low + high) // 2
        candidate = dict(payload)
        candidate["data"] = {"preview": preview[:middle]}
        size = len(
            json.dumps(
                candidate, ensure_ascii=False, separators=(",", ":"), sort_keys=True
            ).encode()
        )
        if size <= maximum:
            best = preview[:middle]
            low = middle + 1
        else:
            high = middle - 1
    payload = dict(payload)
    payload["data"] = {"preview": best}
    return payload


def _result_count_from_content(content: Mapping[str, object]) -> int:
    for key in ("result_count", "items", "nodes", "assertions", "sources", "knowledge_point_ids"):
        value = content.get(key)
        if isinstance(value, int) and key == "result_count":
            return max(0, value)
        if isinstance(value, list):
            return len(value)
    nested = content.get("data")
    if isinstance(nested, dict):
        return _result_count_from_content(nested)
    return int(bool(content))


def _json_safe(value: object) -> object:
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        return str(value)
    return value


_SENSITIVE_ARGUMENT_KEYS = frozenset(
    {
        "api_key",
        "apikey",
        "authorization",
        "cookie",
        "password",
        "secret",
        "token",
    }
)


def _sanitize_argument_value(key: str, value: object) -> object:
    """Keep tool audit records bounded and free of credential-like values."""

    if key.casefold() in _SENSITIVE_ARGUMENT_KEYS or any(
        marker in key.casefold() for marker in ("api_key", "password", "secret", "token")
    ):
        return "[REDACTED]"
    if isinstance(value, str):
        return value[:500]
    if isinstance(value, Mapping):
        return {
            str(child_key): _sanitize_argument_value(str(child_key), child_value)
            for child_key, child_value in list(value.items())[:50]
        }
    if isinstance(value, list | tuple):
        return [_sanitize_argument_value(key, child) for child in value[:50]]
    return _json_safe(value)


def _optional_uuid(value: object) -> UUID | None:
    if value in (None, ""):
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _matches_context_uuid(value: object, expected: UUID) -> bool:
    try:
        return _optional_uuid(value) == expected
    except (TypeError, ValueError):
        return False
