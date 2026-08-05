from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from PIL import Image

from cognigraph.config import Settings
from cognigraph.ingestion.docling_adapter import DocumentParser
from cognigraph.ingestion.models import (
    ParsedBlock,
    ParsedDocument,
    VisionBlock,
    VisionDocumentOutput,
)
from cognigraph.ingestion.ocr_adapter import OCRUnavailableError, PaddleOCRAdapter
from cognigraph.ingestion.vision_adapter import LiteLLMVisionParser
from cognigraph.llm.gateway import ModelGateway, ModelProvider
from cognigraph.llm.observability import ModelRunRecord
from cognigraph.llm.schemas import (
    ChatMessage,
    ProviderResponse,
    ToolDefinition,
)


class UnavailableOCR(PaddleOCRAdapter):
    def parse(self, path: Path, *, page_number: int = 1) -> ParsedDocument:
        raise OCRUnavailableError("OCR is intentionally unavailable")

    def parse_pdf(
        self,
        path: Path,
        *,
        page_numbers: set[int] | None = None,
    ) -> ParsedDocument:
        raise OCRUnavailableError("OCR is intentionally unavailable")


class FakeVisionParser:
    def __init__(self) -> None:
        self.calls: list[tuple[Path, object, object]] = []
        self.loops: list[asyncio.AbstractEventLoop] = []

    async def parse_image(
        self,
        path: Path,
        *,
        workspace_id: object,
        document_id: object,
    ) -> ParsedDocument:
        self.calls.append((path, workspace_id, document_id))
        self.loops.append(asyncio.get_running_loop())
        return ParsedDocument(
            parser_name="fake-vision",
            parser_version="1",
            page_count=1,
            blocks=[
                ParsedBlock(
                    text="Visible chart title",
                    page_number=1,
                    block_type="chart",
                    confidence=0.9,
                )
            ],
            parser_chain=["fake-vision"],
            vision_used=True,
        )


class FakeVisionGateway:
    def __init__(self) -> None:
        self.messages: list[object] = []

    async def generate_structured(self, **kwargs: object) -> VisionDocumentOutput:
        messages = kwargs["messages"]
        assert isinstance(messages, list)
        self.messages = messages
        return VisionDocumentOutput(
            language="en",
            blocks=[
                VisionBlock(
                    text="Extracted title",
                    block_type="heading",
                    page_number=1,
                    confidence=0.92,
                )
            ],
        )


class AuditedVisionProvider(ModelProvider):
    provider_name = "vision-test"

    def __init__(self) -> None:
        self.loops: list[asyncio.AbstractEventLoop] = []

    async def complete(
        self,
        *,
        model: str,
        messages: list[ChatMessage],
        response_schema: dict[str, Any],
        tools: list[ToolDefinition] | None = None,
        tool_choice: str | dict[str, object] | None = None,
    ) -> ProviderResponse:
        self.loops.append(asyncio.get_running_loop())
        output = VisionDocumentOutput(
            language="en",
            blocks=[
                VisionBlock(
                    text="Audited title",
                    block_type="heading",
                    page_number=1,
                    confidence=0.95,
                )
            ],
        )
        return ProviderResponse(
            content=output.model_dump_json(),
            provider=self.provider_name,
            model=model,
        )


class LoopRecordingSink:
    def __init__(self) -> None:
        self.loops: list[asyncio.AbstractEventLoop] = []
        self.records: list[ModelRunRecord] = []

    async def record_model_run(self, record: ModelRunRecord) -> None:
        self.loops.append(asyncio.get_running_loop())
        self.records.append(record)


def test_document_parser_uses_vision_after_ocr_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "diagram.png"
    Image.new("RGB", (30, 30), color="white").save(image_path)
    vision = FakeVisionParser()
    parser = DocumentParser(ocr=UnavailableOCR(), vision=vision)
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=1,
            blocks=[],
        ),
    )
    workspace_id = uuid4()
    document_id = uuid4()

    parsed = parser.parse(
        image_path,
        "image/png",
        workspace_id=workspace_id,
        document_id=document_id,
    )

    assert parsed.vision_used
    assert parsed.blocks[0].block_type == "chart"
    assert parsed.parser_chain[-1] == "fake-vision"
    assert vision.calls == [(image_path, workspace_id, document_id)]


@pytest.mark.unit
async def test_parse_async_keeps_vision_on_the_application_event_loop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "chart.png"
    Image.new("RGB", (30, 30), color="white").save(image_path)
    vision = FakeVisionParser()
    parser = DocumentParser(ocr=UnavailableOCR(), vision=vision)
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=1,
            blocks=[
                ParsedBlock(
                    text="Revenue by quarter",
                    page_number=1,
                    block_type="chart",
                )
            ],
        ),
    )

    parsed = await parser.parse_async(
        image_path,
        "image/png",
        workspace_id=uuid4(),
        document_id=uuid4(),
    )

    assert vision.loops == [asyncio.get_running_loop()]
    assert {block.text for block in parsed.blocks} == {
        "Revenue by quarter",
        "Visible chart title",
    }
    assert parsed.vision_used


@pytest.mark.unit
async def test_vision_gateway_and_model_audit_stay_on_application_event_loop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "audited.png"
    Image.new("RGB", (30, 30), color="white").save(image_path)
    provider = AuditedVisionProvider()
    sink = LoopRecordingSink()
    settings = Settings(
        _env_file=None,
        vision_model="vision-test-model",
        fallback_models=(),
        llm_max_retries=0,
        ocr_enabled=False,
    )
    gateway = ModelGateway(settings, provider, sink=sink)
    vision = LiteLLMVisionParser(gateway, settings=settings)
    parser = DocumentParser(ocr=UnavailableOCR(), vision=vision)
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=1,
            blocks=[],
        ),
    )
    workspace_id = uuid4()
    document_id = uuid4()

    parsed = await parser.parse_async(
        image_path,
        "image/png",
        workspace_id=workspace_id,
        document_id=document_id,
    )

    active_loop = asyncio.get_running_loop()
    assert parsed.blocks[0].text == "Audited title"
    assert provider.loops == [active_loop]
    assert sink.loops == [active_loop]
    assert sink.records[0].context.workspace_id == workspace_id
    assert sink.records[0].context.document_id == document_id
    assert sink.records[0].role.value == "vision_model"


@pytest.mark.unit
async def test_litellm_vision_parser_uses_multimodal_prompt_and_ignores_image_instructions(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "untrusted.png"
    Image.new("RGB", (20, 20), color="white").save(image_path)
    gateway = FakeVisionGateway()
    parser = LiteLLMVisionParser(gateway)

    parsed = await parser.parse_image(
        image_path,
        workspace_id=uuid4(),
        document_id=uuid4(),
    )

    assert parsed.vision_used
    assert parsed.blocks[0].text == "Extracted title"
    message = gateway.messages[0]
    assert isinstance(message, ChatMessage)
    content = message.content
    assert isinstance(content, list)
    prompt = content[0]["text"]
    assert "untrusted" in prompt
    assert "prompt injection" in prompt
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.unit
def test_paddle_adapter_normalizes_legacy_and_v3_result_shapes() -> None:
    adapter = PaddleOCRAdapter()
    legacy = [
        [
            [[10, 20], [50, 20], [50, 40], [10, 40]],
            ("English text", 0.91),
        ]
    ]
    v3 = [
        {
            "rec_texts": ["Chinese text"],
            "rec_scores": [0.4],
            "rec_boxes": [[1, 2, 5, 8]],
        }
    ]

    legacy_blocks = adapter._blocks_from_result(legacy, page_number=2)
    v3_blocks = adapter._blocks_from_result(v3, page_number=3)

    assert legacy_blocks[0].page_number == 2
    assert legacy_blocks[0].bounding_box is not None
    assert legacy_blocks[0].bounding_box.coordinate_space == "image-pixels"
    assert v3_blocks[0].page_number == 3
    assert v3_blocks[0].confidence == 0.4
    assert v3_blocks[0].bounding_box is not None
    assert v3_blocks[0].bounding_box.right == 5


@pytest.mark.unit
def test_paddle_adapter_reuses_one_engine_across_requests(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = PaddleOCRAdapter()
    engines_created: list[object] = []
    engines_used: list[object] = []

    def create_engine() -> object:
        engine = object()
        engines_created.append(engine)
        return engine

    def parse_with_engine(
        engine: object,
        path: Path,
        *,
        page_number: int,
    ) -> ParsedDocument:
        engines_used.append(engine)
        return ParsedDocument(
            parser_name="paddleocr",
            parser_version="test",
            page_count=1,
            blocks=[ParsedBlock(text=path.stem, page_number=page_number)],
            parser_chain=["paddleocr"],
            ocr_used=True,
        )

    monkeypatch.setattr(adapter, "_create_engine", create_engine)
    monkeypatch.setattr(adapter, "_parse_with_engine", parse_with_engine)

    adapter.parse(tmp_path / "first.png")
    adapter.parse(tmp_path / "second.png")

    assert len(engines_created) == 1
    assert engines_used == [engines_created[0], engines_created[0]]


@pytest.mark.unit
def test_ocr_runtime_preflight_reports_missing_opt_in_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_import = __import__("importlib").import_module

    def import_module(name: str) -> object:
        if name == "paddle":
            raise ImportError("not installed")
        return real_import(name)

    monkeypatch.setattr(
        "cognigraph.ingestion.ocr_adapter.importlib.import_module",
        import_module,
    )

    with pytest.raises(OCRUnavailableError, match=r"OCR is enabled.*paddlepaddle.*extra ocr"):
        PaddleOCRAdapter.require_runtime()


@pytest.mark.unit
def test_scan_pdf_ocr_preserves_rendered_page_numbers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = PaddleOCRAdapter()
    first_page = tmp_path / "page-1.png"
    second_page = tmp_path / "page-2.png"
    Image.new("RGB", (20, 20), color="white").save(first_page)
    Image.new("RGB", (20, 20), color="white").save(second_page)

    def render(_path: Path) -> object:
        yield 1, first_page
        yield 2, second_page

    engines_created: list[object] = []

    def create_engine() -> object:
        engine = object()
        engines_created.append(engine)
        return engine

    def parse_with_engine(
        _engine: object,
        _path: Path,
        *,
        page_number: int = 1,
    ) -> ParsedDocument:
        return ParsedDocument(
            parser_name="paddleocr",
            parser_version="test",
            page_count=1,
            blocks=[ParsedBlock(text=f"page {page_number}", page_number=page_number)],
            parser_chain=["paddleocr"],
            ocr_used=True,
        )

    monkeypatch.setattr(adapter, "_render_pdf_pages", render)
    monkeypatch.setattr(adapter, "_create_engine", create_engine)
    monkeypatch.setattr(adapter, "_parse_with_engine", parse_with_engine)

    parsed = adapter.parse_pdf(tmp_path / "scan.pdf")

    assert parsed.page_count == 2
    assert [block.page_number for block in parsed.blocks] == [1, 2]
    assert parsed.ocr_used
    assert len(engines_created) == 1


@pytest.mark.unit
def test_mixed_pdf_ocr_targets_only_pages_without_text(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Page:
        def __init__(self, text: str) -> None:
            self.text = text

        def extract_text(self) -> str:
            return self.text

    class Reader:
        def __init__(self) -> None:
            self.pages = [Page("Digital text page"), Page("")]

    class SelectiveOCR(PaddleOCRAdapter):
        requested_pages: set[int] | None = None

        def parse_pdf(
            self,
            path: Path,
            *,
            page_numbers: set[int] | None = None,
        ) -> ParsedDocument:
            self.requested_pages = page_numbers
            return ParsedDocument(
                parser_name="paddleocr",
                parser_version="test",
                page_count=2,
                blocks=[ParsedBlock(text="Scanned page text", page_number=2)],
                parser_chain=["paddleocr"],
                ocr_used=True,
            )

    monkeypatch.setattr("cognigraph.ingestion.docling_adapter.PdfReader", lambda _path: Reader())
    adapter = SelectiveOCR()
    parsed = DocumentParser(ocr=adapter)._parse_pdf(tmp_path / "mixed.pdf")

    assert adapter.requested_pages == {2}
    assert [(block.page_number, block.text) for block in parsed.blocks] == [
        (1, "Digital text page"),
        (2, "Scanned page text"),
    ]
    assert parsed.raw_payload["unresolved_pages"] == []


@pytest.mark.unit
def test_docling_mixed_pdf_completion_targets_only_unresolved_pages(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Page:
        def __init__(self, text: str) -> None:
            self.text = text

        def extract_text(self) -> str:
            return self.text

    class Reader:
        def __init__(self) -> None:
            self.pages = [Page("Digital text page"), Page("")]

    class SelectiveOCR(PaddleOCRAdapter):
        requested_pages: set[int] | None = None

        def parse_pdf(
            self,
            path: Path,
            *,
            page_numbers: set[int] | None = None,
        ) -> ParsedDocument:
            self.requested_pages = page_numbers
            return ParsedDocument(
                parser_name="paddleocr",
                parser_version="test",
                page_count=2,
                blocks=[ParsedBlock(text="Scanned page text", page_number=2)],
                parser_chain=["paddleocr"],
                ocr_used=True,
            )

    monkeypatch.setattr("cognigraph.ingestion.docling_adapter.PdfReader", lambda _path: Reader())
    pdf_path = tmp_path / "mixed-with-docling.pdf"
    pdf_path.write_bytes(b"placeholder")
    ocr = SelectiveOCR()
    parser = DocumentParser(ocr=ocr)
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=2,
            blocks=[ParsedBlock(text="Digital text page", page_number=1)],
            parser_chain=["docling"],
        ),
    )

    parsed = parser._parse_without_vision(pdf_path, "application/pdf")

    assert ocr.requested_pages == {2}
    assert [(block.page_number, block.text) for block in parsed.blocks] == [
        (1, "Digital text page"),
        (2, "Scanned page text"),
    ]
    assert parsed.raw_payload["unresolved_pages"] == []


@pytest.mark.unit
def test_docling_pdf_completion_preserves_pypdf_text_when_ocr_is_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Page:
        def __init__(self, text: str) -> None:
            self.text = text

        def extract_text(self) -> str:
            return self.text

    class Reader:
        def __init__(self) -> None:
            self.pages = [Page("Docling page"), Page("Recovered text layer"), Page("")]

    monkeypatch.setattr("cognigraph.ingestion.docling_adapter.PdfReader", lambda _path: Reader())
    pdf_path = tmp_path / "partially-missed.pdf"
    pdf_path.write_bytes(b"placeholder")
    parser = DocumentParser(ocr=UnavailableOCR())
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=3,
            blocks=[ParsedBlock(text="Docling page", page_number=1)],
            parser_chain=["docling"],
        ),
    )

    parsed = parser._parse_without_vision(pdf_path, "application/pdf")

    assert [(block.page_number, block.text) for block in parsed.blocks] == [
        (1, "Docling page"),
        (2, "Recovered text layer"),
    ]
    assert parsed.raw_payload["unresolved_pages"] == [3]
    assert parsed.parser_chain == ["docling", "pypdf"]
    assert "OCR is intentionally unavailable" in parsed.warnings


@pytest.mark.unit
def test_vision_unavailable_returns_clear_parser_warning(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "scan.png"
    Image.new("RGB", (20, 20), color="white").save(image_path)
    parser = DocumentParser(ocr=UnavailableOCR())
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=1,
            blocks=[],
        ),
    )

    parsed = parser.parse(image_path, "image/png")

    assert not parsed.blocks
    assert "Image requires Docling, PaddleOCR, or a vision model." in parsed.warnings


@pytest.mark.unit
def test_disabled_ocr_returns_explicit_image_diagnostic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image_path = tmp_path / "disabled.png"
    Image.new("RGB", (20, 20), color="white").save(image_path)
    parser = DocumentParser(ocr_enabled=False)
    monkeypatch.setattr(
        parser,
        "_parse_docling",
        lambda _path: ParsedDocument(
            parser_name="docling",
            parser_version="test",
            page_count=1,
            blocks=[],
        ),
    )

    parsed = parser.parse(image_path, "image/png")

    assert not parsed.blocks
    assert "Image OCR is disabled by configuration." in parsed.warnings
    assert "configured vision model" in parsed.warnings[-1]
