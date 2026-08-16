from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.persistence.postgres.models import (
    Learner,
    LearnerKnowledgeState,
    MasteryEvidence,
)


class LearnerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, learner: Learner) -> Learner:
        self.session.add(learner)
        await self.session.flush()
        return learner

    async def create(
        self,
        *,
        workspace_id: UUID,
        display_name: str,
        learner_id: UUID | None = None,
        external_id: str | None = None,
        language: str = "zh-CN",
        preferences: dict[str, Any] | None = None,
    ) -> Learner:
        values: dict[str, Any] = {
            "workspace_id": workspace_id,
            "display_name": display_name,
            "external_id": external_id,
            "language": language,
            "preferences": preferences or {},
        }
        if learner_id is not None:
            values["id"] = learner_id
        return await self.add(Learner(**values))

    async def get(self, learner_id: UUID, *, workspace_id: UUID | None = None) -> Learner | None:
        statement = select(Learner).where(Learner.id == learner_id)
        if workspace_id is not None:
            statement = statement.where(Learner.workspace_id == workspace_id)
        result: Learner | None = await self.session.scalar(statement)
        return result

    async def list_for_workspace(
        self,
        workspace_id: UUID,
        *,
        active_only: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Learner]:
        if not 1 <= limit <= 101:
            raise ValueError("limit must be between 1 and 101")
        if offset < 0:
            raise ValueError("offset cannot be negative")
        statement = select(Learner).where(Learner.workspace_id == workspace_id)
        if active_only:
            statement = statement.where(Learner.is_active.is_(True))
        result = await self.session.scalars(
            statement.order_by(Learner.created_at.desc(), Learner.id).offset(offset).limit(limit)
        )
        return list(result.all())


class LearnerStateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(
        self,
        learner_id: UUID,
        knowledge_point_id: UUID,
        *,
        workspace_id: UUID | None = None,
        for_update: bool = False,
    ) -> LearnerKnowledgeState | None:
        statement = select(LearnerKnowledgeState).where(
            LearnerKnowledgeState.learner_id == learner_id,
            LearnerKnowledgeState.knowledge_point_id == knowledge_point_id,
        )
        if workspace_id is not None:
            statement = statement.where(LearnerKnowledgeState.workspace_id == workspace_id)
        if for_update:
            statement = statement.with_for_update()
        result: LearnerKnowledgeState | None = await self.session.scalar(statement)
        return result

    async def get_or_create(
        self, *, workspace_id: UUID, learner_id: UUID, knowledge_point_id: UUID
    ) -> LearnerKnowledgeState:
        owner_id = await self.session.scalar(
            select(Learner.id).where(
                Learner.id == learner_id,
                Learner.workspace_id == workspace_id,
            )
        )
        if owner_id is None:
            raise ValueError("learner does not belong to workspace")
        state = await self.get(
            learner_id,
            knowledge_point_id,
            workspace_id=workspace_id,
            for_update=True,
        )
        if state is not None:
            return state
        state = LearnerKnowledgeState(
            workspace_id=workspace_id,
            learner_id=learner_id,
            knowledge_point_id=knowledge_point_id,
        )
        self.session.add(state)
        await self.session.flush()
        return state

    async def save(self, state: LearnerKnowledgeState) -> LearnerKnowledgeState:
        self.session.add(state)
        await self.session.flush()
        return state

    async def add_evidence(self, evidence: MasteryEvidence) -> MasteryEvidence:
        self.session.add(evidence)
        await self.session.flush()
        return evidence

    async def list_states(self, learner_id: UUID) -> list[LearnerKnowledgeState]:
        return await self.list_states_for_workspace(learner_id)

    async def list_states_for_workspace(
        self, learner_id: UUID, *, workspace_id: UUID | None = None
    ) -> list[LearnerKnowledgeState]:
        statement = select(LearnerKnowledgeState).where(
            LearnerKnowledgeState.learner_id == learner_id
        )
        if workspace_id is not None:
            statement = statement.where(LearnerKnowledgeState.workspace_id == workspace_id)
        result = await self.session.scalars(
            statement.order_by(LearnerKnowledgeState.updated_at.desc())
        )
        return list(result.all())

    async def list_evidence(
        self,
        learner_id: UUID,
        *,
        knowledge_point_id: UUID | None = None,
        since: datetime | None = None,
        limit: int = 100,
        workspace_id: UUID | None = None,
    ) -> list[MasteryEvidence]:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        statement = select(MasteryEvidence).where(MasteryEvidence.learner_id == learner_id)
        if workspace_id is not None:
            statement = statement.where(MasteryEvidence.workspace_id == workspace_id)
        if knowledge_point_id is not None:
            statement = statement.where(MasteryEvidence.knowledge_point_id == knowledge_point_id)
        if since is not None:
            statement = statement.where(MasteryEvidence.created_at >= since)
        statement = statement.order_by(MasteryEvidence.created_at.desc()).limit(limit)
        return list((await self.session.scalars(statement)).all())
