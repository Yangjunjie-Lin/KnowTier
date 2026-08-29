from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from cognigraph.api.schemas import DocumentChunkResponse, DocumentChunksResponse


@pytest.mark.contract
@pytest.mark.parametrize(
    ("internal_field", "internal_value"),
    [
        ("embedding", [0.1, 0.2]),
        ("normalized_text", "a public source excerpt"),
        ("metadata", {"parser_blocks": 1}),
        ("source_span_ids", [uuid4()]),
    ],
)
def test_document_chunk_response_rejects_internal_ingestion_fields(
    internal_field: str,
    internal_value: object,
) -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        DocumentChunkResponse.model_validate(
            {
                "id": uuid4(),
                "sequence": 0,
                "text": "A public source excerpt.",
                "page_start": 1,
                "page_end": 1,
                "heading_path": ["Introduction"],
                "token_count": 6,
                internal_field: internal_value,
            }
        )


@pytest.mark.contract
def test_document_chunks_response_has_one_stable_public_shape() -> None:
    document_id = uuid4()
    chunk = DocumentChunkResponse(
        id=uuid4(),
        sequence=0,
        text="A public source excerpt.",
        page_start=None,
        page_end=None,
        heading_path=[],
        token_count=6,
    )

    payload = DocumentChunksResponse(document_id=document_id, items=[chunk]).model_dump(mode="json")

    assert payload == {
        "document_id": str(document_id),
        "items": [
            {
                "id": str(chunk.id),
                "sequence": 0,
                "text": "A public source excerpt.",
                "page_start": None,
                "page_end": None,
                "heading_path": [],
                "token_count": 6,
            }
        ],
    }
