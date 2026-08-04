from uuid import uuid4

from cognigraph.extraction.blueprint_builder import BlueprintGraphDeltaBuilder
from cognigraph.graph.applier import GraphSnapshot
from cognigraph.ingestion.chunking import HierarchicalChunker, create_source_spans
from cognigraph.ingestion.models import ParsedBlock, ParsedDocument
from tests.fixtures.factories import blueprint, source_document


def test_source_span_and_chunk_ids_are_stable_for_retries() -> None:
    document_id = uuid4()
    parsed = ParsedDocument(
        parser_name="fixture",
        parser_version="1",
        page_count=1,
        blocks=[
            ParsedBlock(text="First stable block.", page_number=1),
            ParsedBlock(text="Second stable block.", page_number=1),
        ],
    )

    first_spans = create_source_spans(document_id, parsed)
    retry_spans = create_source_spans(document_id, parsed)
    chunker = HierarchicalChunker(max_characters=128)
    first_chunks = chunker.chunk(document_id, first_spans)
    retry_chunks = chunker.chunk(document_id, retry_spans)

    assert [item.id for item in retry_spans] == [item.id for item in first_spans]
    assert [item.id for item in retry_chunks] == [item.id for item in first_chunks]
    assert [item.source_span_ids for item in retry_chunks] == [
        item.source_span_ids for item in first_chunks
    ]


def test_document_graph_delta_id_does_not_change_when_base_revision_advances() -> None:
    workspace_id = uuid4()
    document, span = source_document(workspace_id)
    builder = BlueprintGraphDeltaBuilder()

    initial = builder.build(
        workspace_id=workspace_id,
        document=document,
        source_spans=[span],
        blueprint=blueprint(span.id),
        snapshot=GraphSnapshot(workspace_id=workspace_id),
    )
    advanced_revision_id = uuid4()
    retried = builder.build(
        workspace_id=workspace_id,
        document=document,
        source_spans=[span],
        blueprint=blueprint(span.id),
        snapshot=GraphSnapshot(
            workspace_id=workspace_id,
            revision_id=advanced_revision_id,
            revision_sequence=1,
        ),
    )

    assert retried.id == initial.id
    assert initial.base_revision_id is None
    assert retried.base_revision_id == advanced_revision_id
