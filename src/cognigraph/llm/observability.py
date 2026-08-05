from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from cognigraph.domain.base import utc_now
from cognigraph.llm.schemas import ModelCallContext, ModelRole, ModelUsage


@dataclass(frozen=True, slots=True)
class ModelRunRecord:
    id: UUID
    context: ModelCallContext
    provider: str
    model: str
    role: ModelRole
    usage: ModelUsage
    latency_ms: int
    status: str
    error_type: str | None
    tool_step_count: int
    tool_calling_fallback: bool
    created_at: datetime


class ModelRunSink(Protocol):
    async def record_model_run(self, record: ModelRunRecord) -> None: ...


class InMemoryModelRunSink:
    def __init__(self) -> None:
        self.records: list[ModelRunRecord] = []

    async def record_model_run(self, record: ModelRunRecord) -> None:
        self.records.append(record)


def model_run_record(
    *,
    run_id: UUID,
    context: ModelCallContext,
    provider: str,
    model: str,
    role: ModelRole,
    usage: ModelUsage,
    latency_ms: int,
    status: str,
    error_type: str | None = None,
    tool_step_count: int = 0,
    tool_calling_fallback: bool = False,
) -> ModelRunRecord:
    return ModelRunRecord(
        id=run_id,
        context=context,
        provider=provider,
        model=model,
        role=role,
        usage=usage,
        latency_ms=latency_ms,
        status=status,
        error_type=error_type,
        tool_step_count=tool_step_count,
        tool_calling_fallback=tool_calling_fallback,
        created_at=utc_now(),
    )
