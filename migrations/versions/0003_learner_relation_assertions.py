"""Add first-class learner relation assertions and provenance links.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid() -> sa.Uuid:
    return sa.Uuid(as_uuid=True)


def _created_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )


def upgrade() -> None:
    op.create_table(
        "learner_relation_assertions",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("workspace_id", _uuid(), nullable=False),
        sa.Column("learner_id", _uuid(), nullable=False),
        sa.Column("subject_id", _uuid(), nullable=False),
        sa.Column("predicate", sa.String(length=100), nullable=False),
        sa.Column("object_id", _uuid(), nullable=False),
        sa.Column("natural_language_description", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column(
            "valid_from",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_turn_id", _uuid(), nullable=True),
        sa.Column("mastery_evidence_id", _uuid(), nullable=True),
        sa.Column("learner_graph_revision_id", _uuid(), nullable=False),
        sa.Column("supersedes_assertion_id", _uuid(), nullable=True),
        sa.CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="learner_assertion_confidence_range",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_turn_id"], ["turns.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["mastery_evidence_id"], ["mastery_evidence.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["learner_graph_revision_id"],
            ["learner_graph_revisions.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_assertion_id"],
            ["learner_relation_assertions.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_learner_relation_assertions_workspace_id",
        "learner_relation_assertions",
        ["workspace_id"],
    )
    op.create_index(
        "ix_learner_relation_assertions_learner_id", "learner_relation_assertions", ["learner_id"]
    )
    op.create_index(
        "ix_learner_relation_assertions_subject_id", "learner_relation_assertions", ["subject_id"]
    )
    op.create_index(
        "ix_learner_relation_assertions_object_id", "learner_relation_assertions", ["object_id"]
    )
    op.create_index(
        "ix_learner_assertions_active_lookup",
        "learner_relation_assertions",
        ["learner_id", "predicate", "subject_id", "object_id"],
    )
    op.create_index(
        "ix_learner_assertions_revision",
        "learner_relation_assertions",
        ["learner_graph_revision_id", "created_at"],
    )
    op.create_index(
        "ix_learner_relation_assertions_source_turn_id",
        "learner_relation_assertions",
        ["source_turn_id"],
    )
    op.create_index(
        "ix_learner_relation_assertions_mastery_evidence_id",
        "learner_relation_assertions",
        ["mastery_evidence_id"],
    )
    op.create_index(
        "ix_learner_relation_assertions_learner_graph_revision_id",
        "learner_relation_assertions",
        ["learner_graph_revision_id"],
    )
    op.create_index(
        "ix_learner_relation_assertions_supersedes_assertion_id",
        "learner_relation_assertions",
        ["supersedes_assertion_id"],
    )
    op.create_table(
        "learner_relation_assertion_sources",
        sa.Column("assertion_id", _uuid(), nullable=False),
        sa.Column("source_span_id", _uuid(), nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["assertion_id"], ["learner_relation_assertions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["source_span_id"], ["source_spans.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("assertion_id", "source_span_id"),
    )


def downgrade() -> None:
    op.drop_table("learner_relation_assertion_sources")
    op.drop_index(
        "ix_learner_relation_assertions_supersedes_assertion_id",
        table_name="learner_relation_assertions",
    )
    op.drop_index(
        "ix_learner_relation_assertions_learner_graph_revision_id",
        table_name="learner_relation_assertions",
    )
    op.drop_index(
        "ix_learner_relation_assertions_mastery_evidence_id",
        table_name="learner_relation_assertions",
    )
    op.drop_index(
        "ix_learner_relation_assertions_source_turn_id", table_name="learner_relation_assertions"
    )
    op.drop_index("ix_learner_assertions_revision", table_name="learner_relation_assertions")
    op.drop_index("ix_learner_assertions_active_lookup", table_name="learner_relation_assertions")
    op.drop_index(
        "ix_learner_relation_assertions_object_id", table_name="learner_relation_assertions"
    )
    op.drop_index(
        "ix_learner_relation_assertions_subject_id", table_name="learner_relation_assertions"
    )
    op.drop_index(
        "ix_learner_relation_assertions_learner_id", table_name="learner_relation_assertions"
    )
    op.drop_index(
        "ix_learner_relation_assertions_workspace_id", table_name="learner_relation_assertions"
    )
    op.drop_table("learner_relation_assertions")
