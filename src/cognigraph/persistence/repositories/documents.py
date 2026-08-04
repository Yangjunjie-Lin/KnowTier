from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.persistence.postgres.models import Document, DocumentChunk, SourceSpan


class DocumentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, document: Document) -> Document:
        self.session.add(document)
        await self.session.flush()
        return document

    async def create(
        self,
        *,
        workspace_id: UUID,
        filename: str,
        storage_path: str,
        mime_type: str,
        byte_size: int,
        sha256: str,
        safe_storage_name: str | None = None,
        document_id: UUID | None = None,
        **values: Any,
    ) -> Document:
        attributes: dict[str, Any] = {
            "workspace_id": workspace_id,
            "filename": filename,
            "safe_storage_name": safe_storage_name or filename,
            "storage_path": storage_path,
            "mime_type": mime_type,
            "byte_size": byte_size,
            "sha256": sha256,
            **values,
        }
        if document_id is not None:
            attributes["id"] = document_id
        return await self.add(Document(**attributes))

    async def get(self, document_id: UUID, *, workspace_id: UUID | None = None) -> Document | None:
        statement = select(Document).where(Document.id == document_id)
        if workspace_id is not None:
            statement = statement.where(Document.workspace_id == workspace_id)
        result: Document | None = await self.session.scalar(statement)
        return result

    async def get_by_hash(self, workspace_id: UUID, sha256: str) -> Document | None:
        result: Document | None = await self.session.scalar(
            select(Document).where(
                Document.workspace_id == workspace_id,
                Document.sha256 == sha256,
            )
        )
        return result

    async def add_chunks(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        self.session.add_all(chunks)
        await self.session.flush()
        return chunks

    async def list_chunks(self, document_id: UUID) -> list[DocumentChunk]:
        result = await self.session.scalars(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.ordinal)
        )
        return list(result.all())

    async def add_source_spans(self, spans: list[SourceSpan]) -> list[SourceSpan]:
        self.session.add_all(spans)
        await self.session.flush()
        return spans

    async def list_source_spans(self, document_id: UUID) -> list[SourceSpan]:
        result = await self.session.scalars(
            select(SourceSpan)
            .where(SourceSpan.document_id == document_id)
            .order_by(SourceSpan.page_number, SourceSpan.start_offset)
        )
        return list(result.all())
