from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.persistence.postgres.models import Workspace


class WorkspaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, workspace: Workspace) -> Workspace:
        self.session.add(workspace)
        await self.session.flush()
        return workspace

    async def create(
        self,
        *,
        name: str,
        slug: str,
        workspace_id: UUID | None = None,
        default_language: str = "zh-CN",
    ) -> Workspace:
        values: dict[str, object] = {
            "name": name,
            "slug": slug,
            "default_language": default_language,
        }
        if workspace_id is not None:
            values["id"] = workspace_id
        return await self.add(Workspace(**values))

    async def get(self, workspace_id: UUID) -> Workspace | None:
        result: Workspace | None = await self.session.get(Workspace, workspace_id)
        return result

    async def get_by_slug(self, slug: str) -> Workspace | None:
        result: Workspace | None = await self.session.scalar(
            select(Workspace).where(Workspace.slug == slug)
        )
        return result

    async def list(
        self,
        *,
        active_only: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Workspace]:
        if not 1 <= limit <= 101:
            raise ValueError("limit must be between 1 and 101")
        if offset < 0:
            raise ValueError("offset cannot be negative")
        statement = select(Workspace).order_by(Workspace.created_at.desc(), Workspace.id)
        if active_only:
            statement = statement.where(Workspace.is_active.is_(True))
        statement = statement.offset(offset).limit(limit)
        return list((await self.session.scalars(statement)).all())
