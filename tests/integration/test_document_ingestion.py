from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from cognigraph.config import Settings
from cognigraph.domain.enums import DocumentStatus
from cognigraph.extraction.knowledge_extractor import KnowledgeExtractor
from cognigraph.graph.applier import InMemoryGraphApplier
from cognigraph.ingestion.chunking import HierarchicalChunker
from cognigraph.ingestion.docling_adapter import DocumentParser
from cognigraph.ingestion.models import ParsedDocument
from cognigraph.ingestion.service import IngestionService, InMemoryDocumentRegistry
from cognigraph.llm.embedding import DeterministicEmbeddingProvider
from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import ModelGateway


def minimal_text_pdf(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ),
        (
            b"<< /Length "
            + str(len(stream)).encode("ascii")
            + b" >>\nstream\n"
            + stream
            + b"\nendstream"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    content = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(content))
        content.extend(f"{number} 0 obj\n".encode("ascii"))
        content.extend(obj)
        content.extend(b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    content.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    content.extend(
        (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").encode(
            "ascii"
        )
    )
    return bytes(content)


def make_service(
    tmp_path: Path,
) -> tuple[IngestionService, InMemoryDocumentRegistry, InMemoryGraphApplier]:
    settings = Settings(storage_path=tmp_path, use_mock_llm=True)
    registry = InMemoryDocumentRegistry()
    graph = InMemoryGraphApplier()
    gateway = ModelGateway(settings, FakeProvider())
    service = IngestionService(
        settings=settings,
        registry=registry,
        parser=DocumentParser(),
        chunker=HierarchicalChunker(max_characters=800),
        embedding_provider=DeterministicEmbeddingProvider(),
        extractor=KnowledgeExtractor(gateway),
        graph_applier=graph,
    )
    return service, registry, graph


@pytest.mark.integration
async def test_real_pdf_ingestion_is_source_grounded_and_idempotent(tmp_path: Path) -> None:
    service, registry, graph = make_service(tmp_path)
    workspace_id = uuid4()
    content = minimal_text_pdf(
        "A prerequisite is knowledge required before learning a dependent concept."
    )
    upload = await service.upload(
        workspace_id=workspace_id,
        filename="lesson.pdf",
        mime_type="application/pdf",
        content=content,
    )
    report = await service.ingest(upload.document_id)

    assert report.page_count == 1
    assert report.chunk_count == 1
    assert report.knowledge_point_count == 1
    assert report.graph_revision_id is not None
    assert registry.spans[upload.document_id][0].page_number == 1
    assert registry.chunks[upload.document_id][0].embedding
    assert len(graph.store.get_snapshot(workspace_id).source_spans) == 1

    repeated = await service.ingest(upload.document_id)
    duplicate = await service.upload(
        workspace_id=workspace_id,
        filename="same.pdf",
        mime_type="application/pdf",
        content=content,
    )
    assert repeated.graph_revision_id == report.graph_revision_id
    assert duplicate.deduplicated
    assert duplicate.document_id == upload.document_id
    assert len(graph.store.revisions[workspace_id]) == 1


@pytest.mark.integration
async def test_path_traversal_upload_is_rejected(tmp_path: Path) -> None:
    service, _registry, _graph = make_service(tmp_path)
    with pytest.raises(ValueError, match="path"):
        await service.upload(
            workspace_id=uuid4(),
            filename="../lesson.pdf",
            mime_type="application/pdf",
            content=minimal_text_pdf("content"),
        )


@pytest.mark.integration
async def test_failed_parse_exposes_and_persists_safe_parser_diagnostics(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _registry, _graph = make_service(tmp_path)

    async def no_text(*args: object, **kwargs: object) -> ParsedDocument:
        return ParsedDocument(
            parser_name="paddleocr",
            parser_version="unavailable",
            page_count=1,
            blocks=[],
            warnings=["PaddleOCR optional dependency is unavailable; use the OCR profile"],
            parser_chain=["paddleocr"],
        )

    monkeypatch.setattr(service.parser, "parse_async", no_text)
    upload = await service.upload(
        workspace_id=uuid4(),
        filename="notes.txt",
        mime_type="text/plain",
        content=b"source",
    )

    with pytest.raises(ValueError, match=r"Parser diagnostics: PaddleOCR.*OCR profile"):
        await service.ingest(upload.document_id)

    failed = await service.get_document(upload.document_id)
    assert failed.status is DocumentStatus.FAILED
    assert any("PaddleOCR optional dependency" in warning for warning in failed.warnings)
