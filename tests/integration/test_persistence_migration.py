from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


@pytest.mark.integration
def test_initial_alembic_migration_creates_operational_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "migration.db"
    config = Config("alembic.ini")
    migration_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("COGNIGRAPH_DATABASE_URL", migration_url)
    config.set_main_option("sqlalchemy.url", migration_url)
    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert {
        "workspaces",
        "documents",
        "source_spans",
        "learner_knowledge_states",
        "mastery_evidence",
        "graph_revisions",
        "relation_assertions",
        "outbox_messages",
    }.issubset(tables)
