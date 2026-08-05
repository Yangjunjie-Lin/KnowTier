# Production Testing

The default suite is credential-free.  It uses SQLite, the in-memory semantic
projection, deterministic embeddings, and `FakeProvider`.

```powershell
uv lock --check
uv sync --frozen --dev
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run mypy src/cognigraph
uv run pytest tests/unit tests/contract
uv run pytest tests/integration tests/e2e -m "not postgres and not neo4j and not ocr and not live_model"
```

Markers partition external dependencies:

| Marker | Requirement |
| --- | --- |
| `unit` | No service or network |
| `contract` | Provider API contract, normally fake provider |
| `integration` | Repository/API boundary |
| `postgres` | PostgreSQL with pgvector |
| `neo4j` | Neo4j projection |
| `ocr` | Installed OCR runtime and sample fixtures |
| `performance` | Opt-in 10k-node/50k-assertion/1k-learner budget tests |
| `e2e` | Full application workflow |
| `live_model` | Explicit model credentials and opt-in execution |

To exercise the production stack locally:

```powershell
docker compose up -d postgres neo4j api
Invoke-WebRequest http://localhost:8000/ready
```

The API container runs the Alembic upgrade before Uvicorn starts. For a full OCR image, use
`docker compose --profile ocr up --wait postgres neo4j api-ocr` and query port `8001`. In a
production deployment, an authenticated gateway must inject `X-Workspace-ID`; workspace
bootstrap additionally requires `X-Workspace-Provisioning-Token`.

The `integration.yml` workflow starts PostgreSQL 16 with pgvector and Neo4j
5.26 Community, applies Alembic migrations, and executes production-boundary
tests. It explicitly runs `test_postgres_production.py`, which verifies the
`vector` extension, vector distance execution, transaction rollback, and the transactional
Outbox contract. The HTTP smoke then verifies actual Neo4j projection revision, domain and
learner detail queries, three tutoring turns, all graph exports, API restart, and persisted
recovery under production tenant headers. It never invokes a paid model.

`release-check.yml` starts Compose with production settings and checks `/health` and `/ready`.
Its `live-model` test runs only when the `COGNIGRAPH_API_KEY` repository secret exists. Real OCR
runs automatically for a published release; manual dispatches must select `run_ocr`. Once OCR is
selected, the workflow sets the opt-in flag and all fixture paths, so dependency or recognition
failures cannot turn into a skip.

The large-graph budget checks are intentionally opt-in because they allocate a
production-sized synthetic snapshot:

```powershell
$env:COGNIGRAPH_RUN_PERFORMANCE="1"
uv run pytest tests/performance -m performance
```
