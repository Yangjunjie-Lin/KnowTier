"""Create the initial Cognigraph operational and graph audit schema.

Revision ID: 0001
Revises:
Create Date: 2026-08-03

This migration is intentionally historical. Tables introduced after the baseline
are created by explicit migrations 0002 through 0005.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from cognigraph.persistence.postgres import models as persistence_models  # noqa: F401
from cognigraph.persistence.postgres.base import Base

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INITIAL_TABLE_NAMES = (
    "workspaces",
    "learners",
    "sessions",
    "turns",
    "documents",
    "document_chunks",
    "source_spans",
    "learner_knowledge_states",
    "mastery_evidence",
    "model_configs",
    "model_runs",
    "prompt_versions",
    "graph_revisions",
    "graph_change_events",
    "outbox_messages",
    "graph_nodes",
    "relation_assertions",
    "graph_node_sources",
    "assertion_sources",
    "graph_conflicts",
    "tool_call_audits",
    "audit_events",
    "stored_blobs",
)


def _legacy_model_runs() -> None:
    """Create the baseline ModelRun contract without post-0001 FKs."""

    op.create_table(
        "model_runs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("workspace_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("prompt_version", sa.String(length=100), nullable=False),
        sa.Column("prompt_hash", sa.String(length=64), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "estimated_cost",
            sa.Numeric(18, 8),
            nullable=False,
            server_default="0",
        ),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_type", sa.String(length=200), nullable=True),
        sa.Column("request_metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_model_runs_workspace_id", "model_runs", ["workspace_id"])


def _legacy_tool_call_audits() -> None:
    """Create the baseline tool audit contract; 0004 adds bounded fields."""

    op.create_table(
        "tool_call_audits",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("workspace_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("learner_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("session_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("model_run_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column("arguments", sa.JSON(), nullable=False),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("graph_revision_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["model_run_id"], ["model_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["graph_revision_id"], ["graph_revisions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("workspace_id", "learner_id", "session_id", "model_run_id", "graph_revision_id"):
        op.create_index(f"ix_tool_call_audits_{column}", "tool_call_audits", [column])


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # PostgreSQL requires a foreign-key target to exist before the referencing
    # table is created.  Create the root tenant table first, then the historical
    # ModelRun contract before GraphRevision (which references ModelRun).
    Base.metadata.tables["workspaces"].create(bind=bind, checkfirst=True)
    _legacy_model_runs()
    tables = [
        Base.metadata.tables[name]
        for name in _INITIAL_TABLE_NAMES
        if name not in {"workspaces", "model_runs", "tool_call_audits"}
    ]
    Base.metadata.create_all(bind=bind, tables=tables, checkfirst=True)
    _legacy_tool_call_audits()


def downgrade() -> None:
    # Use the fixed historical dependency order. Current ORM metadata contains
    # post-0001 foreign keys that 0004 has already removed and therefore cannot
    # safely be used to generate a baseline PostgreSQL downgrade.
    for table_name in (
        "tool_call_audits",
        "graph_conflicts",
        "graph_node_sources",
        "assertion_sources",
        "relation_assertions",
        "graph_nodes",
        "graph_change_events",
        "outbox_messages",
        "graph_revisions",
        "mastery_evidence",
        "learner_knowledge_states",
        "source_spans",
        "document_chunks",
        "stored_blobs",
        "documents",
        "turns",
        "sessions",
        "model_runs",
        "model_configs",
        "prompt_versions",
        "audit_events",
        "learners",
        "workspaces",
    ):
        op.drop_table(table_name)
