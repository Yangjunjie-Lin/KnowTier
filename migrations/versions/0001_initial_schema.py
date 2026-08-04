"""Create the initial Cognigraph operational and graph audit schema.

Revision ID: 0001
Revises:
Create Date: 2026-08-03
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

from cognigraph.persistence.postgres import models as persistence_models  # noqa: F401
from cognigraph.persistence.postgres.base import Base

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
