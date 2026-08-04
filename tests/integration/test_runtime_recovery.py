from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest

from cognigraph.config import Settings
from cognigraph.graph.delta import GraphDelta
from cognigraph.persistence.postgres.models import GraphRevision, OutboxMessage
from cognigraph.services.runtime import ApplicationRuntime


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+aiosqlite:///{(tmp_path / 'recovery.db').as_posix()}",
        storage_path=tmp_path / "uploads",
        use_mock_llm=True,
        neo4j_required=False,
        outbox_worker_enabled=False,
    )


@pytest.mark.integration
async def test_staged_ingestion_retry_reuses_source_and_chunk_ids(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    first_runtime = ApplicationRuntime(settings)
    await first_runtime.startup()
    try:
        async with first_runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(name="Staged", slug="staged-recovery")
        upload = await first_runtime.ingestion.upload(
            workspace_id=workspace.id,
            filename="staged.md",
            mime_type="text/markdown",
            content=b"# Staged\n\nA prerequisite is knowledge required first.",
        )
        recorder = first_runtime.ingestion.delta_recorder
        assert recorder is not None
        first_delta_ids: list[UUID] = []

        async def fail_before_graph_commit(delta: GraphDelta) -> UUID:
            first_delta_ids.append(delta.id)
            raise RuntimeError("simulated graph recorder failure")

        monkeypatch.setattr(recorder, "record", fail_before_graph_commit)
        with pytest.raises(RuntimeError, match="simulated graph recorder failure"):
            await first_runtime.ingestion.ingest(upload.document_id)

        async with first_runtime.database.unit_of_work() as unit:
            staged_span_ids = {
                item.id for item in await unit.documents.list_source_spans(upload.document_id)
            }
            staged_chunk_ids = {
                item.id for item in await unit.documents.list_chunks(upload.document_id)
            }
            assert await unit.graph.list_revisions(workspace.id) == []
        assert staged_span_ids
        assert staged_chunk_ids
    finally:
        await first_runtime.shutdown()

    second_runtime = ApplicationRuntime(settings)
    await second_runtime.startup()
    try:
        recorder = second_runtime.ingestion.delta_recorder
        assert recorder is not None
        original_record = recorder.record
        retry_delta_ids: list[UUID] = []

        async def capture_retry_delta(delta: GraphDelta) -> UUID:
            retry_delta_ids.append(delta.id)
            return await original_record(delta)

        monkeypatch.setattr(recorder, "record", capture_retry_delta)
        report = await second_runtime.ingestion.ingest(upload.document_id)
        async with second_runtime.database.unit_of_work() as unit:
            assert {
                item.id for item in await unit.documents.list_source_spans(upload.document_id)
            } == staged_span_ids
            assert {
                item.id for item in await unit.documents.list_chunks(upload.document_id)
            } == staged_chunk_ids
            revisions = await unit.graph.list_revisions(workspace.id)
        assert len(revisions) == 1
        assert report.graph_revision_id == revisions[0].id
        assert retry_delta_ids == first_delta_ids
    finally:
        await second_runtime.shutdown()


@pytest.mark.integration
async def test_graph_commit_without_document_report_is_recovered_idempotently(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    first_runtime = ApplicationRuntime(settings)
    await first_runtime.startup()
    try:
        async with first_runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(name="Committed", slug="commit-recovery")
        upload = await first_runtime.ingestion.upload(
            workspace_id=workspace.id,
            filename="committed.md",
            mime_type="text/markdown",
            content=b"# Committed\n\nA prerequisite is knowledge required first.",
        )

        async def fail_before_report(_document: object, _report: object) -> None:
            raise RuntimeError("simulated crash before report commit")

        monkeypatch.setattr(first_runtime.document_sink, "completed", fail_before_report)
        with pytest.raises(RuntimeError, match="simulated crash before report commit"):
            await first_runtime.ingestion.ingest(upload.document_id)

        async with first_runtime.database.unit_of_work() as unit:
            revisions = await unit.graph.list_revisions(workspace.id)
            document = await unit.documents.get(upload.document_id)
        assert len(revisions) == 1
        committed_revision_id = revisions[0].id
        assert document is not None
        assert document.ingestion_report is None
    finally:
        await first_runtime.shutdown()

    second_runtime = ApplicationRuntime(settings)
    await second_runtime.startup()
    try:
        recovered = await second_runtime.ingestion.ingest(upload.document_id)
        repeated = await second_runtime.ingestion.ingest(upload.document_id)
        assert recovered == repeated
        assert recovered.graph_revision_id == committed_revision_id

        async with second_runtime.database.unit_of_work() as unit:
            revisions = await unit.graph.list_revisions(workspace.id)
            document = await unit.documents.get(upload.document_id)
        assert len(revisions) == 1
        assert document is not None
        assert document.status == "INGESTED"
        assert document.ingestion_report is not None
    finally:
        await second_runtime.shutdown()


@pytest.mark.integration
async def test_runtime_recovers_ingestion_and_pending_outbox_across_restarts(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path)
    first_content = b"# Prerequisites\n\nA prerequisite is knowledge required first."

    first_runtime = ApplicationRuntime(settings)
    await first_runtime.startup()
    try:
        async with first_runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(
                name="Recovery",
                slug="runtime-recovery",
            )
        first_upload = await first_runtime.ingestion.upload(
            workspace_id=workspace.id,
            filename="first.md",
            mime_type="text/markdown",
            content=first_content,
        )
    finally:
        await first_runtime.shutdown()

    second_runtime = ApplicationRuntime(settings)
    await second_runtime.startup()
    try:
        duplicate = await second_runtime.ingestion.upload(
            workspace_id=workspace.id,
            filename="duplicate.md",
            mime_type="text/markdown",
            content=first_content,
        )
        assert duplicate.deduplicated
        assert duplicate.document_id == first_upload.document_id

        first_report = await second_runtime.ingestion.ingest(first_upload.document_id)
        restored_report = await second_runtime.ingestion.ingest(first_upload.document_id)
        assert restored_report == first_report

        second_upload = await second_runtime.ingestion.upload(
            workspace_id=workspace.id,
            filename="second.md",
            mime_type="text/markdown",
            content=b"# Dependency\n\nA dependent concept relies on prior knowledge.",
        )
        second_report = await second_runtime.ingestion.ingest(second_upload.document_id)
        assert second_report.graph_revision_id != first_report.graph_revision_id

        async with second_runtime.database.unit_of_work() as unit:
            pending = await unit.graph.persist_delta(
                GraphDelta(
                    workspace_id=workspace.id,
                    base_revision_id=second_report.graph_revision_id,
                )
            )
            await unit.commit()
        pending_revision_id = pending.revision_id
        pending_message_id = pending.outbox_message_id
        refreshed = await second_runtime.ensure_graph_loaded(workspace.id)
        assert refreshed.revision_id == pending_revision_id
    finally:
        await second_runtime.shutdown()

    third_runtime = ApplicationRuntime(settings)
    await third_runtime.startup()
    try:
        recovered = await third_runtime.ingestion.ingest(first_upload.document_id)
        assert recovered == first_report
        snapshot = await third_runtime.ensure_graph_loaded(workspace.id)
        assert snapshot.revision_id == pending_revision_id

        async with third_runtime.database.session() as session:
            revision = await session.get(GraphRevision, pending_revision_id)
            message = await session.get(OutboxMessage, pending_message_id)
        assert revision is not None
        assert revision.projection_status == "PROJECTED"
        assert message is not None
        assert message.status == "PUBLISHED"
    finally:
        await third_runtime.shutdown()
