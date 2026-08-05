"""Add explicit model and tool-call audit context.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MODEL_RUN_FOREIGN_KEYS = (
    ("learner_id", "learners"),
    ("session_id", "sessions"),
    ("turn_id", "turns"),
    ("document_id", "documents"),
    ("graph_revision_id", "graph_revisions"),
    ("learner_graph_revision_id", "learner_graph_revisions"),
)


def _dialect_name() -> str:
    """Return the configured dialect in online and ``--sql`` modes."""

    return op.get_context().dialect.name


def upgrade() -> None:
    for column_name in (
        "learner_id",
        "session_id",
        "turn_id",
        "document_id",
        "graph_revision_id",
        "learner_graph_revision_id",
    ):
        op.add_column(
            "model_runs",
            sa.Column(column_name, sa.Uuid(as_uuid=True), nullable=True),
        )
    op.add_column(
        "model_runs",
        sa.Column("tool_step_count", sa.Integer(), nullable=False, server_default="0"),
    )

    for column_name, target_table in _MODEL_RUN_FOREIGN_KEYS:
        op.create_index(f"ix_model_runs_{column_name}", "model_runs", [column_name])
        # SQLite cannot add a foreign key to an existing table without a full
        # rewrite. Production PostgreSQL receives every explicit constraint.
        if _dialect_name() != "sqlite":
            op.create_foreign_key(
                f"fk_model_runs_{column_name}",
                "model_runs",
                target_table,
                [column_name],
                ["id"],
                ondelete="SET NULL",
            )

    op.add_column(
        "tool_call_audits",
        sa.Column(
            "sanitized_arguments",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.add_column(
        "tool_call_audits",
        sa.Column("result_bytes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "tool_call_audits",
        sa.Column("truncated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "tool_call_audits",
        sa.Column("tool_step", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_tool_call_audits_model_run_step",
        "tool_call_audits",
        ["model_run_id", "tool_step"],
    )


def downgrade() -> None:
    op.drop_index("ix_tool_call_audits_model_run_step", table_name="tool_call_audits")
    for column_name in ("tool_step", "truncated", "result_bytes", "sanitized_arguments"):
        op.drop_column("tool_call_audits", column_name)

    for column_name, _target_table in reversed(_MODEL_RUN_FOREIGN_KEYS):
        if _dialect_name() != "sqlite":
            op.drop_constraint(
                f"fk_model_runs_{column_name}",
                "model_runs",
                type_="foreignkey",
            )
        op.drop_index(f"ix_model_runs_{column_name}", table_name="model_runs")
        op.drop_column("model_runs", column_name)
    op.drop_column("model_runs", "tool_step_count")
