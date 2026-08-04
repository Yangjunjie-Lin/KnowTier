from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cognigraph.persistence.postgres.base import (
    Base,
    EmbeddingVector,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    utc_now,
)


class Workspace(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    default_language: Mapped[str] = mapped_column(String(16), default="zh-CN", nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Learner(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "learners"
    __table_args__ = (UniqueConstraint("workspace_id", "external_id"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    external_id: Mapped[str | None] = mapped_column(String(200))
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    language: Mapped[str] = mapped_column(String(16), default="zh-CN", nullable=False)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class TutoringSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sessions"

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), index=True, nullable=False
    )
    requested_mode: Mapped[str] = mapped_column(String(32), default="learn", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE", nullable=False)
    goal: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    current_knowledge_point_id: Mapped[UUID | None] = mapped_column()
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ConversationTurn(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "turns"
    __table_args__ = (UniqueConstraint("session_id", "sequence_number"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), index=True, nullable=False
    )
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    target_knowledge_point_id: Mapped[UUID | None] = mapped_column(index=True)
    cognitive_level: Mapped[int | None] = mapped_column(Integer)
    teaching_action: Mapped[str | None] = mapped_column(String(64))
    assessment: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    context_revision_id: Mapped[UUID | None] = mapped_column(index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class Document(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("workspace_id", "sha256"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    safe_storage_name: Mapped[str] = mapped_column(String(500), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(200), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    language: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(32), default="UPLOADED", nullable=False)
    parser_name: Mapped[str | None] = mapped_column(String(100))
    parser_version: Mapped[str | None] = mapped_column(String(100))
    page_count: Mapped[int | None] = mapped_column(Integer)
    parser_output: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ingestion_report: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(100))
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    chunks: Mapped[list[DocumentChunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan", lazy="raise"
    )


class DocumentChunk(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "document_chunks"
    __table_args__ = (UniqueConstraint("document_id", "ordinal"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    heading_path: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    bounding_box: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingVector(1536))
    embedding_model: Mapped[str | None] = mapped_column(String(200))

    document: Mapped[Document] = relationship(back_populates="chunks", lazy="raise")


class SourceSpan(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "source_spans"
    __table_args__ = (
        UniqueConstraint("document_id", "content_hash", "start_offset", "end_offset"),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    chunk_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("document_chunks.id", ondelete="SET NULL"), index=True
    )
    page_number: Mapped[int | None] = mapped_column(Integer)
    heading_path: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False)
    start_offset: Mapped[int | None] = mapped_column(Integer)
    end_offset: Mapped[int | None] = mapped_column(Integer)
    bounding_box: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    parser_name: Mapped[str] = mapped_column(String(100), nullable=False)
    parser_version: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class LearnerKnowledgeState(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "learner_knowledge_states"
    __table_args__ = (
        UniqueConstraint("learner_id", "knowledge_point_id"),
        CheckConstraint("current_level >= 1 AND current_level <= 6", name="valid_level"),
        CheckConstraint("mastery_score >= 0 AND mastery_score <= 1", name="valid_mastery"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="valid_confidence"),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), index=True, nullable=False
    )
    knowledge_point_id: Mapped[UUID] = mapped_column(index=True, nullable=False)
    current_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    mastery_score: Mapped[float] = mapped_column(default=0.0, nullable=False)
    confidence: Mapped[float] = mapped_column(default=0.0, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    independent_success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reasoning_success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    transfer_success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    critical_misconceptions: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    machine_reason: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    last_interaction_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class MasteryEvidence(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "mastery_evidence"
    __table_args__ = (
        CheckConstraint("cognitive_level >= 1 AND cognitive_level <= 6", name="valid_level"),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    learner_id: Mapped[UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), index=True, nullable=False
    )
    knowledge_point_id: Mapped[UUID] = mapped_column(index=True, nullable=False)
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    turn_id: Mapped[UUID] = mapped_column(
        ForeignKey("turns.id", ondelete="CASCADE"), index=True, nullable=False
    )
    evidence_type: Mapped[str] = mapped_column(String(64), nullable=False)
    cognitive_level: Mapped[int] = mapped_column(Integer, nullable=False)
    correctness_score: Mapped[float] = mapped_column(nullable=False)
    reasoning_score: Mapped[float] = mapped_column(nullable=False)
    independence_score: Mapped[float] = mapped_column(nullable=False)
    transfer_score: Mapped[float] = mapped_column(nullable=False)
    grader_confidence: Mapped[float] = mapped_column(nullable=False)
    observed_misconceptions: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    raw_answer: Mapped[str] = mapped_column(Text, nullable=False)
    grader_explanation: Mapped[str] = mapped_column(Text, nullable=False)
    model_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("model_runs.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class ModelConfig(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "model_configs"
    __table_args__ = (UniqueConstraint("workspace_id", "role"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    fallback_models: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    timeout_seconds: Mapped[float] = mapped_column(default=30.0, nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ModelRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "model_runs"

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_hash: Mapped[str | None] = mapped_column(String(64))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    estimated_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 8), default=Decimal("0"), nullable=False
    )
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_type: Mapped[str | None] = mapped_column(String(200))
    request_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class PromptVersion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (
        UniqueConstraint("workspace_id", "prompt_name", "version"),
        Index(
            "uq_prompt_active_workspace_name",
            "workspace_id",
            "prompt_name",
            unique=True,
            postgresql_where=text("active = true"),
            sqlite_where=text("active = 1"),
        ),
    )

    workspace_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    prompt_name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class GraphRevision(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "graph_revisions"
    __table_args__ = (UniqueConstraint("workspace_id", "sequence_number"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_revision_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="PENDING", nullable=False)
    projection_status: Mapped[str] = mapped_column(String(32), default="PENDING", nullable=False)
    manifest: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), default="system", nullable=False)
    model_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("model_runs.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    projected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GraphChangeEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "graph_change_events"
    __table_args__ = (UniqueConstraint("workspace_id", "idempotency_key"),)

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    revision_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(100), default="GRAPH_DELTA", nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    delta: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class OutboxMessage(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "outbox_messages"
    __table_args__ = (
        UniqueConstraint("workspace_id", "idempotency_key"),
        Index("ix_outbox_dispatch", "status", "available_at", "created_at"),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    aggregate_type: Mapped[str] = mapped_column(String(100), nullable=False)
    aggregate_id: Mapped[UUID] = mapped_column(index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class GraphNodeRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "graph_nodes"
    __table_args__ = (
        UniqueConstraint("workspace_id", "canonical_key"),
        Index("ix_graph_nodes_workspace_type", "workspace_id", "entity_type"),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    canonical_key: Mapped[str] = mapped_column(String(500), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(500), nullable=False)
    properties: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    epistemic_status: Mapped[str] = mapped_column(String(32), default="UNVERIFIED", nullable=False)
    source_confidence: Mapped[float] = mapped_column(default=0.0, nullable=False)
    graph_revision_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class RelationAssertionRecord(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "relation_assertions"
    __table_args__ = (
        UniqueConstraint("workspace_id", "idempotency_key"),
        Index(
            "ix_assertions_subject_predicate_object",
            "workspace_id",
            "subject_id",
            "predicate_key",
            "object_id",
        ),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    subject_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_nodes.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    relation_type_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("graph_nodes.id", ondelete="RESTRICT"), index=True
    )
    predicate_key: Mapped[str] = mapped_column(String(100), nullable=False)
    object_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_nodes.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    natural_language_description: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(nullable=False)
    epistemic_status: Mapped[str] = mapped_column(String(32), nullable=False)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(100), default="system", nullable=False)
    model_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("model_runs.id", ondelete="SET NULL"), index=True
    )
    graph_revision_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    supersedes_assertion_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("relation_assertions.id", ondelete="RESTRICT"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(300), nullable=False)


class GraphNodeSource(Base):
    __tablename__ = "graph_node_sources"

    node_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_nodes.id", ondelete="CASCADE"), primary_key=True
    )
    source_span_id: Mapped[UUID] = mapped_column(
        ForeignKey("source_spans.id", ondelete="RESTRICT"), primary_key=True
    )
    model_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("model_runs.id", ondelete="SET NULL"), index=True
    )
    graph_revision_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class AssertionSource(Base):
    __tablename__ = "assertion_sources"

    assertion_id: Mapped[UUID] = mapped_column(
        ForeignKey("relation_assertions.id", ondelete="CASCADE"), primary_key=True
    )
    source_span_id: Mapped[UUID] = mapped_column(
        ForeignKey("source_spans.id", ondelete="RESTRICT"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class GraphConflict(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "graph_conflicts"

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    revision_id: Mapped[UUID] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    conflict_type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="OPEN", nullable=False)
    subject_id: Mapped[UUID | None] = mapped_column(index=True)
    predicate_key: Mapped[str | None] = mapped_column(String(100))
    assertion_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ToolCallAudit(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "tool_call_audits"

    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    learner_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), index=True
    )
    session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="SET NULL"), index=True
    )
    model_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("model_runs.id", ondelete="SET NULL"), index=True
    )
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    graph_revision_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("graph_revisions.id", ondelete="SET NULL"), index=True
    )
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class AuditEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_events"

    workspace_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), index=True
    )
    actor_type: Mapped[str] = mapped_column(String(50), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(200))
    request_id: Mapped[str | None] = mapped_column(String(100), index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class StoredBlob(UUIDPrimaryKeyMixin, Base):
    """Optional database-backed small fixture/document storage; production uses object paths."""

    __tablename__ = "stored_blobs"

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
