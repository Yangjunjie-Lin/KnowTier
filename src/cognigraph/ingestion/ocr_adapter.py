from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from cognigraph.domain.documents import BoundingBox
from cognigraph.ingestion.models import ParsedBlock, ParsedDocument


class OCRUnavailableError(RuntimeError):
    """Raised when the optional PaddleOCR runtime is not installed."""


class PaddleOCRAdapter:
    parser_name = "paddleocr"

    def __init__(self, language: str = "ch") -> None:
        self.language = language

    def parse(self, path: Path) -> ParsedDocument:
        try:
            from paddleocr import PaddleOCR  # type: ignore[import-not-found]
        except ImportError as exc:
            raise OCRUnavailableError("PaddleOCR optional dependency is not installed") from exc
        processed = self._preprocess(path)
        blocks: list[ParsedBlock] = []
        try:
            engine = PaddleOCR(use_angle_cls=True, lang=self.language, show_log=False)
            result: Any = engine.ocr(str(processed), cls=True)
            for page in result or []:
                for line in page or []:
                    if not isinstance(line, list | tuple) or len(line) < 2:
                        continue
                    text_confidence = line[1]
                    if not isinstance(text_confidence, list | tuple) or not text_confidence:
                        continue
                    text = str(text_confidence[0]).strip()
                    if text:
                        blocks.append(
                            ParsedBlock(
                                text=text,
                                page_number=1,
                                bounding_box=_ocr_bounding_box(line[0]),
                                block_type="ocr_line",
                            )
                        )
        finally:
            processed.unlink(missing_ok=True)
        return ParsedDocument(
            parser_name=self.parser_name,
            parser_version=self.version(),
            page_count=1,
            blocks=blocks,
            language="zh-CN" if self.language == "ch" else self.language,
            raw_payload={"line_count": len(blocks)},
        )

    @staticmethod
    def _preprocess(path: Path) -> Path:
        target = path.with_name(f"{path.stem}.ocr-preprocessed.png")
        with Image.open(path) as image:
            gray = ImageOps.grayscale(image)
            contrasted = ImageEnhance.Contrast(gray).enhance(1.8)
            sharpened = contrasted.filter(ImageFilter.SHARPEN)
            sharpened.save(target, format="PNG")
        return target

    @staticmethod
    def version() -> str:
        try:
            return version("paddleocr")
        except PackageNotFoundError:
            return "unavailable"


def _ocr_bounding_box(raw: object) -> BoundingBox | None:
    if not isinstance(raw, list | tuple):
        return None
    points = [
        point
        for point in raw
        if isinstance(point, list | tuple)
        and len(point) >= 2
        and isinstance(point[0], int | float)
        and isinstance(point[1], int | float)
    ]
    if not points:
        return None
    x_values = [float(point[0]) for point in points]
    y_values = [float(point[1]) for point in points]
    return BoundingBox(
        left=min(x_values),
        top=min(y_values),
        right=max(x_values),
        bottom=max(y_values),
        coordinate_space="image-pixels",
    )
