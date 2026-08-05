from __future__ import annotations

from uuid import UUID

from pydantic import Field

from cognigraph.domain.base import DomainModel, JsonObject
from cognigraph.domain.documents import BoundingBox


class ParsedBlock(DomainModel):
    text: str = Field(min_length=1)
    page_number: int | None = Field(default=None, ge=1)
    heading_path: list[str] = Field(default_factory=list)
    bounding_box: BoundingBox | None = None
    block_type: str = "paragraph"
    # Parser confidence is deliberately optional: Docling/text extractors do not
    # provide a calibrated score, while OCR and vision providers do.
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    description: str | None = None


class ParsedDocument(DomainModel):
    parser_name: str
    parser_version: str
    page_count: int = Field(ge=0)
    blocks: list[ParsedBlock] = Field(default_factory=list)
    language: str | None = None
    raw_payload: JsonObject = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    # The chain is persisted with the parser payload so operators can diagnose
    # whether text extraction, OCR, or a vision fallback was used.
    parser_chain: list[str] = Field(default_factory=list)
    ocr_used: bool = False
    vision_used: bool = False
    detected_language: str | None = None
    low_confidence_blocks: list[dict[str, object]] = Field(default_factory=list)


class VisionBlock(DomainModel):
    """A structured block returned by a vision model."""

    text: str = Field(min_length=1)
    block_type: str = Field(min_length=1)
    page_number: int = Field(default=1, ge=1)
    bounding_box: BoundingBox | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    description: str | None = None


class VisionDocumentOutput(DomainModel):
    """Strict, bounded output contract for the vision model fallback."""

    language: str | None = None
    blocks: list[VisionBlock] = Field(default_factory=list, max_length=2_000)
    warnings: list[str] = Field(default_factory=list, max_length=100)


class StoredUpload(DomainModel):
    document_id: UUID
    deduplicated: bool = False
