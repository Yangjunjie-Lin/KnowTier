"""Add versioned learner graph revisions and change events.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
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
        "learner_graph_revisions",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("workspace_id", _uuid(), nullable=False),
        sa.Column("learner_id", _uuid(), nullable=False),
        sa.Column("session_id", _uuid(), nullable=False),
        sa.Column("turn_id", _uuid(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("parent_revision_id", _uuid(), nullable=True),
        sa.Column("change_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        _created_at(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["turn_id"], ["turns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["parent_revision_id"], ["learner_graph_revisions.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("learner_id", "sequence_number"),
    )
    op.create_index(
        "ix_learner_graph_revisions_workspace_learner",
        "learner_graph_revisions",
        ["workspace_id", "learner_id"],
    )
    op.create_index(
        "ix_learner_graph_revisions_learner_created",
        "learner_graph_revisions",
        ["learner_id", "created_at"],
    )
    op.create_index(
        "ix_learner_graph_revisions_workspace_id", "learner_graph_revisions", ["workspace_id"]
    )
    op.create_index(
        "ix_learner_graph_revisions_learner_id", "learner_graph_revisions", ["learner_id"]
    )
    op.create_index(
        "ix_learner_graph_revisions_session_id", "learner_graph_revisions", ["session_id"]
    )
    op.create_index("ix_learner_graph_revisions_turn_id", "learner_graph_revisions", ["turn_id"])
    op.create_index(
        "ix_learner_graph_revisions_parent_revision_id",
        "learner_graph_revisions",
        ["parent_revision_id"],
    )

    op.create_table(
        "learner_graph_change_events",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("workspace_id", _uuid(), nullable=False),
        sa.Column("learner_id", _uuid(), nullable=False),
        sa.Column("learner_graph_revision_id", _uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("idempotency_key", sa.String(length=300), nullable=False),
        sa.Column("delta", sa.JSON(), nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["learner_graph_revision_id"],
            ["learner_graph_revisions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("learner_id", "idempotency_key"),
    )
    op.create_index(
        "ix_learner_graph_change_events_workspace_id",
        "learner_graph_change_events",
        ["workspace_id"],
    )
    op.create_index(
        "ix_learner_graph_change_events_learner_id",
        "learner_graph_change_events",
        ["learner_id"],
    )
    op.create_index(
        "ix_learner_graph_events_revision",
        "learner_graph_change_events",
        ["learner_graph_revision_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_learner_graph_events_revision", table_name="learner_graph_change_events")
    op.drop_index(
        "ix_learner_graph_change_events_learner_id", table_name="learner_graph_change_events"
    )
    op.drop_index(
        "ix_learner_graph_change_events_workspace_id", table_name="learner_graph_change_events"
    )
    op.drop_table("learner_graph_change_events")
    op.drop_index(
        "ix_learner_graph_revisions_parent_revision_id", table_name="learner_graph_revisions"
    )
    op.drop_index("ix_learner_graph_revisions_turn_id", table_name="learner_graph_revisions")
    op.drop_index("ix_learner_graph_revisions_session_id", table_name="learner_graph_revisions")
    op.drop_index("ix_learner_graph_revisions_learner_id", table_name="learner_graph_revisions")
    op.drop_index("ix_learner_graph_revisions_workspace_id", table_name="learner_graph_revisions")
    op.drop_index(
        "ix_learner_graph_revisions_learner_created", table_name="learner_graph_revisions"
    )
    op.drop_index(
        "ix_learner_graph_revisions_workspace_learner", table_name="learner_graph_revisions"
    )
    op.drop_table("learner_graph_revisions")
