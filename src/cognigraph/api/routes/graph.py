from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.domain.enums import DocumentOrigin
from cognigraph.graph.query_tools import (
    AssertionDetailParams,
    FocusSubgraphParams,
    NodeDetailParams,
    WorkspaceParams,
)
from cognigraph.persistence.postgres.models import Document as DocumentRecord
from cognigraph.persistence.postgres.models import SourceSpan as SourceSpanRecord

router = APIRouter(tags=["graph"])


@router.get("/graph/manifest")
async def get_manifest(
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID = Query(...),
) -> dict[str, object]:
    enforce_workspace_scope(workspace_scope, workspace_id)
    await runtime.ensure_semantic_projection(workspace_id)
    result = await runtime.semantic_queries.get_graph_manifest(
        WorkspaceParams(workspace_id=workspace_id)
    )
    return await _user_visible_graph_result(runtime, workspace_id, result.model_dump(mode="json"))


@router.get("/graph/subgraph")
async def get_subgraph(
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID = Query(...),
    node_id: UUID = Query(...),
    max_depth: int = Query(default=2, ge=1, le=3),
    max_nodes: int = Query(default=50, ge=1, le=100),
) -> dict[str, object]:
    enforce_workspace_scope(workspace_scope, workspace_id)
    await runtime.ensure_semantic_projection(workspace_id)
    try:
        result = await runtime.semantic_queries.get_focus_subgraph(
            FocusSubgraphParams(
                workspace_id=workspace_id,
                node_id=node_id,
                max_depth=max_depth,
                max_nodes=max_nodes,
            )
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="node not found") from exc
    return await _user_visible_graph_result(runtime, workspace_id, result.model_dump(mode="json"))


@router.get("/graph/nodes/{node_id}")
async def get_node_detail(
    node_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID = Query(...),
) -> dict[str, object]:
    enforce_workspace_scope(workspace_scope, workspace_id)
    await runtime.ensure_semantic_projection(workspace_id)
    try:
        result = await runtime.semantic_queries.get_node_detail(
            NodeDetailParams(workspace_id=workspace_id, node_id=node_id)
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="node not found") from exc
    return await _user_visible_graph_result(runtime, workspace_id, result.model_dump(mode="json"))


@router.get("/graph/assertions/{assertion_id}")
async def get_assertion_detail(
    assertion_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID = Query(...),
) -> dict[str, object]:
    enforce_workspace_scope(workspace_scope, workspace_id)
    await runtime.ensure_semantic_projection(workspace_id)
    try:
        result = await runtime.semantic_queries.get_relation_assertion_detail(
            AssertionDetailParams(
                workspace_id=workspace_id,
                assertion_id=assertion_id,
            )
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="assertion not found") from exc
    return await _user_visible_graph_result(runtime, workspace_id, result.model_dump(mode="json"))


@router.get("/graph/revisions")
async def list_revisions(
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID = Query(...),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, object]:
    enforce_workspace_scope(workspace_scope, workspace_id)
    async with runtime.database.unit_of_work() as unit:
        revisions = await unit.graph.list_revisions(workspace_id, limit=limit)
    return {
        "workspace_id": str(workspace_id),
        "items": [_revision_data(item) for item in revisions],
    }


@router.get("/graph/revisions/{revision_id}")
async def get_revision(
    revision_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID | None = Query(default=None),
) -> dict[str, object]:
    async with runtime.database.unit_of_work() as unit:
        revision = await unit.graph.get_revision(revision_id)
    if revision is None or (workspace_id is not None and revision.workspace_id != workspace_id):
        raise HTTPException(status_code=404, detail="graph revision not found")
    enforce_workspace_scope(workspace_scope, revision.workspace_id)
    return _revision_data(revision)


@router.get("/graph/export")
async def export_graph(
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    workspace_id: UUID = Query(...),
    format_: Literal["cytoscape", "jsonld", "turtle"] = Query(
        default="cytoscape",
        alias="format",
    ),
) -> Response:
    enforce_workspace_scope(workspace_scope, workspace_id)
    snapshot = await runtime.ensure_graph_loaded(workspace_id)
    exported = runtime.graph_exporter.export(snapshot, format_)
    if isinstance(exported, str):
        return Response(content=exported, media_type="text/turtle; charset=utf-8")
    return JSONResponse(content=exported)


def _revision_data(revision: object) -> dict[str, object]:
    from cognigraph.persistence.postgres.models import GraphRevision

    if not isinstance(revision, GraphRevision):
        raise TypeError("expected GraphRevision")
    return {
        "id": str(revision.id),
        "workspace_id": str(revision.workspace_id),
        "sequence_number": revision.sequence_number,
        "parent_revision_id": (
            str(revision.parent_revision_id) if revision.parent_revision_id else None
        ),
        "status": revision.status,
        "projection_status": revision.projection_status,
        "manifest": revision.manifest,
        "summary": revision.summary,
        "created_by": revision.created_by,
        "model_run_id": str(revision.model_run_id) if revision.model_run_id else None,
        "created_at": revision.created_at.isoformat(),
        "projected_at": revision.projected_at.isoformat() if revision.projected_at else None,
    }


async def _user_visible_graph_result(
    runtime: RuntimeDependency,
    workspace_id: UUID,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Redact legacy internal-chat graph evidence from semantic read results."""

    async with runtime.database.session() as session:
        document_ids = set(
            (
                await session.scalars(
                    select(DocumentRecord.id).where(
                        DocumentRecord.workspace_id == workspace_id,
                        DocumentRecord.origin == DocumentOrigin.INTERNAL_CHAT.value,
                    )
                )
            ).all()
        )
        span_ids = set(
            (
                await session.scalars(
                    select(SourceSpanRecord.id)
                    .join(DocumentRecord, DocumentRecord.id == SourceSpanRecord.document_id)
                    .where(
                        SourceSpanRecord.workspace_id == workspace_id,
                        DocumentRecord.origin == DocumentOrigin.INTERNAL_CHAT.value,
                    )
                )
            ).all()
        )
    blocked_ids = {str(item) for item in document_ids | span_ids}
    blocked_document_ids = {str(item) for item in document_ids}
    redacted = _redact_graph_value(payload, blocked_ids, blocked_document_ids)
    return redacted if isinstance(redacted, dict) else payload


def _redact_graph_value(
    value: Any,
    blocked_ids: set[str],
    blocked_document_ids: set[str],
) -> Any:
    if isinstance(value, list):
        return [
            _redact_graph_value(item, blocked_ids, blocked_document_ids)
            for item in value
            if not _is_blocked_graph_record(item, blocked_ids, blocked_document_ids)
        ]
    if isinstance(value, Mapping):
        if _is_blocked_graph_record(value, blocked_ids, blocked_document_ids):
            return None
        result: dict[str, Any] = {}
        for key, item in value.items():
            if key == "source_span_ids" and isinstance(item, list):
                result[str(key)] = [
                    source_id for source_id in item if str(source_id) not in blocked_ids
                ]
            else:
                result[str(key)] = _redact_graph_value(
                    item,
                    blocked_ids,
                    blocked_document_ids,
                )
        return result
    return value


def _is_blocked_graph_record(
    value: object,
    blocked_ids: set[str],
    blocked_document_ids: set[str],
) -> bool:
    if not isinstance(value, Mapping):
        return False
    return (
        str(value.get("id", "")) in blocked_ids
        or str(value.get("document_id", "")) in blocked_document_ids
    )
