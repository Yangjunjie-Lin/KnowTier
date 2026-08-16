from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cognigraph.domain.enums import DocumentOrigin
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

    async def get(
        self,
        document_id: UUID,
        *,
        workspace_id: UUID | None = None,
        user_visible_only: bool = False,
    ) -> Document | None:
        statement = select(Document).where(Document.id == document_id)
        if workspace_id is not None:
            statement = statement.where(Document.workspace_id == workspace_id)
        if user_visible_only:
            statement = statement.where(Document.origin == DocumentOrigin.USER_UPLOAD.value)
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

    async def origins_for_ids(
        self,
        workspace_id: UUID,
        document_ids: set[UUID],
    ) -> dict[UUID, DocumentOrigin]:
        if not document_ids:
            return {}
        statement = select(Document).where(
            Document.workspace_id == workspace_id,
            Document.id.in_(document_ids),
        )
        records = list((await self.session.scalars(statement)).all())
        origins: dict[UUID, DocumentOrigin] = {}
        for record in records:
            try:
                origins[record.id] = DocumentOrigin(record.origin)
            except ValueError:
                continue
        return origins

    async def list_for_workspace(
        self,
        workspace_id: UUID,
        *,
        user_visible_only: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Document]:
        if not 1 <= limit <= 101:
            raise ValueError("limit must be between 1 and 101")
        if offset < 0:
            raise ValueError("offset cannot be negative")
        statement = select(Document).where(Document.workspace_id == workspace_id)
        if user_visible_only:
            statement = statement.where(Document.origin == DocumentOrigin.USER_UPLOAD.value)
        statement = (
            statement.order_by(Document.created_at.desc(), Document.id).offset(offset).limit(limit)
        )
        return list((await self.session.scalars(statement)).all())

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
