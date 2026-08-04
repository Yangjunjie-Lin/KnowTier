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


class ParsedDocument(DomainModel):
    parser_name: str
    parser_version: str
    page_count: int = Field(ge=0)
    blocks: list[ParsedBlock] = Field(default_factory=list)
    language: str | None = None
    raw_payload: JsonObject = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class StoredUpload(DomainModel):
    document_id: UUID
    deduplicated: bool = False
