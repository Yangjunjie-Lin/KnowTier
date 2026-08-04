from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from cognigraph.ingestion.docling_adapter import DocumentParser
from cognigraph.ingestion.models import ParsedBlock, ParsedDocument
from cognigraph.ingestion.ocr_adapter import PaddleOCRAdapter


class StubOCRAdapter(PaddleOCRAdapter):
    def parse(self, path: Path) -> ParsedDocument:
        assert path.suffix == ".png"
        return ParsedDocument(
            parser_name="paddleocr",
            parser_version="test",
            page_count=1,
            language="zh-CN",
            blocks=[ParsedBlock(text="前置知识", page_number=1, block_type="ocr_line")],
        )


def test_empty_docling_image_result_uses_ocr_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "scan.png"
    Image.new("RGB", (20, 20), color="white").save(image_path)
    parser = DocumentParser(ocr=StubOCRAdapter())
    empty = ParsedDocument(
        parser_name="docling",
        parser_version="test",
        page_count=1,
        blocks=[],
    )
    monkeypatch.setattr(parser, "_parse_docling", lambda _path: empty)

    parsed = parser.parse(image_path, "image/png")

    assert parsed.parser_name == "paddleocr"
    assert parsed.blocks[0].text == "前置知识"
    assert parsed.warnings == ["Docling produced no usable text blocks"]
