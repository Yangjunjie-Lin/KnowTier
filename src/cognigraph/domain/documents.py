"""Document, chunk and immutable source evidence models."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Self
from uuid import UUID, uuid4

from pydantic import Field, field_validator, model_validator

from cognigraph.domain.base import DomainModel, JsonObject, utc_now
from cognigraph.domain.enums import DocumentStatus, InputKind

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class BoundingBox(DomainModel):
    """Normalized or absolute bounding box as reported by the parser."""

    left: float
    top: float
    right: float
    bottom: float
    coordinate_space: str = "page"

    @model_validator(mode="after")
    def ordered_coordinates(self) -> Self:
        if self.right < self.left or self.bottom < self.top:
            raise ValueError("bounding box coordinates must be ordered")
        return self


class SourceSpan(DomainModel):
    """A stable, independently addressable excerpt of source material."""

    id: UUID = Field(default_factory=uuid4)
    document_id: UUID
    page_number: int | None = Field(default=None, ge=1)
    heading_path: list[str] = Field(default_factory=list)
    text: str = Field(min_length=1)
    normalized_text: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    bounding_box: BoundingBox | None = None
    content_hash: str
    parser_name: str = Field(min_length=1)
    parser_version: str = Field(min_length=1)
    created_at: datetime = Field(default_factory=utc_now)

    @field_validator("content_hash")
    @classmethod
    def valid_content_hash(cls, value: str) -> str:
        normalized = value.lower()
        if not _SHA256_PATTERN.fullmatch(normalized):
            raise ValueError("content_hash must be a SHA-256 hex digest")
        return normalized

    @model_validator(mode="after")
    def valid_offsets(self) -> Self:
        if self.end_offset <= self.start_offset:
            raise ValueError("end_offset must be greater than start_offset")
        return self


class Document(DomainModel):
    """Uploaded document metadata; raw content is held outside this model."""

    id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    original_filename: str = Field(min_length=1)
    storage_path: Path
    mime_type: str = Field(min_length=1)
    input_kind: InputKind
    content_hash: str
    byte_size: int = Field(ge=0)
    language: str | None = None
    status: DocumentStatus = DocumentStatus.UPLOADED
    parser_name: str | None = None
    parser_version: str | None = None
    page_count: int | None = Field(default=None, ge=0)
    parser_payload_path: Path | None = None
    warnings: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @field_validator("content_hash")
    @classmethod
    def valid_content_hash(cls, value: str) -> str:
        normalized = value.lower()
        if not _SHA256_PATTERN.fullmatch(normalized):
            raise ValueError("content_hash must be a SHA-256 hex digest")
        return normalized

    @field_validator("original_filename")
    @classmethod
    def filename_only(cls, value: str) -> str:
        if Path(value).name != value or value in {".", ".."}:
            raise ValueError("original_filename must not contain a path")
        return value


class DocumentChunk(DomainModel):
    """A retrieval unit preserving document hierarchy and evidence links."""

    id: UUID = Field(default_factory=uuid4)
    document_id: UUID
    sequence: int = Field(ge=0)
    text: str = Field(min_length=1)
    normalized_text: str = Field(min_length=1)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    heading_path: list[str] = Field(default_factory=list)
    source_span_ids: list[UUID] = Field(min_length=1)
    token_count: int = Field(ge=1)
    embedding: list[float] | None = None
    metadata: JsonObject = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def pages_are_ordered(self) -> Self:
        if self.page_start is not None and self.page_end is not None:
            if self.page_end < self.page_start:
                raise ValueError("page_end must be greater than or equal to page_start")
        if len(set(self.source_span_ids)) != len(self.source_span_ids):
            raise ValueError("source_span_ids must be unique")
        return self


class IngestionReport(DomainModel):
    document_id: UUID
    parser: str
    page_count: int = Field(ge=0)
    chunk_count: int = Field(ge=0)
    knowledge_point_count: int = Field(ge=0)
    assertion_count: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    graph_revision_id: UUID | None = None
