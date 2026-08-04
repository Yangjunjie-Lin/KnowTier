from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from cognigraph.services.runtime import ApplicationRuntime


def get_runtime(request: Request) -> ApplicationRuntime:
    runtime = getattr(request.app.state, "runtime", None)
    if not isinstance(runtime, ApplicationRuntime):
        raise RuntimeError("application runtime is not initialized")
    return runtime


RuntimeDependency = Annotated[ApplicationRuntime, Depends(get_runtime)]
