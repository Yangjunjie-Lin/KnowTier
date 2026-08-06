"""Optional PaddleOCR integration.

The application deliberately keeps OCR optional. The production extra pins
PaddleOCR and PaddlePaddle to the 3.x API family, while result normalization
also understands legacy fixtures so migrations can be tested deterministically.
"""

from __future__ import annotations

import importlib
import os
import tempfile
import threading
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Protocol, cast

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from cognigraph.domain.documents import BoundingBox
from cognigraph.ingestion.models import ParsedBlock, ParsedDocument


class OCRUnavailableError(RuntimeError):
    """Raised when the optional OCR runtime or a PDF renderer is unavailable."""


class _RenderedPdfPage(Protocol):
    """Minimal image surface returned by the optional pdf2image package."""

    def save(self, fp: str | Path, *, format: str) -> None: ...


class _PdfPageConverter(Protocol):
    """Typed boundary for pdf2image without making it a required dependency."""

    def __call__(
        self,
        pdf_path: str,
        *,
        dpi: int,
        fmt: str,
    ) -> list[_RenderedPdfPage]: ...


class PaddleOCRAdapter:
    """Parse images with PaddleOCR 3.x and preserve page/bounding-box metadata."""

    parser_name = "paddleocr"

    def __init__(
        self,
        language: str = "ch",
        *,
        min_confidence: float = 0.0,
        low_confidence_threshold: float = 0.6,
        pdf_dpi: int = 200,
    ) -> None:
        if not 0.0 <= min_confidence <= 1.0:
            raise ValueError("min_confidence must be between 0 and 1")
        if not 0.0 <= low_confidence_threshold <= 1.0:
            raise ValueError("low_confidence_threshold must be between 0 and 1")
        if pdf_dpi < 72 or pdf_dpi > 600:
            raise ValueError("pdf_dpi must be between 72 and 600")
        self.language = language
        self.min_confidence = min_confidence
        self.low_confidence_threshold = low_confidence_threshold
        self.pdf_dpi = pdf_dpi
        self._engine: Any | None = None
        # Paddle predictors are not documented as thread-safe. Runtime owns a
        # single adapter, so one lock both initializes and executes the cached
        # engine without repeatedly loading hundreds of MB of model weights.
        self._engine_lock = threading.Lock()

    @staticmethod
    def require_runtime() -> None:
        """Fail fast when OCR was enabled without its optional runtime.

        This deliberately verifies imports without constructing a predictor:
        predictor construction may download model weights and remains a lazy,
        first-use operation. The Docker OCR profile separately runs Paddle's
        CPU self-check before starting the API.
        """

        for module_name, distribution_name in (
            ("paddle", "paddlepaddle"),
            ("paddleocr", "paddleocr"),
        ):
            try:
                importlib.import_module(module_name)
            except Exception as exc:
                raise OCRUnavailableError(
                    "OCR is enabled but "
                    f"{distribution_name} is unavailable; install with "
                    "`uv sync --extra ocr` or start the Docker OCR profile"
                ) from exc

        renderer_available = False
        for module_name in ("fitz", "pdf2image"):
            try:
                importlib.import_module(module_name)
            except Exception:
                continue
            renderer_available = True
            break
        if not renderer_available:
            raise OCRUnavailableError(
                "OCR is enabled but no scanned-PDF renderer is available; "
                "install with `uv sync --extra ocr` or start the Docker OCR profile"
            )

    def parse(self, path: Path, *, page_number: int = 1) -> ParsedDocument:
        """Parse one raster image.

        ``page_number`` is used by the scan-PDF path.  Existing callers that
        parse a normal image retain the default value of one.
        """

        with self._engine_lock:
            engine = self._engine_instance()
            return self._parse_with_engine(engine, path, page_number=page_number)

    def _parse_with_engine(
        self,
        engine: Any,
        path: Path,
        *,
        page_number: int,
    ) -> ParsedDocument:
        processed = self._preprocess(path)
        try:
            result = self._predict(engine, processed)
        finally:
            processed.unlink(missing_ok=True)

        blocks = self._blocks_from_result(result, page_number=page_number)
        low_confidence = [
            {
                "page_number": block.page_number or page_number,
                "text": block.text[:200],
                "confidence": block.confidence,
            }
            for block in blocks
            if block.confidence is not None and block.confidence < self.low_confidence_threshold
        ]
        warnings: list[str] = []
        if low_confidence:
            warnings.append(f"{len(low_confidence)} OCR block(s) have low confidence")
        language = _language_name(self.language)
        return ParsedDocument(
            parser_name=self.parser_name,
            parser_version=self.version(),
            page_count=1,
            blocks=blocks,
            language=language,
            detected_language=language,
            raw_payload={"line_count": len(blocks), "language": self.language},
            warnings=warnings,
            parser_chain=[self.parser_name],
            ocr_used=True,
            low_confidence_blocks=low_confidence,
        )

    def parse_pdf(
        self,
        path: Path,
        *,
        page_numbers: set[int] | None = None,
    ) -> ParsedDocument:
        """Render and OCR every page of a scanned PDF.

        Text extraction is intentionally handled by ``DocumentParser`` before
        this method is called.  This method is only for pages with no usable
        text, and therefore never assumes that a PDF has a single page.
        """

        if page_numbers is not None and any(page_number < 1 for page_number in page_numbers):
            raise ValueError("page_numbers must contain positive page numbers")
        all_blocks: list[ParsedBlock] = []
        warnings: list[str] = []
        page_count = 0
        rendered_pages: list[tuple[int, Path]] = []
        try:
            rendered_pages = list(
                self._render_pdf_pages(path)
                if page_numbers is None
                else self._render_pdf_pages(path, page_numbers=page_numbers)
            )
            with self._engine_lock:
                engine = self._engine_instance()
                for page_number, image_path in rendered_pages:
                    page_count = max(page_count, page_number)
                    parsed = self._parse_with_engine(
                        engine,
                        image_path,
                        page_number=page_number,
                    )
                    all_blocks.extend(parsed.blocks)
                    warnings.extend(parsed.warnings)
        except OCRUnavailableError:
            raise
        except Exception as exc:
            raise OCRUnavailableError(f"scan-PDF OCR failed: {type(exc).__name__}") from exc
        finally:
            _cleanup_rendered_pages(rendered_pages)

        language = _language_name(self.language)
        return ParsedDocument(
            parser_name=self.parser_name,
            parser_version=self.version(),
            page_count=page_count,
            blocks=all_blocks,
            language=language,
            detected_language=language,
            raw_payload={"page_count": page_count, "line_count": len(all_blocks)},
            warnings=warnings,
            parser_chain=[self.parser_name, "pdf-renderer"],
            ocr_used=True,
            low_confidence_blocks=[
                {
                    "page_number": block.page_number,
                    "text": block.text[:200],
                    "confidence": block.confidence,
                }
                for block in all_blocks
                if block.confidence is not None and block.confidence < self.low_confidence_threshold
            ],
        )

    def _create_engine(self) -> Any:
        try:
            paddleocr = importlib.import_module("paddleocr")
            paddle_ocr = paddleocr.PaddleOCR
        except (ImportError, AttributeError) as exc:
            raise OCRUnavailableError(
                "PaddleOCR optional dependency is not installed; use the ocr profile"
            ) from exc

        try:
            return paddle_ocr(
                lang=self.language,
                use_doc_orientation_classify=True,
                use_doc_unwarping=False,
                use_textline_orientation=True,
                # PaddlePaddle 3.3 on Windows can select a oneDNN/PIR path
                # that cannot execute OCR model array attributes. The plain
                # CPU backend is portable across the supported platforms.
                enable_mkldnn=False,
            )
        except Exception as exc:
            raise OCRUnavailableError("PaddleOCR 3.x could not be initialized") from exc

    def _engine_instance(self) -> Any:
        if self._engine is None:
            self._engine = self._create_engine()
        return self._engine

    @staticmethod
    def _predict(engine: Any, path: Path) -> Any:
        predict = getattr(engine, "predict", None)
        if not callable(predict):
            raise OCRUnavailableError("installed PaddleOCR 3.x has no predict method")
        return predict(str(path))

    def _blocks_from_result(self, result: Any, *, page_number: int) -> list[ParsedBlock]:
        # PaddleOCR 3.x may return a generator.  Materialize it once so the
        # parser remains deterministic and does not hold provider resources.
        if result is None:
            return []
        if not isinstance(result, (list, tuple)) and hasattr(result, "__iter__"):
            result = list(result)
        if isinstance(result, dict) or hasattr(result, "rec_texts"):
            return self._blocks_from_v3_item(result, page_number=page_number)
        if (
            isinstance(result, (list, tuple))
            and result
            and (isinstance(result[0], dict) or hasattr(result[0], "rec_texts"))
        ):
            return [
                block
                for item in result
                for block in self._blocks_from_v3_item(item, page_number=page_number)
            ]
        return self._blocks_from_v2(result, page_number=page_number)

    def _blocks_from_v2(self, result: Any, *, page_number: int) -> list[ParsedBlock]:
        # For one image the 2.x result is ``[[box, (text, score)], ...]``;
        # occasionally providers wrap it in one extra page list.
        if not isinstance(result, (list, tuple)):
            return []
        lines: Any = result
        if len(result) == 1 and isinstance(result[0], (list, tuple)):
            first = result[0]
            if not _looks_like_line(first):
                lines = first
        blocks: list[ParsedBlock] = []
        for line in lines or []:
            if not isinstance(line, (list, tuple)) or len(line) < 2:
                continue
            text, confidence = _text_and_confidence(line[1])
            if not text or confidence is None or confidence < self.min_confidence:
                continue
            blocks.append(
                ParsedBlock(
                    text=text,
                    page_number=page_number,
                    bounding_box=_ocr_bounding_box(line[0]),
                    block_type="ocr_line",
                    confidence=confidence,
                )
            )
        return blocks

    def _blocks_from_v3_item(self, item: Any, *, page_number: int) -> list[ParsedBlock]:
        def value(name: str, default: Any = None) -> Any:
            if isinstance(item, dict):
                return item.get(name, default)
            return getattr(item, name, default)

        texts = _as_list(value("rec_texts", value("texts", [])))
        scores = _as_list(value("rec_scores", value("scores", [])))
        boxes = _as_list(value("rec_boxes", value("dt_polys", [])))
        blocks: list[ParsedBlock] = []
        for index, raw_text in enumerate(texts):
            text = str(raw_text).strip()
            if not text:
                continue
            confidence = _as_float(scores[index] if index < len(scores) else None)
            if confidence is None:
                confidence = 0.0
            if confidence < self.min_confidence:
                continue
            box = boxes[index] if index < len(boxes) else None
            blocks.append(
                ParsedBlock(
                    text=text,
                    page_number=page_number,
                    bounding_box=_ocr_bounding_box(box),
                    block_type="ocr_line",
                    confidence=confidence,
                )
            )
        return blocks

    @staticmethod
    def _preprocess(path: Path) -> Path:
        descriptor, name = tempfile.mkstemp(prefix="cognigraph-ocr-", suffix=".png")
        os.close(descriptor)
        target = Path(name)
        try:
            with Image.open(path) as image:
                gray = ImageOps.grayscale(image)
                contrasted = ImageEnhance.Contrast(gray).enhance(1.8)
                sharpened = contrasted.filter(ImageFilter.SHARPEN)
                sharpened.save(target, format="PNG")
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return target

    def _render_pdf_pages(
        self,
        path: Path,
        *,
        page_numbers: set[int] | None = None,
    ) -> list[tuple[int, Path]]:
        """Render selected PDF pages to caller-owned temporary PNGs."""

        try:
            fitz = importlib.import_module("fitz")
        except ImportError:
            fitz = None
        if fitz is not None:
            directory = Path(tempfile.mkdtemp(prefix="cognigraph-pdf-"))
            rendered: list[tuple[int, Path]] = []
            try:
                document = fitz.open(str(path))
                try:
                    scale = self.pdf_dpi / 72.0
                    matrix = fitz.Matrix(scale, scale)
                    for number, page in enumerate(document, start=1):
                        if page_numbers is not None and number not in page_numbers:
                            continue
                        output = directory / f"page-{number}.png"
                        page.get_pixmap(matrix=matrix, alpha=False).save(str(output))
                        rendered.append((number, output))
                finally:
                    document.close()
            except Exception:
                _cleanup_rendered_pages(rendered)
                if directory.exists():
                    directory.rmdir()
                raise
            if not rendered:
                directory.rmdir()
            return rendered

        try:
            pdf2image = importlib.import_module("pdf2image")
        except ImportError as exc:
            raise OCRUnavailableError(
                "scan-PDF OCR requires PyMuPDF or pdf2image with Poppler"
            ) from exc
        convert_from_path = cast(_PdfPageConverter, pdf2image.convert_from_path)
        directory = Path(tempfile.mkdtemp(prefix="cognigraph-pdf-"))
        rendered = []
        try:
            images = convert_from_path(str(path), dpi=self.pdf_dpi, fmt="png")
            for number, image in enumerate(images, start=1):
                if page_numbers is not None and number not in page_numbers:
                    continue
                output = directory / f"page-{number}.png"
                image.save(output, format="PNG")
                rendered.append((number, output))
        except Exception:
            _cleanup_rendered_pages(rendered)
            if directory.exists():
                directory.rmdir()
            raise
        if not rendered:
            directory.rmdir()
        return rendered

    @staticmethod
    def version() -> str:
        try:
            return version("paddleocr")
        except PackageNotFoundError:
            return "unavailable"


def _cleanup_rendered_pages(rendered_pages: list[tuple[int, Path]]) -> None:
    parents = {image_path.parent for _, image_path in rendered_pages}
    for _, image_path in rendered_pages:
        image_path.unlink(missing_ok=True)
    for parent in parents:
        if parent.name.startswith("cognigraph-pdf-") and parent.exists():
            try:
                parent.rmdir()
            except OSError:
                continue


def _looks_like_line(value: object) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[1], (list, tuple))
        and bool(value[1])
        and isinstance(value[1][0], str)
    )


def _text_and_confidence(value: object) -> tuple[str, float | None]:
    if isinstance(value, (list, tuple)):
        if not value:
            return "", None
        text = str(value[0]).strip()
        confidence = _as_float(value[1]) if len(value) > 1 else None
        return text, confidence
    return str(value).strip(), None


def _as_list(value: object) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        converted = tolist()
        return converted if isinstance(converted, list) else [converted]
    return [value]


def _as_float(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0.0, min(1.0, float(value)))
    try:
        return max(0.0, min(1.0, float(str(value))))
    except (TypeError, ValueError):
        return None


def _language_name(language: str) -> str:
    normalized = language.casefold()
    if normalized in {"ch", "chinese", "zh", "zh-cn"}:
        return "zh-CN"
    if normalized in {"en", "english", "en-us"}:
        return "en"
    return language


def _ocr_bounding_box(raw: object) -> BoundingBox | None:
    if hasattr(raw, "tolist") and not isinstance(raw, (list, tuple)):
        raw = raw.tolist()
    if not isinstance(raw, (list, tuple)):
        return None
    if len(raw) == 4 and all(
        isinstance(coordinate, (int, float)) and not isinstance(coordinate, bool)
        for coordinate in raw
    ):
        left, top, right, bottom = (float(coordinate) for coordinate in raw)
        return BoundingBox(
            left=min(left, right),
            top=min(top, bottom),
            right=max(left, right),
            bottom=max(top, bottom),
            coordinate_space="image-pixels",
        )
    points = [
        point
        for point in raw
        if isinstance(point, (list, tuple))
        and len(point) >= 2
        and isinstance(point[0], (int, float))
        and isinstance(point[1], (int, float))
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
