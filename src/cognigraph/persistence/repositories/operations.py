from __future__ import annotations

import hashlib
from collections.abc import Sequence
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.persistence.postgres.models import (
    AuditEvent,
    ModelConfig,
    ModelRun,
    PromptVersion,
    ToolCallAudit,
)


class ModelConfigRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_for_role(self, workspace_id: UUID, role: str) -> ModelConfig | None:
        result: ModelConfig | None = await self.session.scalar(
            select(ModelConfig).where(
                ModelConfig.workspace_id == workspace_id,
                ModelConfig.role == role,
                ModelConfig.is_active.is_(True),
            )
        )
        return result

    async def save(self, config: ModelConfig) -> ModelConfig:
        self.session.add(config)
        await self.session.flush()
        return config


class ModelRunRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def start(
        self,
        *,
        workspace_id: UUID,
        provider: str,
        model: str,
        role: str,
        prompt_version: str,
        prompt_hash: str | None = None,
        request_metadata: dict[str, Any] | None = None,
    ) -> ModelRun:
        run = ModelRun(
            workspace_id=workspace_id,
            provider=provider,
            model=model,
            role=role,
            prompt_version=prompt_version,
            prompt_hash=prompt_hash,
            status="RUNNING",
            request_metadata=request_metadata or {},
        )
        self.session.add(run)
        await self.session.flush()
        return run

    async def finish(
        self,
        run_id: UUID,
        *,
        status: str,
        input_tokens: int,
        output_tokens: int,
        estimated_cost: Decimal,
        latency_ms: int,
        error_type: str | None = None,
    ) -> ModelRun:
        run = await self.session.get(ModelRun, run_id)
        if run is None:
            raise LookupError(f"model run {run_id} does not exist")
        run.status = status
        run.input_tokens = input_tokens
        run.output_tokens = output_tokens
        run.estimated_cost = estimated_cost
        run.latency_ms = latency_ms
        run.error_type = error_type
        await self.session.flush()
        return run


class PromptRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def register(
        self,
        *,
        prompt_name: str,
        version: str,
        content: str,
        workspace_id: UUID | None = None,
        activate: bool = False,
    ) -> PromptVersion:
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        existing = await self.session.scalar(
            select(PromptVersion).where(
                PromptVersion.workspace_id == workspace_id,
                PromptVersion.prompt_name == prompt_name,
                PromptVersion.version == version,
            )
        )
        if existing is not None:
            if existing.content_hash != content_hash:
                raise ValueError("prompt version is immutable and already has different content")
            if activate and not existing.active:
                await self.activate(existing.id)
            return existing
        prompt = PromptVersion(
            workspace_id=workspace_id,
            prompt_name=prompt_name,
            version=version,
            content=content,
            content_hash=content_hash,
            active=False,
        )
        self.session.add(prompt)
        await self.session.flush()
        if activate:
            await self.activate(prompt.id)
        return prompt

    async def activate(self, prompt_id: UUID) -> PromptVersion:
        prompt = await self.session.get(PromptVersion, prompt_id)
        if prompt is None:
            raise LookupError(f"prompt {prompt_id} does not exist")
        await self.session.execute(
            update(PromptVersion)
            .where(
                PromptVersion.workspace_id == prompt.workspace_id,
                PromptVersion.prompt_name == prompt.prompt_name,
                PromptVersion.id != prompt.id,
            )
            .values(active=False)
        )
        prompt.active = True
        await self.session.flush()
        return prompt

    async def get_active(
        self, prompt_name: str, *, workspace_id: UUID | None = None
    ) -> PromptVersion | None:
        workspace_prompt = await self.session.scalar(
            select(PromptVersion).where(
                PromptVersion.workspace_id == workspace_id,
                PromptVersion.prompt_name == prompt_name,
                PromptVersion.active.is_(True),
            )
        )
        if workspace_prompt is not None or workspace_id is None:
            return workspace_prompt
        result: PromptVersion | None = await self.session.scalar(
            select(PromptVersion).where(
                PromptVersion.workspace_id.is_(None),
                PromptVersion.prompt_name == prompt_name,
                PromptVersion.active.is_(True),
            )
        )
        return result


class AuditRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(self, event: AuditEvent) -> AuditEvent:
        self.session.add(event)
        await self.session.flush()
        return event

    async def record_tool_call(self, call: ToolCallAudit) -> ToolCallAudit:
        self.session.add(call)
        await self.session.flush()
        return call

    async def record_tool_calls(self, calls: Sequence[ToolCallAudit]) -> list[ToolCallAudit]:
        if not calls:
            return []
        existing_ids = set(
            (
                await self.session.scalars(
                    select(ToolCallAudit.id).where(
                        ToolCallAudit.id.in_([call.id for call in calls])
                    )
                )
            ).all()
        )
        pending = [call for call in calls if call.id not in existing_ids]
        self.session.add_all(pending)
        await self.session.flush()
        return pending

    async def list_tool_calls(self, workspace_id: UUID, *, limit: int = 100) -> list[ToolCallAudit]:
        if not 1 <= limit <= 1_000:
            raise ValueError("limit must be between 1 and 1000")
        return list(
            (
                await self.session.scalars(
                    select(ToolCallAudit)
                    .where(ToolCallAudit.workspace_id == workspace_id)
                    .order_by(ToolCallAudit.created_at, ToolCallAudit.id)
                    .limit(limit)
                )
            ).all()
        )
