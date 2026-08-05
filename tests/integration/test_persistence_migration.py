from __future__ import annotations

from io import StringIO
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
        "learner_graph_revisions",
        "learner_graph_change_events",
        "learner_relation_assertions",
        "learner_relation_assertion_sources",
        "mastery_evidence",
        "graph_revisions",
        "relation_assertions",
        "outbox_messages",
    }.issubset(tables)


@pytest.mark.integration
def test_learner_graph_migration_downgrades_to_initial_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "migration-downgrade.db"
    config = Config("alembic.ini")
    migration_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("COGNIGRAPH_DATABASE_URL", migration_url)
    config.set_main_option("sqlalchemy.url", migration_url)
    command.upgrade(config, "0002")
    command.downgrade(config, "0001")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert "learner_knowledge_states" in tables
    assert "learner_graph_revisions" not in tables
    assert "learner_relation_assertions" not in tables


@pytest.mark.integration
def test_full_migration_chain_downgrades_and_reupgrades(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "migration-cycle.db"
    config = Config("alembic.ini")
    migration_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("COGNIGRAPH_DATABASE_URL", migration_url)
    config.set_main_option("sqlalchemy.url", migration_url)
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert "graph_model_proposals" in tables
    assert "tool_call_audits" in tables


@pytest.mark.integration
def test_postgres_migration_chain_renders_offline_in_dependency_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = StringIO()
    config = Config("alembic.ini", output_buffer=output)
    migration_url = "postgresql+asyncpg://user:password@localhost/cognigraph"
    monkeypatch.setenv("COGNIGRAPH_DATABASE_URL", migration_url)
    config.set_main_option("sqlalchemy.url", migration_url)

    command.upgrade(config, "head", sql=True)

    rendered = output.getvalue()
    baseline, separator, later_migrations = rendered.partition("-- Running upgrade 0001 -> 0002")
    assert separator
    assert "CREATE EXTENSION IF NOT EXISTS vector" in baseline

    baseline_creation_order = (
        "CREATE TABLE workspaces",
        "CREATE TABLE model_runs",
        "CREATE TABLE graph_revisions",
        "CREATE TABLE graph_nodes",
        "CREATE TABLE relation_assertions",
        "CREATE TABLE graph_node_sources",
        "CREATE TABLE tool_call_audits",
    )
    assert [baseline.index(statement) for statement in baseline_creation_order] == sorted(
        baseline.index(statement) for statement in baseline_creation_order
    )

    model_runs_baseline = baseline[
        baseline.index("CREATE TABLE model_runs") : baseline.index(
            "CREATE INDEX ix_model_runs_workspace_id"
        )
    ]
    assert "learner_id UUID" not in model_runs_baseline
    assert "graph_revision_id UUID" not in model_runs_baseline
    assert "tool_step_count" not in model_runs_baseline
    for post_baseline_table in (
        "learner_graph_revisions",
        "learner_graph_change_events",
        "learner_relation_assertions",
        "learner_relation_assertion_sources",
        "graph_model_proposals",
    ):
        assert f"CREATE TABLE {post_baseline_table}" not in baseline

    learner_creation_order = (
        "CREATE TABLE learner_graph_revisions",
        "CREATE TABLE learner_graph_change_events",
        "CREATE TABLE learner_relation_assertions",
        "CREATE TABLE learner_relation_assertion_sources",
    )
    assert [later_migrations.index(statement) for statement in learner_creation_order] == sorted(
        later_migrations.index(statement) for statement in learner_creation_order
    )
    assert "ALTER TABLE model_runs ADD COLUMN learner_id UUID" in rendered
    assert "fk_model_runs_learner_id" in rendered
    assert later_migrations.index("CREATE TABLE learner_graph_revisions") < later_migrations.index(
        "fk_model_runs_learner_graph_revision_id"
    )
    assert later_migrations.index(
        "fk_model_runs_learner_graph_revision_id"
    ) < later_migrations.index("CREATE TABLE graph_model_proposals")


@pytest.mark.integration
def test_postgres_downgrade_chain_renders_without_current_metadata_constraints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = StringIO()
    config = Config("alembic.ini", output_buffer=output)
    migration_url = "postgresql+asyncpg://user:password@localhost/cognigraph"
    monkeypatch.setenv("COGNIGRAPH_DATABASE_URL", migration_url)
    config.set_main_option("sqlalchemy.url", migration_url)

    command.downgrade(config, "head:base", sql=True)

    rendered = output.getvalue()
    assert "DROP CONSTRAINT fk_model_runs_graph_revision_id" in rendered
    assert rendered.count("DROP CONSTRAINT fk_model_runs_graph_revision_id") == 1
    assert rendered.index(
        "DROP CONSTRAINT fk_model_runs_learner_graph_revision_id"
    ) < rendered.index("DROP TABLE learner_graph_revisions")
    assert rendered.index("DROP TABLE learner_relation_assertion_sources") < rendered.index(
        "DROP TABLE learner_relation_assertions"
    )
    assert rendered.index("DROP TABLE learner_graph_change_events") < rendered.index(
        "DROP TABLE learner_graph_revisions"
    )
    assert rendered.index("DROP TABLE graph_revisions") < rendered.index("DROP TABLE model_runs")
    assert rendered.index("DROP TABLE model_runs") < rendered.index("DROP TABLE workspaces")


@pytest.mark.integration
def test_post_baseline_migrations_do_not_use_live_orm_metadata() -> None:
    versions = Path("migrations/versions")
    for revision in ("0002", "0003", "0004", "0005"):
        path = next(versions.glob(f"{revision}_*.py"))
        source = path.read_text(encoding="utf-8")
        assert "metadata.create_all" not in source
        assert "metadata.drop_all" not in source
