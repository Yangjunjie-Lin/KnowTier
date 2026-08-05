from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any, Literal, cast
from uuid import UUID, uuid4

import typer
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy.engine import make_url

from cognigraph.api.schemas import ChatRequest
from cognigraph.config import Settings
from cognigraph.graph.query_tools import WorkspaceParams
from cognigraph.services.chat import ChatService
from cognigraph.services.runtime import ApplicationRuntime

app = typer.Typer(help="Cognigraph Tutor administration and teaching CLI.")
db_app = typer.Typer(help="Database operations.")
workspace_app = typer.Typer(help="Workspace operations.")
learner_app = typer.Typer(help="Learner operations.")
graph_app = typer.Typer(help="Graph operations.")
app.add_typer(db_app, name="db")
app.add_typer(workspace_app, name="workspace")
app.add_typer(learner_app, name="learner")
app.add_typer(graph_app, name="graph")


def _run(coroutine: Any) -> Any:
    return asyncio.run(coroutine)


async def _with_runtime(operation: Any, settings: Settings | None = None) -> Any:
    runtime = ApplicationRuntime(settings or Settings())
    await runtime.startup()
    try:
        return await operation(runtime)
    finally:
        await runtime.shutdown()


def _prepare_local_paths(settings: Settings) -> None:
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    database_url = make_url(settings.database_url)
    if database_url.get_backend_name() != "sqlite":
        return
    database_name = database_url.database
    if not database_name or database_name == ":memory:":
        return
    database_path = Path(database_name).expanduser()
    if not database_path.is_absolute():
        database_path = Path.cwd() / database_path
    database_path.parent.mkdir(parents=True, exist_ok=True)


def _run_migrations(settings: Settings) -> None:
    config_path, migrations_path = _migration_assets()
    config = AlembicConfig(str(config_path))
    config.set_main_option("script_location", str(migrations_path))
    # Alembic's ConfigParser treats percent signs as interpolation markers.
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    alembic_command.upgrade(config, "head")


def _migration_assets() -> tuple[Path, Path]:
    package_root = Path(__file__).resolve().parent
    packaged_config = package_root / "alembic.ini"
    packaged_migrations = package_root / "migrations"
    if packaged_config.is_file() and packaged_migrations.is_dir():
        return packaged_config, packaged_migrations

    repository_config = Path.cwd() / "alembic.ini"
    repository_migrations = Path.cwd() / "migrations"
    if repository_config.is_file() and repository_migrations.is_dir():
        return repository_config, repository_migrations
    raise RuntimeError("Alembic migration assets are missing from this installation")


@app.command("init")
def initialize() -> None:
    """Initialize local storage, schema and active prompt versions."""

    settings = Settings()
    _prepare_local_paths(settings)
    _run_migrations(settings)

    async def operation(_runtime: ApplicationRuntime) -> None:
        return None

    _run(_with_runtime(operation, settings))
    typer.echo("Cognigraph Tutor initialized.")


@db_app.command("migrate")
def migrate() -> None:
    settings = Settings()
    _prepare_local_paths(settings)
    _run_migrations(settings)
    typer.echo("Database migration complete.")


@workspace_app.command("create")
def create_workspace(
    name: str = typer.Option(..., "--name"),
    slug: str = typer.Option(..., "--slug"),
) -> None:
    async def operation(runtime: ApplicationRuntime) -> str:
        async with runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.create(name=name, slug=slug)
            await unit.commit()
        return str(workspace.id)

    typer.echo(_run(_with_runtime(operation)))


@learner_app.command("create")
def create_learner(
    workspace_id: UUID = typer.Option(..., "--workspace"),
    name: str = typer.Option(..., "--name"),
) -> None:
    async def operation(runtime: ApplicationRuntime) -> str:
        async with runtime.database.unit_of_work() as unit:
            learner = await unit.learners.create(
                workspace_id=workspace_id,
                display_name=name,
            )
            await unit.commit()
        return str(learner.id)

    typer.echo(_run(_with_runtime(operation)))


@app.command("ingest")
def ingest(
    file: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    workspace_id: UUID = typer.Option(..., "--workspace"),
    mime_type: str | None = typer.Option(None, "--mime"),
) -> None:
    async def operation(runtime: ApplicationRuntime) -> str:
        import mimetypes

        detected = mime_type or mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        upload = await runtime.ingestion.upload(
            workspace_id=workspace_id,
            filename=file.name,
            mime_type=detected,
            content=await asyncio.to_thread(file.read_bytes),
        )
        report = await runtime.ingestion.ingest(upload.document_id)
        return report.model_dump_json(indent=2)

    typer.echo(_run(_with_runtime(operation)))


@app.command("ask")
def ask(
    learner_id: UUID = typer.Option(..., "--learner"),
    message: str = typer.Option(..., "--message"),
    session_id: UUID | None = typer.Option(None, "--session"),
) -> None:
    async def operation(runtime: ApplicationRuntime) -> str:
        async with runtime.database.unit_of_work() as unit:
            learner = await unit.learners.get(learner_id)
        if learner is None:
            raise typer.BadParameter("learner does not exist")
        response = await ChatService(runtime).chat(
            ChatRequest(
                workspace_id=learner.workspace_id,
                learner_id=learner_id,
                session_id=session_id or uuid4(),
                message=message,
            )
        )
        return response.model_dump_json(indent=2)

    typer.echo(_run(_with_runtime(operation)))


@learner_app.command("show")
def show_learner(learner_id: UUID = typer.Argument(...)) -> None:
    async def operation(runtime: ApplicationRuntime) -> str:
        async with runtime.database.unit_of_work() as unit:
            learner = await unit.learners.get(learner_id)
            states = await unit.learner_states.list_states(learner_id)
        if learner is None:
            raise typer.BadParameter("learner does not exist")
        return json.dumps(
            {
                "id": str(learner.id),
                "workspace_id": str(learner.workspace_id),
                "display_name": learner.display_name,
                "states": [
                    {
                        "knowledge_point_id": str(item.knowledge_point_id),
                        "current_level": item.current_level,
                        "mastery_score": item.mastery_score,
                        "confidence": item.confidence,
                        "evidence_count": item.evidence_count,
                    }
                    for item in states
                ],
            },
            ensure_ascii=False,
            indent=2,
        )

    typer.echo(_run(_with_runtime(operation)))


@graph_app.command("manifest")
def graph_manifest(workspace_id: UUID = typer.Option(..., "--workspace")) -> None:
    async def operation(runtime: ApplicationRuntime) -> str:
        await runtime.ensure_graph_loaded(workspace_id)
        result = await runtime.semantic_queries.get_graph_manifest(
            WorkspaceParams(workspace_id=workspace_id)
        )
        return result.model_dump_json(indent=2)

    typer.echo(_run(_with_runtime(operation)))


@graph_app.command("export")
def graph_export(
    workspace_id: UUID = typer.Option(..., "--workspace"),
    format_: str = typer.Option("cytoscape", "--format"),
) -> None:
    if format_ not in {"cytoscape", "jsonld", "turtle"}:
        raise typer.BadParameter("format must be cytoscape, jsonld or turtle")

    async def operation(runtime: ApplicationRuntime) -> str:
        snapshot = await runtime.ensure_graph_loaded(workspace_id)
        export_format = cast(Literal["cytoscape", "jsonld", "turtle"], format_)
        result = runtime.graph_exporter.export(snapshot, export_format)
        return (
            result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, indent=2)
        )

    typer.echo(_run(_with_runtime(operation)))


@app.command("seed-demo")
def seed_demo(
    workspace_name: str = typer.Option("Cognigraph Demo", "--workspace-name"),
    workspace_slug: str = typer.Option("cognigraph-demo", "--workspace-slug"),
    learner_name: str = typer.Option("Demo Learner", "--learner-name"),
) -> None:
    """Create or reuse persistent demo workspace and learner records."""

    async def operation(runtime: ApplicationRuntime) -> str:
        async with runtime.database.unit_of_work() as unit:
            workspace = await unit.workspaces.get_by_slug(workspace_slug)
            if workspace is None:
                workspace = await unit.workspaces.create(
                    name=workspace_name,
                    slug=workspace_slug,
                )
            learners = await unit.learners.list_for_workspace(workspace.id)
            learner = next(
                (item for item in learners if item.external_id == "demo-learner"),
                None,
            )
            if learner is None:
                learner = await unit.learners.create(
                    workspace_id=workspace.id,
                    display_name=learner_name,
                    external_id="demo-learner",
                )
            await unit.commit()
        return json.dumps(
            {
                "workspace_id": str(workspace.id),
                "workspace_slug": workspace.slug,
                "learner_id": str(learner.id),
            },
            ensure_ascii=False,
            indent=2,
        )

    typer.echo(_run(_with_runtime(operation)))


@app.command("demo")
def demo() -> None:
    async def operation() -> str:
        # Concurrent model/audit transactions cannot safely share SQLite's
        # single ``:memory:`` connection. A temporary file preserves the
        # credential-free demo while exercising the real transaction layout.
        with tempfile.TemporaryDirectory(prefix="cognigraph-demo-") as directory:
            demo_root = Path(directory)
            settings = Settings(
                database_url=f"sqlite+aiosqlite:///{(demo_root / 'demo.db').as_posix()}",
                storage_path=demo_root / "uploads",
                use_mock_llm=True,
                neo4j_required=False,
            )
            runtime = ApplicationRuntime(settings)
            await runtime.startup()
            try:
                workspace_id = uuid4()
                learner_id = uuid4()
                session_id = uuid4()
                async with runtime.database.unit_of_work() as unit:
                    await unit.workspaces.create(
                        workspace_id=workspace_id,
                        name="Cognigraph Demo",
                        slug=f"demo-{workspace_id.hex[:8]}",
                    )
                    await unit.learners.create(
                        workspace_id=workspace_id,
                        learner_id=learner_id,
                        display_name="Demo Learner",
                    )
                    await unit.commit()
                service = ChatService(runtime)
                messages = [
                    "Teach me prerequisite knowledge.",
                    "It is something needed first, but I am not sure why.",
                    "It is needed because the later idea depends on it.",
                ]
                responses = []
                for message in messages:
                    response = await service.chat(
                        ChatRequest(
                            workspace_id=workspace_id,
                            learner_id=learner_id,
                            session_id=session_id,
                            message=message,
                        )
                    )
                    responses.append(response.model_dump(mode="json"))
                return json.dumps(responses, ensure_ascii=False, indent=2)
            finally:
                await runtime.shutdown()

    typer.echo(_run(operation()))


if __name__ == "__main__":
    app()
