"""Add auditable graph-model comparison proposals.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "graph_model_proposals",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("workspace_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("document_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("graph_revision_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("model_run_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("proposal", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("rejected_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fallback_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint(
            "status IN ('ACCEPTED', 'REJECTED', 'FALLBACK')",
            name="graph_model_proposal_status",
        ),
        sa.CheckConstraint(
            "rejected_items >= 0",
            name="graph_model_proposal_rejected_items",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["graph_revision_id"], ["graph_revisions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["model_run_id"], ["model_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_graph_model_proposals_workspace_id",
        "graph_model_proposals",
        ["workspace_id"],
    )
    op.create_index(
        "ix_graph_model_proposals_document_id",
        "graph_model_proposals",
        ["document_id"],
    )
    op.create_index(
        "ix_graph_model_proposals_graph_revision_id",
        "graph_model_proposals",
        ["graph_revision_id"],
    )
    op.create_index(
        "ix_graph_model_proposals_model_run_id",
        "graph_model_proposals",
        ["model_run_id"],
    )
    op.create_index(
        "ix_graph_model_proposals_workspace_created",
        "graph_model_proposals",
        ["workspace_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_graph_model_proposals_workspace_created",
        table_name="graph_model_proposals",
    )
    op.drop_index(
        "ix_graph_model_proposals_model_run_id",
        table_name="graph_model_proposals",
    )
    op.drop_index(
        "ix_graph_model_proposals_graph_revision_id",
        table_name="graph_model_proposals",
    )
    op.drop_index(
        "ix_graph_model_proposals_document_id",
        table_name="graph_model_proposals",
    )
    op.drop_index(
        "ix_graph_model_proposals_workspace_id",
        table_name="graph_model_proposals",
    )
    op.drop_table("graph_model_proposals")
