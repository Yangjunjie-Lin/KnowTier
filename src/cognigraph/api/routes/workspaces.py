from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from cognigraph.api.dependencies import RuntimeDependency
from cognigraph.api.schemas import WorkspaceCreateRequest, WorkspaceResponse

router = APIRouter(tags=["workspaces"])


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
