"""Opt-in real OCR checks.

Set ``COGNIGRAPH_RUN_OCR_TESTS=1`` and provide the six fixture paths to run
these checks in an OCR-capable CI image.  They are deliberately excluded from
the default network-free suite.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from cognigraph.ingestion.ocr_adapter import PaddleOCRAdapter

pytestmark = pytest.mark.ocr


@pytest.fixture(scope="module")
def english_ocr() -> PaddleOCRAdapter:
    return PaddleOCRAdapter(language="en")


@pytest.fixture(scope="module")
def chinese_ocr() -> PaddleOCRAdapter:
    return PaddleOCRAdapter(language="ch")


def _fixture_path(name: str) -> Path:
    if os.getenv("COGNIGRAPH_RUN_OCR_TESTS") != "1":
        pytest.skip("set COGNIGRAPH_RUN_OCR_TESTS=1 to execute real OCR checks")
    value = os.getenv(name)
    if not value:
        pytest.fail(f"{name} is required when COGNIGRAPH_RUN_OCR_TESTS=1")
    path = Path(value)
    if not path.is_file():
        pytest.fail(f"OCR fixture does not exist: {path}")
    return path


@pytest.mark.parametrize(
    ("environment_name", "language"),
    [
        ("COGNIGRAPH_OCR_EN_IMAGE", "en"),
        ("COGNIGRAPH_OCR_ZH_IMAGE", "ch"),
    ],
)
def test_real_image_ocr(
    environment_name: str,
    language: str,
    english_ocr: PaddleOCRAdapter,
    chinese_ocr: PaddleOCRAdapter,
) -> None:
    path = _fixture_path(environment_name)
    adapter = english_ocr if language == "en" else chinese_ocr
    parsed = adapter.parse(path)
    assert parsed.blocks
    assert all(block.page_number == 1 for block in parsed.blocks)
    assert any(block.bounding_box is not None for block in parsed.blocks)


def test_real_scanned_pdf_ocr(english_ocr: PaddleOCRAdapter) -> None:
    path = _fixture_path("COGNIGRAPH_OCR_SCANNED_PDF")
    parsed = english_ocr.parse_pdf(path)
    assert parsed.page_count >= 1
    assert parsed.blocks
    assert all(block.page_number is not None for block in parsed.blocks)


@pytest.mark.parametrize(
    "environment_name",
    [
        "COGNIGRAPH_OCR_ROTATED_IMAGE",
        "COGNIGRAPH_OCR_LOW_CONTRAST_IMAGE",
        "COGNIGRAPH_OCR_MULTICOLUMN_IMAGE",
    ],
)
def test_real_ocr_preprocessing_variants(
    environment_name: str,
    english_ocr: PaddleOCRAdapter,
) -> None:
    path = _fixture_path(environment_name)
    parsed = english_ocr.parse(path)
    assert parsed.blocks
    assert parsed.ocr_used
