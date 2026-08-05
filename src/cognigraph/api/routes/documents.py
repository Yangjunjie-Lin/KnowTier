from __future__ import annotations

import mimetypes
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from cognigraph.api.dependencies import (
    RuntimeDependency,
    WorkspaceScopeDependency,
    enforce_workspace_scope,
)
from cognigraph.api.schemas import DocumentResponse, IngestionResponse

router = APIRouter(tags=["documents"])


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
    try:
        document = await runtime.ingestion.get_document(document_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    enforce_workspace_scope(workspace_scope, document.workspace_id)
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
    try:
        document = await runtime.ingestion.get_document(document_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    enforce_workspace_scope(workspace_scope, document.workspace_id)
    return _document_response(document)


@router.get("/documents/{document_id}/chunks")
async def get_document_chunks(
    document_id: UUID,
    runtime: RuntimeDependency,
    workspace_scope: WorkspaceScopeDependency,
) -> dict[str, object]:
    chunks = runtime.document_registry.chunks.get(document_id)
    if chunks is not None:
        async with runtime.database.unit_of_work() as unit:
            document = await unit.documents.get(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="document not found")
        enforce_workspace_scope(workspace_scope, document.workspace_id)
        return {
            "document_id": str(document_id),
            "items": [item.model_dump(mode="json") for item in chunks],
        }
    async with runtime.database.unit_of_work() as unit:
        document = await unit.documents.get(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="document not found")
        enforce_workspace_scope(workspace_scope, document.workspace_id)
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
    blueprint = runtime.document_registry.blueprints.get(document_id)
    if blueprint is not None:
        async with runtime.database.unit_of_work() as unit:
            document = await unit.documents.get(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="document not found")
        enforce_workspace_scope(workspace_scope, document.workspace_id)
        return {
            "document_id": str(document_id),
            "blueprint": blueprint.model_dump(mode="json"),
        }
    async with runtime.database.unit_of_work() as unit:
        record = await unit.documents.get(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="document not found")
    enforce_workspace_scope(workspace_scope, record.workspace_id)
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
