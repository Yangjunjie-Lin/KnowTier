"""Mark internal synthetic documents so user material lists remain clean.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-16
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    context = op.get_context()
    if context.as_sql:
        # The historical 0001 migration builds several baseline tables from
        # current metadata. IF NOT EXISTS keeps an offline PostgreSQL script
        # valid both for a fresh baseline and for a real pre-0006 database.
        op.execute(
            "ALTER TABLE documents ADD COLUMN IF NOT EXISTS origin "
            "VARCHAR(32) DEFAULT 'USER_UPLOAD' NOT NULL"
        )
    else:
        bind = op.get_bind()
        columns = {column["name"] for column in sa.inspect(bind).get_columns("documents")}
        if "origin" not in columns:
            op.add_column(
                "documents",
                sa.Column(
                    "origin",
                    sa.String(length=32),
                    nullable=False,
                    server_default=sa.text("'USER_UPLOAD'"),
                ),
            )
    # This was the sole internal filename before origin metadata existed.
    # Backfilling it once makes legacy synthetic records auditable thereafter.
    op.execute(
        sa.text("UPDATE documents SET origin = 'INTERNAL_CHAT' WHERE filename = 'chat-input.txt'")
    )
    op.create_index(
        "ix_documents_workspace_origin_created",
        "documents",
        ["workspace_id", "origin", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_documents_workspace_origin_created", table_name="documents")
    if op.get_context().as_sql:
        op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS origin")
    else:
        bind = op.get_bind()
        columns = {column["name"] for column in sa.inspect(bind).get_columns("documents")}
        if "origin" in columns:
            op.drop_column("documents", "origin")
