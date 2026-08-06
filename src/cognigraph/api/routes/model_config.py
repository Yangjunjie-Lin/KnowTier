from __future__ import annotations

import hmac
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel

from cognigraph.api.dependencies import RuntimeDependency
from cognigraph.llm.configuration import (
    ModelConfigurationSnapshot,
    ModelDiscoveryResult,
    ModelProfileDraft,
    ModelProfileView,
)
from cognigraph.llm.openai_compatible import OpenAICompatibleError

router = APIRouter(prefix="/model-config", tags=["model configuration"])


def enforce_model_configuration_access(
    runtime: RuntimeDependency,
    configuration_token: Annotated[str | None, Header(alias="X-Model-Configuration-Token")] = None,
) -> None:
    if runtime.settings.desktop_mode:
        return
    expected = runtime.settings.model_configuration_token
    if expected is not None:
        if configuration_token is None or not hmac.compare_digest(
            configuration_token,
            expected.get_secret_value(),
        ):
            raise HTTPException(status_code=401, detail="model configuration access denied")
        return
    if runtime.settings.environment.casefold() in {"prod", "production"}:
        raise HTTPException(
            status_code=503,
            detail="model configuration is disabled until an admin token is configured",
        )


ConfigurationAccess = Annotated[None, Depends(enforce_model_configuration_access)]


class ActiveModelView(BaseModel):
    role: str
    provider: str
    model: str
    profile_id: UUID | None
    profile_name: str


@router.get("/active", response_model=ActiveModelView)
async def get_active_model(
    runtime: RuntimeDependency,
    role: Literal["teacher", "extractor", "grader", "graph", "vision", "embedding"],
) -> ActiveModelView:
    return ActiveModelView(role=role, **runtime.active_model(role))


@router.get("", response_model=ModelConfigurationSnapshot)
async def get_model_configuration(
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelConfigurationSnapshot:
    return await runtime.model_configuration.snapshot()


@router.post(
    "/profiles",
    response_model=ModelProfileView,
    status_code=status.HTTP_201_CREATED,
)
async def create_model_profile(
    payload: ModelProfileDraft,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelProfileView:
    try:
        return await runtime.model_configuration.create(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/profiles/{profile_id}", response_model=ModelProfileView)
async def update_model_profile(
    profile_id: UUID,
    payload: ModelProfileDraft,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelProfileView:
    try:
        return await runtime.model_configuration.update(profile_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/profiles/{profile_id}/activate", response_model=ModelProfileView)
async def activate_model_profile(
    profile_id: UUID,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelProfileView:
    try:
        return await runtime.model_configuration.activate(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/profiles/{profile_id}/models", response_model=ModelDiscoveryResult)
async def discover_provider_models(
    profile_id: UUID,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelDiscoveryResult:
    try:
        return await runtime.model_configuration.discover_models(profile_id)
    except OpenAICompatibleError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/profiles/{profile_id}/test", response_model=ModelDiscoveryResult)
async def test_provider_connection(
    profile_id: UUID,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelDiscoveryResult:
    try:
        return await runtime.model_configuration.test_connection(profile_id)
    except OpenAICompatibleError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/profiles/{profile_id}/credential", response_model=ModelProfileView)
async def delete_provider_credential(
    profile_id: UUID,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> ModelProfileView:
    return await runtime.model_configuration.delete_credential(profile_id)


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model_profile(
    profile_id: UUID,
    runtime: RuntimeDependency,
    _access: ConfigurationAccess,
) -> Response:
    try:
        await runtime.model_configuration.delete_profile(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
