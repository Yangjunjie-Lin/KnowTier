from __future__ import annotations

import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.api.schemas import (
    WorkspaceCreateRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
)

router = APIRouter(tags=["workspaces"])


@router.get("/workspaces", response_model=WorkspaceListResponse)
async def list_workspaces(
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
) -> WorkspaceListResponse:
    """List recoverable workspaces without opening a tenant enumeration path."""

    local_discovery_enabled = not runtime.settings.workspace_scope_required and (
        runtime.settings.desktop_mode
        or runtime.settings.environment.casefold()
        in {"dev", "development", "local", "test", "testing"}
    )
    if workspace_scope is None and not local_discovery_enabled:
        raise HTTPException(status_code=403, detail="workspace discovery is unavailable")

    async with runtime.database.unit_of_work() as unit:
        if workspace_scope is not None:
            workspace = await unit.workspaces.get(workspace_scope) if offset == 0 else None
            records = [workspace] if workspace is not None and workspace.is_active else []
            has_more = False
        else:
            records = await unit.workspaces.list(
                active_only=True,
                limit=limit + 1,
                offset=offset,
            )
            has_more = len(records) > limit
            records = records[:limit]
    items = [WorkspaceResponse.model_validate(item, from_attributes=True) for item in records]
    return WorkspaceListResponse(
        items=items,
        limit=limit,
        offset=offset,
        next_offset=offset + len(items) if has_more else None,
    )


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> WorkspaceResponse:
    enforce_workspace_scope(workspace_scope, workspace_id)
    async with runtime.database.unit_of_work() as unit:
        workspace = await unit.workspaces.get(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    return WorkspaceResponse.model_validate(workspace, from_attributes=True)


@router.post(
    "/workspaces",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace(
    request: WorkspaceCreateRequest,
    http_request: Request,
    runtime: RuntimeDependency,
) -> WorkspaceResponse:
    if runtime.settings.environment.casefold() in {"prod", "production"}:
        configured = runtime.settings.workspace_provisioning_token
        supplied = http_request.headers.get("x-workspace-provisioning-token")
        if (
            configured is None
            or supplied is None
            or not secrets.compare_digest(supplied, configured.get_secret_value())
        ):
            raise HTTPException(
                status_code=401,
                detail="workspace provisioning credentials are required",
            )
    try:
        async with runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(
                name=request.name,
                slug=request.slug,
                default_language=request.default_language,
            )
            await unit.commit()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="workspace slug already exists") from exc
    return WorkspaceResponse.model_validate(workspace, from_attributes=True)
