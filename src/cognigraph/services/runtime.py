from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from contextlib import suppress
from uuid import UUID

from sqlalchemy import select

from cognigraph.config import Settings, get_settings
from cognigraph.domain.documents import SourceSpan
from cognigraph.domain.enums import EpistemicStatus, NodeType, RelationTypeKey
from cognigraph.domain.graph import RelationAssertion
from cognigraph.extraction.knowledge_extractor import KnowledgeExtractor
from cognigraph.graph.applier import (
    GraphNode,
    GraphSnapshot,
    InMemoryGraphApplier,
)
from cognigraph.graph.exporters import GraphExporter
from cognigraph.graph.manifest import GraphManifestService
from cognigraph.graph.query_tools import (
    AsyncControlledGraphQueryTools,
    BufferedToolAuditSink,
    ControlledGraphQueryTools,
    ToolCallRecord,
)
from cognigraph.ingestion.chunking import HierarchicalChunker
from cognigraph.ingestion.docling_adapter import DocumentParser
from cognigraph.ingestion.service import IngestionService, InMemoryDocumentRegistry
from cognigraph.llm.embedding import (
    DeterministicEmbeddingProvider,
    LiteLLMEmbeddingProvider,
)
from cognigraph.llm.fake_provider import FakeProvider
from cognigraph.llm.gateway import LiteLLMProvider, ModelGateway
from cognigraph.persistence.neo4j import (
    GraphRepository,
    InMemoryGraphRepository,
    Neo4jGraphRepository,
)
from cognigraph.persistence.outbox import OutboxDispatcher
from cognigraph.persistence.postgres.database import Database
from cognigraph.persistence.postgres.models import (
    AssertionSource,
    GraphChangeEvent,
    GraphNodeRecord,
    GraphNodeSource,
    GraphRevision,
    Learner,
    ModelRun,
    RelationAssertionRecord,
    ToolCallAudit,
    TutoringSession,
    Workspace,
)
from cognigraph.persistence.postgres.models import SourceSpan as SourceSpanRecord
from cognigraph.prompts import PromptManager
from cognigraph.services.persistence_adapters import (
    SqlDocumentRecordSink,
    SqlGraphDeltaRecorder,
    SqlModelRunSink,
)

logger = logging.getLogger(__name__)


class ApplicationRuntime:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.database = Database(self.settings.database_url)
        self.graph_applier = InMemoryGraphApplier()
        self.manifest_service = GraphManifestService()
        self.tool_audit_sink = BufferedToolAuditSink()
        self.graph_queries = ControlledGraphQueryTools(
            self.graph_applier.store,
            audit_sink=self.tool_audit_sink,
            manifest_service=self.manifest_service,
        )
        self.graph_exporter = GraphExporter()
        self.semantic_graph = self._semantic_repository()
        self.semantic_queries = AsyncControlledGraphQueryTools(
            self.semantic_graph,
            audit_sink=self.tool_audit_sink,
        )
        self.outbox_dispatcher = OutboxDispatcher(
            self.database.session_factory,
            self.semantic_graph,
        )
        provider = (
            FakeProvider() if self.settings.use_mock_llm else LiteLLMProvider(self.settings.api_key)
        )
        self.model_gateway = ModelGateway(
            self.settings,
            provider,
            sink=SqlModelRunSink(self.database),
        )
        embedding_provider = (
            DeterministicEmbeddingProvider(dimensions=1536)
            if self.settings.use_mock_llm
            else LiteLLMEmbeddingProvider(
                self.settings.embedding_model,
                fallbacks=self.settings.fallback_models,
                timeout_seconds=self.settings.llm_timeout_seconds,
                max_retries=self.settings.llm_max_retries,
                max_concurrency=self.settings.llm_max_concurrency,
                api_key=self.settings.api_key,
            )
        )
        self.document_sink = SqlDocumentRecordSink(self.database)
        self.document_registry = InMemoryDocumentRegistry(loader=self.document_sink)
        self.ingestion = IngestionService(
            settings=self.settings,
            registry=self.document_registry,
            parser=DocumentParser(),
            chunker=HierarchicalChunker(),
            embedding_provider=embedding_provider,
            extractor=KnowledgeExtractor(self.model_gateway),
            graph_applier=self.graph_applier,
            delta_recorder=SqlGraphDeltaRecorder(
                self.database,
                self.outbox_dispatcher,
                batch_size=self.settings.outbox_batch_size,
            ),
            document_sink=self.document_sink,
            graph_snapshot_loader=self.ensure_graph_loaded,
        )
        self.prompts = PromptManager()
        self._graph_load_locks: dict[UUID, asyncio.Lock] = {}
        self._outbox_stop = asyncio.Event()
        self._outbox_task: asyncio.Task[None] | None = None
        self._tool_audit_stop = asyncio.Event()
        self._tool_audit_task: asyncio.Task[None] | None = None
        self._tool_audit_flush_lock = asyncio.Lock()

    def _semantic_repository(self) -> GraphRepository:
        if not self.settings.neo4j_required:
            return InMemoryGraphRepository()
        return Neo4jGraphRepository.from_uri(
            self.settings.neo4j_uri,
            self.settings.neo4j_user,
            self.settings.neo4j_password.get_secret_value(),
        )

    async def startup(self) -> None:
        if self.database.url.startswith("sqlite"):
            await self.database.create_schema()
        await self.semantic_graph.create_schema()
        await self._rehydrate_in_memory_semantic_graph()
        await self.outbox_dispatcher.dispatch_once(batch_size=self.settings.outbox_batch_size)
        async with self.database.unit_of_work() as unit:
            for prompt in self.prompts.load_all():
                await unit.prompts.register(
                    prompt_name=prompt.name,
                    version=prompt.version,
                    content=prompt.content,
                    activate=True,
                )
            await unit.commit()
        if self.settings.outbox_worker_enabled:
            self._outbox_stop.clear()
            self._outbox_task = asyncio.create_task(
                self._run_outbox_worker(),
                name="cognigraph-outbox-dispatcher",
            )
        self._tool_audit_stop.clear()
        self._tool_audit_task = asyncio.create_task(
            self._run_tool_audit_worker(),
            name="cognigraph-tool-audit-writer",
        )

    async def shutdown(self) -> None:
        self._outbox_stop.set()
        if self._outbox_task is not None:
            with suppress(asyncio.CancelledError):
                await self._outbox_task
            self._outbox_task = None
        self._tool_audit_stop.set()
        if self._tool_audit_task is not None:
            with suppress(asyncio.CancelledError):
                await self._tool_audit_task
            self._tool_audit_task = None
        try:
            await self.flush_tool_audits()
        finally:
            await self.semantic_graph.close()
            await self.database.dispose()

    async def _run_outbox_worker(self) -> None:
        while not self._outbox_stop.is_set():
            try:
                await self.outbox_dispatcher.dispatch_once(
                    batch_size=self.settings.outbox_batch_size
                )
            except Exception as exc:
                logger.error(
                    "outbox dispatch iteration failed",
                    extra={"error_type": type(exc).__name__},
                )
            try:
                await asyncio.wait_for(
                    self._outbox_stop.wait(),
                    timeout=self.settings.outbox_poll_interval_seconds,
                )
            except TimeoutError:
                continue

    async def _run_tool_audit_worker(self) -> None:
        while not self._tool_audit_stop.is_set():
            try:
                await self.flush_tool_audits()
            except Exception as exc:
                logger.error(
                    "tool audit persistence iteration failed",
                    extra={"error_type": type(exc).__name__},
                )
            try:
                await asyncio.wait_for(self._tool_audit_stop.wait(), timeout=0.1)
            except TimeoutError:
                continue

    async def flush_tool_audits(self) -> int:
        """Drain buffered fixed-schema query audits into the SQL system of record."""

        persisted = 0
        async with self._tool_audit_flush_lock:
            while self.tool_audit_sink.pending_count:
                batch = self.tool_audit_sink.drain(limit=self.settings.outbox_batch_size)
                try:
                    (
                        valid_learners,
                        valid_sessions,
                        valid_model_runs,
                        valid_revisions,
                    ) = await self._valid_tool_audit_references(batch)
                    rows = [
                        ToolCallAudit(
                            id=record.id,
                            workspace_id=record.workspace_id,
                            learner_id=(
                                record.learner_id if record.learner_id in valid_learners else None
                            ),
                            session_id=(
                                record.session_id if record.session_id in valid_sessions else None
                            ),
                            model_run_id=(
                                record.model_run_id
                                if record.model_run_id in valid_model_runs
                                else None
                            ),
                            tool_name=record.tool_name,
                            arguments=record.parameters,
                            result_count=record.result_count,
                            graph_revision_id=(
                                record.graph_revision_id
                                if record.graph_revision_id in valid_revisions
                                else None
                            ),
                            latency_ms=record.latency_ms,
                            status=record.status,
                            created_at=record.created_at,
                        )
                        for record in batch
                    ]
                    async with self.database.unit_of_work() as unit:
                        inserted = await unit.audit.record_tool_calls(rows)
                        await unit.commit()
                except Exception:
                    self.tool_audit_sink.requeue_front(batch)
                    raise
                persisted += len(inserted)
        return persisted

    async def _valid_tool_audit_references(
        self, batch: list[ToolCallRecord]
    ) -> tuple[set[UUID], set[UUID], set[UUID], set[UUID]]:
        learner_ids = {record.learner_id for record in batch if record.learner_id is not None}
        session_ids = {record.session_id for record in batch if record.session_id is not None}
        model_run_ids = {record.model_run_id for record in batch if record.model_run_id is not None}
        revision_ids = {
            record.graph_revision_id for record in batch if record.graph_revision_id is not None
        }
        async with self.database.session() as session:
            valid_learners = set(
                (await session.scalars(select(Learner.id).where(Learner.id.in_(learner_ids)))).all()
            )
            valid_sessions = set(
                (
                    await session.scalars(
                        select(TutoringSession.id).where(TutoringSession.id.in_(session_ids))
                    )
                ).all()
            )
            valid_model_runs = set(
                (
                    await session.scalars(select(ModelRun.id).where(ModelRun.id.in_(model_run_ids)))
                ).all()
            )
            valid_revisions = set(
                (
                    await session.scalars(
                        select(GraphRevision.id).where(GraphRevision.id.in_(revision_ids))
                    )
                ).all()
            )
        return valid_learners, valid_sessions, valid_model_runs, valid_revisions

    async def _rehydrate_in_memory_semantic_graph(self) -> None:
        if not isinstance(self.semantic_graph, InMemoryGraphRepository):
            return
        async with self.database.session() as session:
            events = list(
                (
                    await session.scalars(
                        select(GraphChangeEvent)
                        .join(GraphRevision, GraphRevision.id == GraphChangeEvent.revision_id)
                        .where(GraphRevision.projection_status == "PROJECTED")
                        .order_by(
                            GraphRevision.workspace_id,
                            GraphRevision.sequence_number,
                        )
                    )
                ).all()
            )
        for event in events:
            await self.semantic_graph.apply_delta(dict(event.delta))

    async def readiness(self) -> dict[str, bool]:
        postgres_ready = await self.database.ping()
        neo4j_ready = await self.semantic_graph.is_ready()
        return {
            "postgres": postgres_ready,
            "neo4j": neo4j_ready,
            "ready": postgres_ready and neo4j_ready,
        }

    async def ensure_graph_loaded(
        self,
        workspace_id: UUID,
        *,
        force: bool = False,
    ) -> GraphSnapshot:
        latest_revision_id = await self._latest_graph_revision_id(workspace_id)
        current = self.graph_applier.store.get_snapshot(workspace_id)
        if not force and current.revision_id == latest_revision_id:
            return current
        lock = self._graph_load_locks.setdefault(workspace_id, asyncio.Lock())
        async with lock:
            latest_revision_id = await self._latest_graph_revision_id(workspace_id)
            current = self.graph_applier.store.get_snapshot(workspace_id)
            if not force and current.revision_id == latest_revision_id:
                return current
            snapshot = await self._load_graph_snapshot(workspace_id)
            latest_after_load = await self._latest_graph_revision_id(workspace_id)
            if snapshot.revision_id != latest_after_load:
                snapshot = await self._load_graph_snapshot(workspace_id)
            current = self.graph_applier.store.get_snapshot(workspace_id)
            if current.revision_sequence > snapshot.revision_sequence:
                return current
            self.graph_applier.store.set_snapshot(snapshot)
            return snapshot

    async def _latest_graph_revision_id(self, workspace_id: UUID) -> UUID | None:
        async with self.database.session() as session:
            workspace = await session.get(Workspace, workspace_id)
            if workspace is None:
                raise LookupError(f"workspace {workspace_id} does not exist")
            latest_id = await session.scalar(
                select(GraphRevision.id)
                .where(GraphRevision.workspace_id == workspace_id)
                .order_by(GraphRevision.sequence_number.desc())
                .limit(1)
            )
            return UUID(str(latest_id)) if latest_id is not None else None

    async def _load_graph_snapshot(self, workspace_id: UUID) -> GraphSnapshot:
        async with self.database.session() as session:
            revision = await session.scalar(
                select(GraphRevision)
                .where(GraphRevision.workspace_id == workspace_id)
                .order_by(GraphRevision.sequence_number.desc())
                .limit(1)
            )
            node_records = list(
                (
                    await session.scalars(
                        select(GraphNodeRecord).where(
                            GraphNodeRecord.workspace_id == workspace_id,
                            GraphNodeRecord.is_active.is_(True),
                        )
                    )
                ).all()
            )
            assertion_records = list(
                (
                    await session.scalars(
                        select(RelationAssertionRecord).where(
                            RelationAssertionRecord.workspace_id == workspace_id
                        )
                    )
                ).all()
            )
            node_sources: dict[UUID, list[UUID]] = defaultdict(list)
            node_model_runs: dict[UUID, UUID] = {}
            assertion_sources: dict[UUID, list[UUID]] = defaultdict(list)
            if node_records:
                node_links = list(
                    (
                        await session.scalars(
                            select(GraphNodeSource).where(
                                GraphNodeSource.node_id.in_([item.id for item in node_records])
                            )
                        )
                    ).all()
                )
                for node_link in node_links:
                    node_sources[node_link.node_id].append(node_link.source_span_id)
                    if node_link.model_run_id is not None:
                        node_model_runs.setdefault(node_link.node_id, node_link.model_run_id)
            if assertion_records:
                assertion_links = list(
                    (
                        await session.scalars(
                            select(AssertionSource).where(
                                AssertionSource.assertion_id.in_(
                                    [item.id for item in assertion_records]
                                )
                            )
                        )
                    ).all()
                )
                for assertion_link in assertion_links:
                    assertion_sources[assertion_link.assertion_id].append(
                        assertion_link.source_span_id
                    )
            graph_span_ids = {item.id for item in node_records if item.entity_type == "SourceSpan"}
            graph_span_ids.update(
                source_id for source_ids in node_sources.values() for source_id in source_ids
            )
            graph_span_ids.update(
                source_id for source_ids in assertion_sources.values() for source_id in source_ids
            )
            span_records = (
                list(
                    (
                        await session.scalars(
                            select(SourceSpanRecord).where(
                                SourceSpanRecord.workspace_id == workspace_id,
                                SourceSpanRecord.id.in_(graph_span_ids),
                            )
                        )
                    ).all()
                )
                if graph_span_ids
                else []
            )

        nodes = [
            GraphNode(
                id=item.id,
                workspace_id=item.workspace_id,
                node_type=NodeType(item.entity_type),
                properties=item.properties,
                epistemic_status=EpistemicStatus(item.epistemic_status),
                source_confidence=item.source_confidence,
                source_span_ids=node_sources[item.id],
                created_by=str(item.properties.get("created_by") or "system"),
                model_run_id=node_model_runs.get(item.id)
                or _optional_property_uuid(item.properties.get("model_run_id")),
                graph_revision_id=item.graph_revision_id,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
            for item in node_records
        ]
        assertions = [
            RelationAssertion(
                id=item.id,
                workspace_id=item.workspace_id,
                subject_id=item.subject_id,
                relation_type_id=item.relation_type_id,
                predicate_key=RelationTypeKey(item.predicate_key),
                object_id=item.object_id,
                natural_language_description=item.natural_language_description,
                confidence=item.confidence,
                epistemic_status=EpistemicStatus(item.epistemic_status),
                valid_from=item.valid_from,
                valid_to=item.valid_to,
                created_at=item.created_at,
                superseded_at=item.superseded_at,
                created_by=item.created_by,
                source_span_ids=assertion_sources[item.id],
                model_run_id=item.model_run_id,
                graph_revision_id=item.graph_revision_id,
                supersedes_assertion_id=item.supersedes_assertion_id,
            )
            for item in assertion_records
        ]
        spans = [self._domain_span(item) for item in span_records]
        return GraphSnapshot(
            workspace_id=workspace_id,
            revision_id=revision.id if revision else None,
            revision_sequence=revision.sequence_number if revision else 0,
            nodes=nodes,
            assertions=assertions,
            source_spans=spans,
        )

    @staticmethod
    def _domain_span(item: SourceSpanRecord) -> SourceSpan:
        return SourceSpan.model_validate(
            {
                "id": item.id,
                "document_id": item.document_id,
                "page_number": item.page_number,
                "heading_path": item.heading_path,
                "text": item.text,
                "normalized_text": item.normalized_text,
                "start_offset": item.start_offset or 0,
                "end_offset": item.end_offset or max(len(item.text), 1),
                "bounding_box": item.bounding_box,
                "content_hash": item.content_hash,
                "parser_name": item.parser_name,
                "parser_version": item.parser_version,
                "created_at": item.created_at,
            }
        )


def _optional_property_uuid(value: object) -> UUID | None:
    if value in (None, ""):
        return None
    try:
        return UUID(str(value))
    except ValueError:
        return None
