from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

import pytest
from click import unstyle
from typer.testing import CliRunner

from cognigraph.cli import app
from cognigraph.config import get_settings
from scripts import demo_flow, export_graph, seed_demo

pytestmark = pytest.mark.integration

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _sqlite_environment(tmp_path: Path) -> tuple[dict[str, str], Path, Path]:
    database_path = tmp_path / "new" / "database" / "cognigraph.db"
    storage_path = tmp_path / "new" / "uploads"
    environment = {
        "COGNIGRAPH_DATABASE_URL": (f"sqlite+aiosqlite:///{database_path.as_posix()}"),
        "COGNIGRAPH_STORAGE_PATH": str(storage_path),
        "COGNIGRAPH_NEO4J_REQUIRED": "false",
        "COGNIGRAPH_USE_MOCK_LLM": "true",
    }
    return environment, database_path, storage_path


def test_init_migrates_settings_database_before_runtime_startup(tmp_path: Path) -> None:
    environment, database_path, storage_path = _sqlite_environment(tmp_path)
    runner = CliRunner()

    result = runner.invoke(app, ["init"], env=environment)

    assert result.exit_code == 0, result.output
    assert "initialized" in result.output
    assert database_path.is_file()
    assert storage_path.is_dir()
    with sqlite3.connect(database_path) as connection:
        tables = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        prompt_rows = list(
            connection.execute(
                "SELECT prompt_name, version FROM prompt_versions ORDER BY prompt_name"
            )
        )
        prompt_names = {str(row[0]) for row in prompt_rows}
    assert {"alembic_version", "workspaces", "prompt_versions"}.issubset(tables)
    assert {
        "chat_topic_extractor",
        "conflict_resolver",
        "graph_delta_builder",
        "knowledge_extractor",
        "response_grader",
        "teacher_system",
    }.issubset(prompt_names)
    assert len(prompt_rows) == len(prompt_names)


def test_seed_demo_is_persistent_and_idempotent(
    tmp_path: Path,
    request: pytest.FixtureRequest,
) -> None:
    environment, database_path, _storage_path = _sqlite_environment(tmp_path)
    runner = CliRunner()
    get_settings.cache_clear()
    request.addfinalizer(get_settings.cache_clear)
    get_settings()
    initialized = runner.invoke(app, ["init"], env=environment)
    assert initialized.exit_code == 0, initialized.output

    first = runner.invoke(app, ["seed-demo"], env=environment)
    second = runner.invoke(app, ["seed-demo"], env=environment)

    assert first.exit_code == 0, first.output
    assert second.exit_code == 0, second.output
    with sqlite3.connect(database_path) as connection:
        workspace_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM workspaces WHERE slug = 'cognigraph-demo'"
            ).fetchone()[0]
        )
        learner_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM learners WHERE external_id = 'demo-learner'"
            ).fetchone()[0]
        )
    assert workspace_count == 1
    assert learner_count == 1


def test_demo_uses_transaction_safe_temporary_sqlite_database() -> None:
    result = CliRunner().invoke(app, ["demo"])

    assert result.exit_code == 0, result.output
    responses = json.loads(result.output)
    assert len(responses) == 3
    assert all(item["learner_graph_update"]["revision_id"] for item in responses)


@pytest.mark.parametrize(
    ("module", "script_name", "expected_prefix"),
    [
        (export_graph, "export_graph.py", ["graph", "export"]),
        (seed_demo, "seed_demo.py", ["seed-demo"]),
        (demo_flow, "demo_flow.py", ["demo"]),
    ],
)
def test_script_wrappers_route_arguments_to_distinct_cli_commands(
    module: Any,
    script_name: str,
    expected_prefix: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[list[str], str]] = []

    def fake_app(*, args: list[str], prog_name: str) -> None:
        calls.append((args, prog_name))

    monkeypatch.setattr(module, "app", fake_app)
    monkeypatch.setattr(sys, "argv", [script_name, "--help"])

    module.main()

    assert calls == [([*expected_prefix, "--help"], script_name)]


def test_export_script_is_an_executable_typer_wrapper() -> None:
    environment = dict(os.environ)
    source_path = str(REPOSITORY_ROOT / "src")
    existing_path = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        f"{source_path}{os.pathsep}{existing_path}" if existing_path else source_path
    )
    # Rich truncates option names when captured output inherits a narrow CI
    # terminal. Fix the width so this subprocess assertion tests the wrapper's
    # command surface rather than the runner's presentation settings.
    environment["COLUMNS"] = "200"

    result = subprocess.run(
        [sys.executable, "scripts/export_graph.py", "--help"],
        cwd=REPOSITORY_ROOT,
        env=environment,
        capture_output=True,
        check=False,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
    help_output = unstyle(result.stdout)
    assert "--workspace" in help_output
    assert "--format" in help_output


def test_dependency_and_compose_profiles_are_reproducible() -> None:
    with (REPOSITORY_ROOT / "pyproject.toml").open("rb") as handle:
        project = tomllib.load(handle)
    assert "dev" in project["dependency-groups"]
    assert "dev" not in project["project"]["optional-dependencies"]
    force_include = project["tool"]["hatch"]["build"]["targets"]["wheel"]["force-include"]
    assert force_include["alembic.ini"] == "cognigraph/alembic.ini"
    assert force_include["migrations"] == "cognigraph/migrations"

    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "uv sync --frozen --no-dev --extra documents" in compose
    assert "venv_data:/app/.venv" in compose
    assert "--all-extras" not in compose

    makefile = (REPOSITORY_ROOT / "Makefile").read_text(encoding="utf-8")
    assert "uv lock --check" in makefile
    assert "ruff format --check src tests scripts" in makefile
    assert "check: lock-check format-check lint typecheck test" in makefile


def test_production_workflow_tracks_the_uvicorn_process_for_restarts() -> None:
    workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "integration.yml").read_text(
        encoding="utf-8"
    )

    assert workflow.count(".venv/bin/uvicorn cognigraph.main:app") == 2
    assert "uv run uvicorn cognigraph.main:app" not in workflow
    assert workflow.count('kill -0 "$(cat api.pid)"') == 2
    assert 'old_pid="$(cat api.pid)"' in workflow
    assert 'if ! kill -0 "$old_pid"' in workflow
    assert 'wait "$(cat api.pid)"' not in workflow
