from __future__ import annotations

import hashlib
import re
from uuid import UUID, uuid5

from cognigraph.domain.documents import DocumentChunk, SourceSpan
from cognigraph.ingestion.models import ParsedDocument

_WHITESPACE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


def create_source_spans(
    document_id: UUID,
    parsed: ParsedDocument,
) -> list[SourceSpan]:
    spans: list[SourceSpan] = []
    offset = 0
    for block_index, block in enumerate(parsed.blocks):
        text = block.text.strip()
        normalized = normalize_text(text)
        if not normalized:
            continue
        encoded = text.encode("utf-8")
        content_hash = hashlib.sha256(encoded).hexdigest()
        spans.append(
            SourceSpan(
                id=uuid5(
                    document_id,
                    f"source-span:{block_index}:{offset}:{content_hash}",
                ),
                document_id=document_id,
                page_number=block.page_number,
                heading_path=block.heading_path,
                text=text,
                normalized_text=normalized,
                start_offset=offset,
                end_offset=offset + len(text),
                bounding_box=block.bounding_box,
                content_hash=content_hash,
                parser_name=parsed.parser_name,
                parser_version=parsed.parser_version,
            )
        )
        offset += len(text) + 1
    return spans


class HierarchicalChunker:
    def __init__(self, max_characters: int = 1800) -> None:
        if max_characters < 128:
            raise ValueError("max_characters must be at least 128")
        self.max_characters = max_characters

    def chunk(self, document_id: UUID, spans: list[SourceSpan]) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        current: list[SourceSpan] = []
        current_length = 0

        def flush() -> None:
            nonlocal current, current_length
            if not current:
                return
            text = "\n\n".join(span.text for span in current)
            content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            pages = [span.page_number for span in current if span.page_number is not None]
            heading = current[0].heading_path
            chunks.append(
                DocumentChunk(
                    id=uuid5(
                        document_id,
                        f"document-chunk:{len(chunks)}:{content_hash}",
                    ),
                    document_id=document_id,
                    sequence=len(chunks),
                    text=text,
                    normalized_text=normalize_text(text),
                    page_start=min(pages) if pages else None,
                    page_end=max(pages) if pages else None,
                    heading_path=heading,
                    source_span_ids=[span.id for span in current],
                    token_count=max(1, (len(text.encode("utf-8")) + 3) // 4),
                    metadata={"parser_blocks": len(current)},
                )
            )
            current = []
            current_length = 0

        for span in spans:
            separator = 2 if current else 0
            if current and current_length + separator + len(span.text) > self.max_characters:
                flush()
            current.append(span)
            current_length += separator + len(span.text)
        flush()
        return chunks
