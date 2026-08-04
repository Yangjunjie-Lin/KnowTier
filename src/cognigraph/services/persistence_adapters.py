from __future__ import annotations

import hashlib
import logging
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from cognigraph.domain.base import utc_now
from cognigraph.domain.documents import Document, DocumentChunk, IngestionReport, SourceSpan
from cognigraph.domain.enums import DocumentStatus
from cognigraph.extraction.schemas import KnowledgeBlueprint
from cognigraph.graph.delta import GraphDelta
from cognigraph.ingestion.models import ParsedDocument
from cognigraph.ingestion.provenance import input_kind_for
from cognigraph.ingestion.service import GraphDeltaConflictError
from cognigraph.llm.observability import ModelRunRecord, ModelRunSink
from cognigraph.persistence.outbox import OutboxDispatcher
from cognigraph.persistence.postgres.database import Database, SqlAlchemyUnitOfWork
from cognigraph.persistence.postgres.models import (
    Document as DocumentRecord,
)
from cognigraph.persistence.postgres.models import (
    DocumentChunk as DocumentChunkRecord,
)
from cognigraph.persistence.postgres.models import GraphChangeEvent, GraphRevision, ModelRun
from cognigraph.persistence.postgres.models import SourceSpan as SourceSpanRecord
from cognigraph.persistence.repositories.graph import GraphRevisionConflictError

logger = logging.getLogger(__name__)


class SqlGraphDeltaRecorder:
    """Commit revision and Outbox atomically before projecting the graph."""

    def __init__(
        self,
        database: Database,
        dispatcher: OutboxDispatcher | None = None,
        *,
        batch_size: int = 20,
    ) -> None:
        if not 1 <= batch_size <= 500:
            raise ValueError("batch_size must be between 1 and 500")
        self.database = database
        self.dispatcher = dispatcher
        self.batch_size = batch_size

    async def record(self, delta: GraphDelta) -> UUID:
        try:
            async with self.database.unit_of_work() as unit:
                result = await unit.graph.persist_delta(delta)
                await unit.commit()
        except GraphRevisionConflictError as exc:
            raise GraphDeltaConflictError(str(exc)) from exc
        except IntegrityError as exc:
            if _is_revision_sequence_conflict(exc):
                raise GraphDeltaConflictError(
                    "another writer committed the next graph revision first"
                ) from exc
            raise
        if self.dispatcher is not None:
            try:
                await self.dispatcher.dispatch_once(batch_size=self.batch_size)
            except Exception as exc:
                logger.warning(
                    "opportunistic outbox dispatch failed after graph commit",
                    extra={"error_type": type(exc).__name__},
                )
        return result.revision_id


class SqlDocumentRecordSink:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def uploaded(self, document: Document) -> Document:
        try:
            async with self.database.unit_of_work() as unit:
                existing = await unit.documents.get_by_hash(
                    document.workspace_id,
                    document.content_hash,
                )
                if existing is not None:
                    return self._domain_document(existing)
                record = await unit.documents.add(
                    DocumentRecord(
                        id=document.id,
                        workspace_id=document.workspace_id,
                        filename=document.original_filename,
                        safe_storage_name=document.storage_path.name,
                        storage_path=str(document.storage_path),
                        mime_type=document.mime_type,
                        byte_size=document.byte_size,
                        sha256=document.content_hash,
                        language=document.language,
                        status=document.status.value,
                    )
                )
                await unit.commit()
                return self._domain_document(record)
        except IntegrityError:
            stored_existing = await self.find_by_hash(
                document.workspace_id,
                document.content_hash,
            )
            if stored_existing is None:
                raise
            return stored_existing

    async def load(self, document_id: UUID) -> Document | None:
        async with self.database.unit_of_work() as unit:
            record = await unit.documents.get(document_id)
        return self._domain_document(record) if record is not None else None

    async def find_by_hash(
        self,
        workspace_id: UUID,
        content_hash: str,
    ) -> Document | None:
        async with self.database.unit_of_work() as unit:
            record = await unit.documents.get_by_hash(workspace_id, content_hash)
        return self._domain_document(record) if record is not None else None

    async def load_report(self, document_id: UUID) -> IngestionReport | None:
        async with self.database.unit_of_work() as unit:
            record = await unit.documents.get(document_id)
            if record is None:
                return None
            if record.ingestion_report is not None:
                return IngestionReport.model_validate(record.ingestion_report)
            recovered = await self._recover_committed_report(unit, record)
            if recovered is None:
                return None
            record.status = DocumentStatus.INGESTED.value
            record.ingestion_report = recovered.model_dump(mode="json")
            record.ingested_at = utc_now()
            record.error_code = None
            await unit.commit()
            return recovered

    async def staged(
        self,
        document: Document,
        parsed: ParsedDocument,
        spans: list[SourceSpan],
        chunks: list[DocumentChunk],
        blueprint: KnowledgeBlueprint,
    ) -> None:
        async with self.database.unit_of_work() as unit:
            record = await unit.documents.get(document.id)
            if record is None:
                raise LookupError(f"document {document.id} has no SQL upload record")
            record.status = "PARSING"
            record.parser_name = document.parser_name
            record.parser_version = document.parser_version
            record.page_count = document.page_count
            record.language = document.language
            record.parser_output = {
                "raw_payload": parsed.raw_payload,
                "warnings": parsed.warnings,
                "blueprint": blueprint.model_dump(mode="json"),
            }

            existing_chunks = await unit.documents.list_chunks(document.id)
            if not existing_chunks:
                chunk_records = [self._chunk_record(document, chunk) for chunk in chunks]
                await unit.documents.add_chunks(chunk_records)
                span_to_chunk = {
                    source_id: chunk.id for chunk in chunks for source_id in chunk.source_span_ids
                }
                span_records = [
                    self._span_record(document, span, span_to_chunk.get(span.id)) for span in spans
                ]
                await unit.documents.add_source_spans(span_records)
            await unit.commit()

    async def completed(self, document: Document, report: IngestionReport) -> None:
        async with self.database.unit_of_work() as unit:
            record = await unit.documents.get(document.id)
            if record is None:
                raise LookupError(f"document {document.id} has no SQL upload record")
            record.status = document.status.value
            record.ingestion_report = report.model_dump(mode="json")
            record.ingested_at = document.updated_at
            record.error_code = None
            await unit.commit()

    async def failed(self, document: Document) -> None:
        async with self.database.unit_of_work() as unit:
            record = await unit.documents.get(document.id)
            if record is not None:
                record.status = document.status.value
                record.error_code = document.warnings[-1][:100] if document.warnings else "FAILED"
            await unit.commit()

    @staticmethod
    async def _recover_committed_report(
        unit: SqlAlchemyUnitOfWork,
        record: DocumentRecord,
    ) -> IngestionReport | None:
        if unit.session is None:
            raise RuntimeError("document recovery requires an active SQL unit of work")
        events = list(
            (
                await unit.session.scalars(
                    select(GraphChangeEvent)
                    .join(GraphRevision, GraphRevision.id == GraphChangeEvent.revision_id)
                    .where(GraphRevision.workspace_id == record.workspace_id)
                    .order_by(GraphRevision.sequence_number)
                )
            ).all()
        )
        stable_delta_id = uuid5(record.id, f"graph-delta:{record.sha256}")
        for event in events:
            revision = await unit.session.get(GraphRevision, event.revision_id)
            if revision is None:
                continue
            legacy_delta_id = uuid5(
                record.id,
                f"graph-delta:{revision.parent_revision_id or 'initial'}",
            )
            if event.idempotency_key not in {
                f"delta:{stable_delta_id}",
                f"delta:{legacy_delta_id}",
            }:
                continue
            parser_output = record.parser_output or {}
            raw_blueprint = parser_output.get("blueprint")
            blueprint = raw_blueprint if isinstance(raw_blueprint, dict) else {}
            knowledge_points = blueprint.get("knowledge_points", [])
            warnings = parser_output.get("warnings", [])
            chunks = await unit.documents.list_chunks(record.id)
            return IngestionReport(
                document_id=record.id,
                parser=record.parser_name or "unknown",
                page_count=record.page_count or 0,
                chunk_count=len(chunks),
                knowledge_point_count=(
                    len(knowledge_points) if isinstance(knowledge_points, list) else 0
                ),
                assertion_count=int(revision.summary.get("assertions_added", 0)),
                warning_count=len(warnings) if isinstance(warnings, list) else 0,
                graph_revision_id=revision.id,
            )
        return None

    @staticmethod
    def _domain_document(record: DocumentRecord) -> Document:
        parser_output = record.parser_output or {}
        raw_warnings = parser_output.get("warnings", [])
        warnings = [str(item) for item in raw_warnings] if isinstance(raw_warnings, list) else []
        if record.error_code and record.error_code not in warnings:
            warnings.append(record.error_code)
        storage_path = Path(record.storage_path)
        parser_payload_path = storage_path.with_suffix(f"{storage_path.suffix}.docling.json")
        return Document(
            id=record.id,
            workspace_id=record.workspace_id,
            original_filename=record.filename,
            storage_path=storage_path,
            mime_type=record.mime_type,
            input_kind=input_kind_for(record.mime_type, Path(record.filename).suffix.casefold()),
            content_hash=record.sha256,
            byte_size=record.byte_size,
            language=record.language,
            status=DocumentStatus(record.status),
            parser_name=record.parser_name,
            parser_version=record.parser_version,
            page_count=record.page_count,
            parser_payload_path=(parser_payload_path if parser_payload_path.exists() else None),
            warnings=warnings,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    @staticmethod
    def _chunk_record(document: Document, chunk: DocumentChunk) -> DocumentChunkRecord:
        return DocumentChunkRecord(
            id=chunk.id,
            workspace_id=document.workspace_id,
            document_id=document.id,
            ordinal=chunk.sequence,
            page_start=chunk.page_start,
            page_end=chunk.page_end,
            heading_path=chunk.heading_path,
            text=chunk.text,
            normalized_text=chunk.normalized_text,
            token_count=chunk.token_count,
            content_hash=hashlib.sha256(chunk.text.encode("utf-8")).hexdigest(),
            embedding=chunk.embedding,
            embedding_model="mock" if chunk.embedding else None,
        )

    @staticmethod
    def _span_record(
        document: Document,
        span: SourceSpan,
        chunk_id: UUID | None,
    ) -> SourceSpanRecord:
        return SourceSpanRecord(
            id=span.id,
            workspace_id=document.workspace_id,
            document_id=document.id,
            chunk_id=chunk_id,
            page_number=span.page_number,
            heading_path=span.heading_path,
            text=span.text,
            normalized_text=span.normalized_text,
            start_offset=span.start_offset,
            end_offset=span.end_offset,
            bounding_box=(span.bounding_box.model_dump(mode="json") if span.bounding_box else None),
            content_hash=span.content_hash,
            parser_name=span.parser_name,
            parser_version=span.parser_version,
            created_at=span.created_at,
        )


class SqlModelRunSink(ModelRunSink):
    def __init__(self, database: Database) -> None:
        self.database = database

    async def record_model_run(self, record: ModelRunRecord) -> None:
        workspace_id = record.context.workspace_id
        if workspace_id is None:
            return
        async with self.database.unit_of_work() as unit:
            session = unit.session
            if session is None:
                raise RuntimeError("unit of work did not initialize its SQL session")
            session.add(
                ModelRun(
                    id=record.id,
                    workspace_id=workspace_id,
                    provider=record.provider,
                    model=record.model,
                    role=record.role.value,
                    prompt_version=record.context.prompt_version,
                    input_tokens=record.usage.input_tokens,
                    output_tokens=record.usage.output_tokens,
                    estimated_cost=Decimal(str(record.usage.estimated_cost)),
                    latency_ms=record.latency_ms,
                    status=record.status,
                    error_type=record.error_type,
                    request_metadata={
                        "prompt_name": record.context.prompt_name,
                        "learner_id": str(record.context.learner_id)
                        if record.context.learner_id
                        else None,
                        "session_id": str(record.context.session_id)
                        if record.context.session_id
                        else None,
                        "turn_id": str(record.context.turn_id) if record.context.turn_id else None,
                    },
                    created_at=record.created_at,
                )
            )
            await unit.commit()


def _is_revision_sequence_conflict(error: IntegrityError) -> bool:
    message = str(error.orig).casefold()
    return "uq_graph_revisions_workspace_id" in message or (
        "graph_revisions.workspace_id" in message and "graph_revisions.sequence_number" in message
    )
