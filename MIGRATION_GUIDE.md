# Migration Guide

Alembic is the production schema authority. Do not call `Base.metadata.create_all()` in a deploy
script. The historical `0001` migration remains compatible with existing installations; all new
objects are explicit migrations.

## Upgrade path

```powershell
uv run alembic current
uv run alembic upgrade head
uv run alembic current
```

The current chain is:

```text
0001_initial_schema
  -> 0002_learner_graph_revisions
  -> 0003_learner_relation_assertions
  -> 0004_tool_calling_audit_fields
  -> 0005_graph_model_proposals
```

`0002` adds learner revisions and change events. `0003` adds first-class learner assertions and
source links. `0004` adds model-run context foreign keys plus bounded tool audit fields. `0005`
stores graph-model comparison proposals separately from canonical graph writes.

Back up PostgreSQL before upgrading. Apply migrations before starting a new API image, and ensure
the `vector` extension is available when using pgvector. The migrations use UUIDs, JSON, checks,
indexes, and explicit foreign keys; no migration depends on a model provider or Neo4j.

## SQLite development databases

SQLite is supported for offline development and tests:

```powershell
$env:COGNIGRAPH_DATABASE_URL = "sqlite+aiosqlite:///./data/cognigraph.db"
uv run alembic upgrade head
```

The migration tests exercise upgrade to head, downgrade to the base, and re-upgrade. SQLite is
not the production concurrency or vector store; use PostgreSQL for deployment.

## Rollback

Only roll back when the application version is compatible with the target schema:

```powershell
uv run alembic downgrade 0003
uv run alembic downgrade 0002
uv run alembic downgrade 0001
```

Downgrading removes learner graph history, audit columns, or graph proposal records according to
the selected revision. Export or back up learner and audit data first. A downgrade does not erase
Neo4j data; rebuild or clear that projection through the controlled operational tooling after the
SQL rollback, then run the matching API version.

## Deployment checks

After an upgrade, verify:

```text
GET /ready
Alembic current == 0005
Outbox pending/failed counts are monitored
Neo4j current revision matches PostgreSQL graph_revisions
```

The release workflow and production integration workflow run these checks against PostgreSQL 16
with pgvector and Neo4j 5.26. The release workflow starts the Compose stack and checks readiness;
the integration workflow also runs the explicit pgvector/transaction/Outbox boundary tests. Real
model smoke remains Secret-gated. OCR smoke runs on published releases and is an explicit
`run_ocr` option for manual dispatches because it requires the platform-specific PaddlePaddle
runtime.
