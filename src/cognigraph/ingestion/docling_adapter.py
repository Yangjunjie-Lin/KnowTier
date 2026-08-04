from __future__ import annotations

import json
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from cognigraph.domain.documents import BoundingBox
from cognigraph.ingestion.models import ParsedBlock, ParsedDocument
from cognigraph.ingestion.ocr_adapter import OCRUnavailableError, PaddleOCRAdapter


class DocumentParser:
    """Docling-first parser with concrete format-specific offline fallbacks."""

    def __init__(self, ocr: PaddleOCRAdapter | None = None) -> None:
        self.ocr = ocr or PaddleOCRAdapter()

    def parse(self, path: Path, mime_type: str) -> ParsedDocument:
        try:
            parsed = self._parse_docling(path)
            if parsed.blocks:
                return parsed
            fallback = self._parse_fallback(path, mime_type)
            fallback.warnings.insert(0, "Docling produced no usable text blocks")
            return fallback
        except (ImportError, RuntimeError, ValueError, OSError) as exc:
            fallback = self._parse_fallback(path, mime_type)
            fallback.warnings.insert(0, f"Docling unavailable or failed: {type(exc).__name__}")
            return fallback

    @staticmethod
    def _parse_docling(path: Path) -> ParsedDocument:
        try:
            from docling.document_converter import (
                DocumentConverter,
            )
        except ImportError as exc:
            raise ImportError("Docling optional dependency is not installed") from exc
        converter = DocumentConverter()
        result: Any = converter.convert(path)
        document = result.document
        payload: dict[str, Any] = document.export_to_dict()
        blocks: list[ParsedBlock] = []
        texts = getattr(document, "texts", [])
        heading_path: list[str] = []
        for item in texts:
            text = str(getattr(item, "text", "")).strip()
            if not text:
                continue
            page_number: int | None = None
            provenance = getattr(item, "prov", None) or []
            if provenance:
                page_number = int(getattr(provenance[0], "page_no", 0) or 0) or None
            label = str(getattr(item, "label", "paragraph"))
            normalized_label = label.casefold()
            if "title" in normalized_label or "section_header" in normalized_label:
                heading_path = [text]
            blocks.append(
                ParsedBlock(
                    text=text,
                    page_number=page_number,
                    heading_path=list(heading_path),
                    bounding_box=_docling_bounding_box(provenance[0]) if provenance else None,
                    block_type=label,
                )
            )
        if not blocks:
            markdown = str(document.export_to_markdown()).strip()
            if markdown:
                blocks.append(ParsedBlock(text=markdown, page_number=1))
        pages = getattr(document, "pages", {})
        return ParsedDocument(
            parser_name="docling",
            parser_version=_package_version("docling"),
            page_count=max(len(pages), 1 if blocks else 0),
            blocks=blocks,
            raw_payload=json.loads(json.dumps(payload, default=str)),
        )

    def _parse_fallback(self, path: Path, mime_type: str) -> ParsedDocument:
        suffix = path.suffix.casefold()
        if suffix == ".pdf" or mime_type == "application/pdf":
            return self._parse_pdf(path)
        if suffix == ".docx":
            return self._parse_docx(path)
        if suffix == ".pptx":
            return self._parse_pptx(path)
        if suffix in {".txt", ".md"} or mime_type.startswith("text/"):
            text = path.read_text(encoding="utf-8-sig")
            blocks = [
                ParsedBlock(text=part.strip(), page_number=1)
                for part in text.split("\n\n")
                if part.strip()
            ]
            return ParsedDocument(
                parser_name="plain-text",
                parser_version="1",
                page_count=1,
                blocks=blocks,
                raw_payload={"character_count": len(text)},
            )
        if mime_type.startswith("image/"):
            try:
                return self.ocr.parse(path)
            except OCRUnavailableError as exc:
                return ParsedDocument(
                    parser_name="pillow-image",
                    parser_version=_package_version("pillow"),
                    page_count=1,
                    blocks=[],
                    raw_payload={},
                    warnings=[str(exc), "Image requires Docling, PaddleOCR, or a vision model."],
                )
        raise ValueError(f"no parser for {mime_type}")

    @staticmethod
    def _parse_pdf(path: Path) -> ParsedDocument:
        reader = PdfReader(str(path))
        blocks = []
        for index, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                blocks.append(ParsedBlock(text=text, page_number=index))
        warnings = [] if blocks else ["PDF contains no extractable text; OCR is required."]
        return ParsedDocument(
            parser_name="pypdf",
            parser_version=_package_version("pypdf"),
            page_count=len(reader.pages),
            blocks=blocks,
            raw_payload={"page_count": len(reader.pages)},
            warnings=warnings,
        )

    @staticmethod
    def _parse_docx(path: Path) -> ParsedDocument:
        try:
            from docx import Document as DocxDocument
        except ImportError as exc:
            raise RuntimeError("python-docx is required for DOCX fallback parsing") from exc
        document = DocxDocument(str(path))
        blocks = []
        heading_path: list[str] = []
        for paragraph in document.paragraphs:
            text = paragraph.text.strip()
            if not text:
                continue
            style_name = paragraph.style.name if paragraph.style is not None else ""
            if style_name.startswith("Heading"):
                heading_path = [text]
            blocks.append(ParsedBlock(text=text, page_number=1, heading_path=heading_path))
        return ParsedDocument(
            parser_name="python-docx",
            parser_version=_package_version("python-docx"),
            page_count=1,
            blocks=blocks,
            raw_payload={"paragraph_count": len(document.paragraphs)},
        )

    @staticmethod
    def _parse_pptx(path: Path) -> ParsedDocument:
        try:
            from pptx import Presentation
        except ImportError as exc:
            raise RuntimeError("python-pptx is required for PPTX fallback parsing") from exc
        presentation = Presentation(str(path))
        blocks: list[ParsedBlock] = []
        for page_number, slide in enumerate(presentation.slides, start=1):
            for shape in slide.shapes:
                text = str(getattr(shape, "text", "")).strip()
                if text:
                    blocks.append(ParsedBlock(text=text, page_number=page_number))
        return ParsedDocument(
            parser_name="python-pptx",
            parser_version=_package_version("python-pptx"),
            page_count=len(presentation.slides),
            blocks=blocks,
            raw_payload={"slide_count": len(presentation.slides)},
        )


def _package_version(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "unknown"


def _docling_bounding_box(provenance: object) -> BoundingBox | None:
    raw = getattr(provenance, "bbox", None)
    if raw is None:
        return None

    def coordinate(*names: str) -> float | None:
        for name in names:
            value = getattr(raw, name, None)
            if isinstance(value, int | float):
                return float(value)
        return None

    left = coordinate("l", "left", "x0")
    top = coordinate("t", "top", "y0")
    right = coordinate("r", "right", "x1")
    bottom = coordinate("b", "bottom", "y1")
    if None in {left, top, right, bottom}:
        return None
    assert left is not None and top is not None and right is not None and bottom is not None
    origin = str(getattr(raw, "coord_origin", "page"))
    return BoundingBox(
        left=min(left, right),
        top=min(top, bottom),
        right=max(left, right),
        bottom=max(top, bottom),
        coordinate_space=f"docling:{origin}",
    )
