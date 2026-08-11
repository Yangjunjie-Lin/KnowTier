from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Protocol
from uuid import UUID, uuid4

from cognigraph.config import Settings
from cognigraph.domain.base import utc_now
from cognigraph.domain.documents import Document, DocumentChunk, IngestionReport, SourceSpan
from cognigraph.domain.enums import DocumentStatus
from cognigraph.extraction import BlueprintGraphDeltaBuilder, KnowledgeBlueprint
from cognigraph.extraction.knowledge_extractor import KnowledgeExtractor
from cognigraph.graph.applier import (
    GraphApplyResult,
    GraphSnapshot,
    InMemoryGraphApplier,
    InMemoryGraphStore,
)
from cognigraph.graph.comparison import GraphComparisonResult, GraphComparisonService
from cognigraph.graph.delta import GraphDelta
from cognigraph.graph.validator import GraphDeltaValidator, ShaclGraphValidator
from cognigraph.ingestion.chunking import HierarchicalChunker, create_source_spans
from cognigraph.ingestion.docling_adapter import DocumentParser
from cognigraph.ingestion.models import ParsedDocument, StoredUpload
from cognigraph.ingestion.provenance import (
    safe_storage_path,
    sha256_bytes,
    validate_upload,
)
from cognigraph.llm.embedding import EmbeddingProvider
from cognigraph.llm.schemas import ModelCallContext

logger = logging.getLogger(__name__)


class DocumentLoader(Protocol):
    async def load(self, document_id: UUID) -> Document | None: ...

    async def find_by_hash(self, workspace_id: UUID, content_hash: str) -> Document | None: ...


class InMemoryDocumentRegistry:
    """Local operational store used by tests/demo; production can mirror it to PostgreSQL."""

    def __init__(self, loader: DocumentLoader | None = None) -> None:
        self.loader = loader
        self.documents: dict[UUID, Document] = {}
        self.hash_index: dict[tuple[UUID, str], UUID] = {}
        self.parsed: dict[UUID, ParsedDocument] = {}
        self.spans: dict[UUID, list[SourceSpan]] = {}
        self.chunks: dict[UUID, list[DocumentChunk]] = {}
        self.blueprints: dict[UUID, KnowledgeBlueprint] = {}
        self.reports: dict[UUID, IngestionReport] = {}
        self._lock = asyncio.Lock()

    async def add(self, document: Document) -> tuple[Document, bool]:
        async with self._lock:
            key = (document.workspace_id, document.content_hash)
            existing_id = self.hash_index.get(key)
            if existing_id is not None:
                return self.documents[existing_id], True
            self.documents[document.id] = document
            self.hash_index[key] = document.id
            return document, False

    async def get(self, document_id: UUID) -> Document:
        try:
            return self.documents[document_id]
        except KeyError:
            if self.loader is not None:
                loaded = await self.loader.load(document_id)
                if loaded is not None:
                    await self.cache(loaded)
                    return loaded
            raise KeyError(f"document {document_id} was not found") from None

    async def find_by_hash(self, workspace_id: UUID, content_hash: str) -> Document | None:
        async with self._lock:
            existing_id = self.hash_index.get((workspace_id, content_hash))
            if existing_id is not None:
                return self.documents[existing_id]
        if self.loader is None:
            return None
        loaded = await self.loader.find_by_hash(workspace_id, content_hash)
        if loaded is not None:
            await self.cache(loaded)
        return loaded

    async def cache(self, document: Document) -> None:
        async with self._lock:
            key = (document.workspace_id, document.content_hash)
            replaced_id = self.hash_index.get(key)
            if replaced_id is not None and replaced_id != document.id:
                self.documents.pop(replaced_id, None)
            self.documents[document.id] = document
            self.hash_index[key] = document.id

    async def update(self, document: Document) -> None:
        if document.id not in self.documents:
            raise KeyError(f"document {document.id} was not found")
        self.documents[document.id] = document


class GraphDeltaRecorder(Protocol):
    async def record(self, delta: GraphDelta) -> UUID: ...


class GraphDeltaConflictError(RuntimeError):
    """A graph delta lost an optimistic revision race and may be rebuilt."""


class GraphSnapshotLoader(Protocol):
    async def __call__(self, workspace_id: UUID, *, force: bool = False) -> GraphSnapshot: ...


class GraphProposalSink(Protocol):
    async def record(
        self,
        *,
        workspace_id: UUID,
        document_id: UUID,
        graph_revision_id: UUID | None,
        result: GraphComparisonResult,
    ) -> None: ...


class DocumentRecordSink(DocumentLoader, Protocol):
    async def uploaded(self, document: Document) -> Document: ...

    async def load_report(self, document_id: UUID) -> IngestionReport | None: ...

    async def staged(
        self,
        document: Document,
        parsed: ParsedDocument,
        spans: list[SourceSpan],
        chunks: list[DocumentChunk],
        blueprint: KnowledgeBlueprint,
    ) -> None: ...

    async def completed(self, document: Document, report: IngestionReport) -> None: ...

    async def failed(self, document: Document) -> None: ...


class IngestionService:
    def __init__(
        self,
        *,
        settings: Settings,
        registry: InMemoryDocumentRegistry,
        parser: DocumentParser,
        chunker: HierarchicalChunker,
        embedding_provider: EmbeddingProvider,
        extractor: KnowledgeExtractor,
        graph_applier: InMemoryGraphApplier,
        delta_recorder: GraphDeltaRecorder | None = None,
        document_sink: DocumentRecordSink | None = None,
        validator: GraphDeltaValidator | None = None,
        shacl_validator: ShaclGraphValidator | None = None,
        delta_builder: BlueprintGraphDeltaBuilder | None = None,
        graph_snapshot_loader: GraphSnapshotLoader | None = None,
        graph_comparison: GraphComparisonService | None = None,
        graph_proposal_sink: GraphProposalSink | None = None,
        graph_retry_attempts: int = 3,
    ) -> None:
        if graph_retry_attempts < 1:
            raise ValueError("graph_retry_attempts must be positive")
        self.settings = settings
        self.registry = registry
        self.parser = parser
        self.chunker = chunker
        self.embedding_provider = embedding_provider
        self.extractor = extractor
        self.graph_applier = graph_applier
        self.delta_recorder = delta_recorder
        self.document_sink = document_sink
        self.validator = validator or GraphDeltaValidator()
        self.shacl_validator = shacl_validator or ShaclGraphValidator()
        self.delta_builder = delta_builder or BlueprintGraphDeltaBuilder()
        self.graph_snapshot_loader = graph_snapshot_loader
        self.graph_comparison = graph_comparison or GraphComparisonService(enabled=False)
        self.graph_proposal_sink = graph_proposal_sink
        self.graph_retry_attempts = graph_retry_attempts
        self._ingest_locks: dict[UUID, asyncio.Lock] = {}
        self._workspace_ingest_locks: dict[UUID, asyncio.Lock] = {}

    async def upload(
        self,
        *,
        workspace_id: UUID,
        filename: str,
        mime_type: str,
        content: bytes,
    ) -> StoredUpload:
        input_kind = validate_upload(
            filename=filename,
            mime_type=mime_type,
            content=content,
            settings=self.settings,
        )
        digest = sha256_bytes(content)
        existing = await self.registry.find_by_hash(workspace_id, digest)
        if existing is not None:
            return StoredUpload(document_id=existing.id, deduplicated=True)
        document_id = uuid4()
        path = safe_storage_path(
            self.settings.storage_path,
            workspace_id,
            document_id,
            Path(filename).suffix,
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        document = Document(
            id=document_id,
            workspace_id=workspace_id,
            original_filename=filename,
            storage_path=path,
            mime_type=mime_type,
            input_kind=input_kind,
            content_hash=digest,
            byte_size=len(content),
        )
        if self.document_sink is not None:
            stored = await self.document_sink.uploaded(document)
            deduplicated = stored.id != document.id
            if deduplicated and stored.storage_path != path:
                path.unlink(missing_ok=True)
            await self.registry.cache(stored)
            return StoredUpload(document_id=stored.id, deduplicated=deduplicated)
        stored, deduplicated = await self.registry.add(document)
        if deduplicated and stored.storage_path != path:
            path.unlink(missing_ok=True)
        return StoredUpload(document_id=stored.id, deduplicated=deduplicated)

    async def get_document(self, document_id: UUID) -> Document:
        return await self.registry.get(document_id)

    async def ingest(
        self,
        document_id: UUID,
        *,
        compact_chat_topic: bool = False,
    ) -> IngestionReport:
        lock = self._ingest_locks.setdefault(document_id, asyncio.Lock())
        async with lock:
            if self.document_sink is not None:
                persisted_report = await self.document_sink.load_report(document_id)
                if persisted_report is not None:
                    self.registry.reports[document_id] = persisted_report
                    persisted_document = await self.document_sink.load(document_id)
                    if persisted_document is not None:
                        await self.registry.cache(persisted_document)
                    return persisted_report
            else:
                existing_report = self.registry.reports.get(document_id)
                if existing_report is not None:
                    return existing_report
            document = await self.registry.get(document_id)
            await self.registry.update(
                document.model_copy(
                    update={"status": DocumentStatus.PARSING, "updated_at": utc_now()}
                )
            )
            parsed: ParsedDocument | None = None
            try:
                parsed = await self.parser.parse_async(
                    document.storage_path,
                    document.mime_type,
                    workspace_id=document.workspace_id,
                    document_id=document.id,
                )
                if not parsed.blocks:
                    diagnostics = "; ".join(dict.fromkeys(parsed.warnings))[:1_000]
                    message = "document produced no text blocks; enable OCR or vision parsing"
                    if diagnostics:
                        message = f"{message}. Parser diagnostics: {diagnostics}"
                    raise ValueError(message)
                payload_path = document.storage_path.with_suffix(
                    f"{document.storage_path.suffix}.docling.json"
                )
                payload_path.write_text(
                    json.dumps(parsed.model_dump(mode="json"), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                spans = create_source_spans(document.id, parsed)
                chunks = self.chunker.chunk(document.id, spans)
                embeddings = await self.embedding_provider.embed(
                    [chunk.normalized_text for chunk in chunks]
                )
                chunks = [
                    chunk.model_copy(update={"embedding": embedding})
                    for chunk, embedding in zip(chunks, embeddings, strict=True)
                ]
                blueprint, model_call = await self.extractor.extract(
                    workspace_id=document.workspace_id,
                    chunks=chunks,
                    spans=spans,
                    compact_chat_topic=compact_chat_topic,
                )
                updated_document = document.model_copy(
                    update={
                        "status": DocumentStatus.INGESTED,
                        "parser_name": parsed.parser_name,
                        "parser_version": parsed.parser_version,
                        "page_count": parsed.page_count,
                        "language": parsed.language,
                        "parser_payload_path": payload_path,
                        "warnings": parsed.warnings,
                        "updated_at": utc_now(),
                    }
                )
                if self.document_sink is not None:
                    await self.document_sink.staged(
                        updated_document,
                        parsed,
                        spans,
                        chunks,
                        blueprint,
                    )
                workspace_lock = self._workspace_ingest_locks.setdefault(
                    document.workspace_id, asyncio.Lock()
                )
                async with workspace_lock:
                    delta, applied = await self._apply_graph_update(
                        document=updated_document,
                        spans=spans,
                        blueprint=blueprint,
                        model_run_id=model_call.model_run_id,
                    )
                report = IngestionReport(
                    document_id=document.id,
                    parser=parsed.parser_name,
                    page_count=parsed.page_count,
                    chunk_count=len(chunks),
                    knowledge_point_count=len(blueprint.knowledge_points),
                    assertion_count=len(delta.add_assertions),
                    warning_count=len(parsed.warnings),
                    graph_revision_id=applied.revision.id,
                    parser_chain=parsed.parser_chain,
                    ocr_used=parsed.ocr_used,
                    vision_used=parsed.vision_used,
                    detected_language=parsed.detected_language,
                    low_confidence_blocks=len(parsed.low_confidence_blocks),
                )
                self.registry.parsed[document.id] = parsed
                self.registry.spans[document.id] = spans
                self.registry.chunks[document.id] = chunks
                self.registry.blueprints[document.id] = blueprint
                self.registry.reports[document.id] = report
                await self.registry.update(updated_document)
                if self.document_sink is not None:
                    await self.document_sink.completed(updated_document, report)
                return report
            except Exception as exc:
                failure_warnings = list(document.warnings)
                if parsed is not None:
                    failure_warnings.extend(parsed.warnings)
                failure_warnings.append(f"{type(exc).__name__}: {exc}")
                failed = document.model_copy(
                    update={
                        "status": DocumentStatus.FAILED,
                        "warnings": list(dict.fromkeys(failure_warnings)),
                        "updated_at": utc_now(),
                    }
                )
                await self.registry.update(failed)
                if self.document_sink is not None:
                    await self.document_sink.failed(failed)
                raise

    async def _apply_graph_update(
        self,
        *,
        document: Document,
        spans: list[SourceSpan],
        blueprint: KnowledgeBlueprint,
        model_run_id: UUID | None,
    ) -> tuple[GraphDelta, GraphApplyResult]:
        last_conflict: GraphDeltaConflictError | None = None
        for attempt in range(self.graph_retry_attempts):
            if self.graph_snapshot_loader is None:
                snapshot = self.graph_applier.store.get_snapshot(document.workspace_id)
            else:
                snapshot = await self.graph_snapshot_loader(
                    document.workspace_id,
                    force=attempt > 0,
                )
            comparison = await self.graph_comparison.compare(
                workspace_id=document.workspace_id,
                candidate=blueprint,
                snapshot=snapshot,
                context=ModelCallContext(
                    workspace_id=document.workspace_id,
                    document_id=document.id,
                    graph_revision_id=snapshot.revision_id,
                    prompt_name="graph_delta_builder",
                    prompt_version="1",
                ),
            )
            if self.graph_proposal_sink is not None:
                try:
                    await self.graph_proposal_sink.record(
                        workspace_id=document.workspace_id,
                        document_id=document.id,
                        graph_revision_id=snapshot.revision_id,
                        result=comparison,
                    )
                except Exception as exc:
                    # Proposal persistence is audit-only; it must not prevent
                    # the deterministic, source-grounded graph path.
                    logger.warning(
                        "graph model proposal audit persistence failed",
                        extra={"error_type": type(exc).__name__},
                    )
            delta = self.delta_builder.build(
                workspace_id=document.workspace_id,
                document=document,
                source_spans=spans,
                blueprint=blueprint,
                snapshot=snapshot,
                model_run_id=model_run_id,
                graph_proposal=comparison.proposal,
            )
            self.validator.require_valid(delta, snapshot)
            await self._require_shacl_valid(delta, snapshot)
            try:
                revision_id = (
                    await self.delta_recorder.record(delta)
                    if self.delta_recorder is not None
                    else None
                )
            except GraphDeltaConflictError as exc:
                last_conflict = exc
                continue
            applied = await self.graph_applier.apply(delta, revision_id=revision_id)
            return delta, applied
        if last_conflict is not None:
            raise last_conflict
        raise RuntimeError("graph update did not produce a result")

    async def _require_shacl_valid(
        self,
        delta: GraphDelta,
        snapshot: GraphSnapshot,
    ) -> None:
        preview_store = InMemoryGraphStore()
        preview_store.set_snapshot(snapshot)
        preview = await InMemoryGraphApplier(preview_store).apply(
            delta,
            revision_id=delta.id,
        )
        result = self.shacl_validator.validate_snapshot(preview.snapshot)
        if not result.conforms:
            report = result.report_text.strip().replace("\n", " ")[:500]
            raise ValueError(f"GraphDelta SHACL validation failed: {report}")
