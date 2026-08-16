from __future__ import annotations

import mimetypes
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.api.schemas import DocumentListResponse, DocumentResponse, IngestionResponse
from cognigraph.persistence.postgres.models import Document as DocumentRecord

router = APIRouter(tags=["documents"])


@router.get("/workspaces/{workspace_id}/documents", response_model=DocumentListResponse)
async def list_documents(
    workspace_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
) -> DocumentListResponse:
    enforce_workspace_scope(workspace_scope, workspace_id)
    async with runtime.database.unit_of_work() as unit:
        if await unit.workspaces.get(workspace_id) is None:
            raise HTTPException(status_code=404, detail="workspace not found")
        records = await unit.documents.list_for_workspace(
            workspace_id,
            user_visible_only=True,
            limit=limit + 1,
            offset=offset,
        )
    has_more = len(records) > limit
    items = [_document_record_response(item) for item in records[:limit]]
    return DocumentListResponse(
        workspace_id=workspace_id,
        items=items,
        limit=limit,
        offset=offset,
        next_offset=offset + len(items) if has_more else None,
    )


@router.post(
    "/workspaces/{workspace_id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    workspace_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
    file: UploadFile = File(...),
) -> DocumentResponse:
    enforce_workspace_scope(workspace_scope, workspace_id)
    async with runtime.database.unit_of_work() as unit:
        if await unit.workspaces.get(workspace_id) is None:
            raise HTTPException(status_code=404, detail="workspace not found")
    filename = file.filename or "upload.bin"
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    content = await file.read(runtime.settings.max_upload_bytes + 1)
    try:
        upload = await runtime.ingestion.upload(
            workspace_id=workspace_id,
            filename=filename,
            mime_type=mime_type,
            content=content,
        )
        document = await runtime.ingestion.get_document(upload.document_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _document_response(document)


@router.post("/documents/{document_id}/ingest", response_model=IngestionResponse)
async def ingest_document(
    document_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> IngestionResponse:
    record = await _get_user_visible_document(runtime, document_id)
    enforce_workspace_scope(workspace_scope, record.workspace_id)
    try:
        report = await runtime.ingestion.ingest(document_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return IngestionResponse.model_validate(report, from_attributes=True)


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> DocumentResponse:
    record = await _get_user_visible_document(runtime, document_id)
    enforce_workspace_scope(workspace_scope, record.workspace_id)
    return _document_record_response(record)


@router.get("/documents/{document_id}/chunks")
async def get_document_chunks(
    document_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    document = await _get_user_visible_document(runtime, document_id)
    enforce_workspace_scope(workspace_scope, document.workspace_id)
    chunks = runtime.document_registry.chunks.get(document_id)
    if chunks is not None:
        return {
            "document_id": str(document_id),
            "items": [item.model_dump(mode="json") for item in chunks],
        }
    async with runtime.database.unit_of_work() as unit:
        records = await unit.documents.list_chunks(document_id)
    return {
        "document_id": str(document_id),
        "items": [
            {
                "id": str(item.id),
                "sequence": item.ordinal,
                "text": item.text,
                "page_start": item.page_start,
                "page_end": item.page_end,
                "heading_path": item.heading_path,
                "token_count": item.token_count,
            }
            for item in records
        ],
    }


@router.get("/documents/{document_id}/extracted-knowledge")
async def get_extracted_knowledge(
    document_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    record = await _get_user_visible_document(runtime, document_id)
    enforce_workspace_scope(workspace_scope, record.workspace_id)
    blueprint = runtime.document_registry.blueprints.get(document_id)
    if blueprint is not None:
        return {
            "document_id": str(document_id),
            "blueprint": blueprint.model_dump(mode="json"),
        }
    parser_output = record.parser_output or {}
    return {
        "document_id": str(document_id),
        "blueprint": parser_output.get("blueprint"),
    }


def _document_response(document: object) -> DocumentResponse:
    from cognigraph.domain.documents import Document

    if not isinstance(document, Document):
        raise TypeError("expected a domain Document")
    return DocumentResponse(
        id=document.id,
        workspace_id=document.workspace_id,
        filename=document.original_filename,
        mime_type=document.mime_type,
        byte_size=document.byte_size,
        sha256=document.content_hash,
        status=document.status.value,
        page_count=document.page_count,
        warnings=document.warnings,
        created_at=document.created_at,
    )


def _document_record_response(document: DocumentRecord) -> DocumentResponse:
    parser_output = document.parser_output or {}
    raw_warnings = parser_output.get("warnings", [])
    warnings = [str(item) for item in raw_warnings] if isinstance(raw_warnings, list) else []
    if document.error_code and document.error_code not in warnings:
        warnings.append(document.error_code)
    return DocumentResponse(
        id=document.id,
        workspace_id=document.workspace_id,
        filename=document.filename,
        mime_type=document.mime_type,
        byte_size=document.byte_size,
        sha256=document.sha256,
        status=document.status,
        page_count=document.page_count,
        warnings=warnings,
        created_at=document.created_at,
    )


async def _get_user_visible_document(
    runtime: RuntimeDependency,
    document_id: UUID,
) -> DocumentRecord:
    async with runtime.database.unit_of_work() as unit:
        document = await unit.documents.get(document_id, user_visible_only=True)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")
    return document
