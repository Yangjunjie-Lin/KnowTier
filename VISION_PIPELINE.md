# Vision and OCR Pipeline

KnowTier treats documents and images as untrusted data.  Parser output is
evidence for graph extraction; it is never treated as a command for the API,
the model, or the database.

## Resolution order

1. Docling performs layout-aware parsing.
2. For a PDF, page-bound Docling blocks and the PDF text layer are evaluated
   page by page. A successful digital page is preserved while only unresolved
   pages in a mixed or fully scanned PDF continue to OCR.
3. Ordinary images, and only those unresolved PDF pages, are passed to
   PaddleOCR. Page number, pixel bounding box, confidence, and parser version
   are retained in `SourceSpan` provenance.
4. If OCR is unavailable, produces no usable blocks, or cannot handle a
   complex visual, `LiteLLMVisionParser` can request a strict
   `VisionDocumentOutput` from the configured vision model.
5. The parser chain, OCR/Vision flags, detected language, and count of
   low-confidence blocks are stored in the ingestion report and parser payload.

The Vision prompt explicitly says that image content is untrusted and that
embedded instructions must be ignored.  Raw image bytes and base64 data URLs
are not saved in model-call audit records or document parser payloads.

## OCR installation

The default environment does not install OCR packages.  Install the optional
profile locally with:

```powershell
uv sync --extra documents --extra ocr
```

The OCR extra pins PaddleOCR and the CPU PaddlePaddle inference engine to the
supported 3.x API family and includes PyMuPDF for scan-PDF page rendering.
PaddleOCR 2.x constructor/inference APIs are intentionally not used.

For Compose, use the separate profile:

```powershell
docker compose --profile ocr up api-ocr
```

`api-ocr` listens on `${API_OCR_PORT:-8001}` and shares PostgreSQL, Neo4j, and
the upload volume with the default stack.

The profile verifies the PaddlePaddle runtime before starting the API. The
first OCR initialization may download upstream recognition models, so a
production image should prewarm and cache those model files during release.

## Vision configuration

Set `COGNIGRAPH_USE_MOCK_LLM=false`, a provider key, and a multimodal
`COGNIGRAPH_VISION_MODEL`.  The relevant safeguards are:

```text
COGNIGRAPH_VISION_ENABLED=true
COGNIGRAPH_VISION_FALLBACK_ENABLED=true
COGNIGRAPH_VISION_MAX_IMAGE_BYTES=12582912
COGNIGRAPH_VISION_MAX_OUTPUT_BLOCKS=500
COGNIGRAPH_OCR_LOW_CONFIDENCE_THRESHOLD=0.6
COGNIGRAPH_OCR_MIN_TEXT_QUALITY=0.2
COGNIGRAPH_OCR_PDF_DPI=200
```

When a fully visual input has no usable block and both OCR and Vision are unavailable,
ingestion fails with a clear validation error rather than creating source-less facts. For a
mixed PDF with usable digital pages, any unresolved pages remain explicit in parser metadata and
warnings; the pipeline does not invent content for them.

The opt-in integration checks cover English and Chinese images, rotated text,
low-contrast text, multi-column layout, and scanned PDFs.  Set
`COGNIGRAPH_RUN_OCR_TESTS=1` plus the fixture variables documented in
`tests/integration/test_ocr_live.py` to run them in an OCR image. The release workflow runs this
job for a published release, or for a manual dispatch only when `run_ocr` is selected; once
enabled, missing fixtures or runtime dependencies fail the job instead of silently skipping it.
