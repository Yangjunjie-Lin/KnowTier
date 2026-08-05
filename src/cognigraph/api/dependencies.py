from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request

from cognigraph.services.runtime import ApplicationRuntime


def get_runtime(request: Request) -> ApplicationRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, ApplicationRuntime):
        raise RuntimeError("application runtime is not initialized")
    return runtime


RuntimeDependency = Annotated[ApplicationRuntime, Depends(get_runtime)]


def get_workspace_scope(
    request: Request,
    runtime: RuntimeDependency,
) -> UUID | None:
    """Resolve the tenant scope injected by an authentication boundary.

    Development remains backward compatible when the header is absent. In a
    production environment the header is mandatory; an upstream gateway must
    authenticate the caller, strip any client-supplied value, and inject the
    authorized workspace UUID.
    """

    raw_value = request.headers.get("x-workspace-id")
    required = runtime.settings.workspace_scope_required or (
        runtime.settings.environment.casefold() in {"prod", "production"}
    )
    if raw_value is None:
        if required:
            raise HTTPException(status_code=401, detail="x-workspace-id tenant scope is required")
        return None
    try:
        return UUID(raw_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="x-workspace-id must be a UUID") from exc


WorkspaceScopeDependency = Annotated[UUID | None, Depends(get_workspace_scope)]


def enforce_workspace_scope(scope: UUID | None, workspace_id: UUID) -> None:
    if scope is not None and scope != workspace_id:
        raise HTTPException(status_code=403, detail="workspace access denied")
