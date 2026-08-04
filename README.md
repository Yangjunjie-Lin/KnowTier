# Cognigraph Tutor

Cognigraph Tutor is a backend-only tutoring agent that combines a deterministic six-level
teaching policy, learner mastery estimation, source-grounded knowledge extraction, and a
versioned first-class relation graph. FastAPI exposes document, chat, graph, learner, and
export APIs. PostgreSQL is the operational/audit system of record; Neo4j is the semantic
projection written through a transactional Outbox.

The default mock mode needs no model API key and performs a complete, deterministic teaching
flow suitable for local development and tests.

## Requirements

- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- Docker Compose for the production-shaped PostgreSQL/Neo4j stack

## Local setup

For a lightweight local process with SQLite, install the project and edit the copied `.env`
before initialization:

```bash
uv sync --dev --extra documents
cp .env.example .env
# Set COGNIGRAPH_DATABASE_URL=sqlite+aiosqlite:///./data/cognigraph.db
# Set COGNIGRAPH_NEO4J_REQUIRED=false and COGNIGRAPH_USE_MOCK_LLM=true
uv run cognigraph init
uv run uvicorn cognigraph.main:app --reload
```

On PowerShell, use `Copy-Item .env.example .env` in place of `cp`.

`cognigraph init` creates local storage, runs the Alembic migration against the database URL
loaded by `Settings` (including `.env`), and then registers active Prompt versions. The example
environment deliberately points at PostgreSQL, so do not run the migration from a clean checkout
until that database is running or the URL has been changed to SQLite.

To run the API process on the host while PostgreSQL and Neo4j run in Docker, use:

```bash
docker compose up -d postgres neo4j
# Set COGNIGRAPH_NEO4J_REQUIRED=true in .env
uv run cognigraph init
uv run uvicorn cognigraph.main:app --reload
```

OpenAPI is available at `http://127.0.0.1:8000/docs`. Health endpoints are `/health` and
`/ready`; readiness checks both the SQL store and the configured semantic graph repository.

Install the richer document stack when needed:

```bash
uv sync --dev --extra documents
uv sync --dev --extra documents --extra ocr
```

Docling is attempted first. The core install also includes real fallbacks for text, Markdown,
PDF, DOCX, and PPTX. Image ingestion uses Docling and can fall back to PaddleOCR when the
`ocr` extra is installed. PaddleOCR also requires a platform-compatible PaddlePaddle 3 runtime;
install it by following the
[official PaddlePaddle instructions](https://www.paddlepaddle.org.cn/install/quick) because its
wheel/index choice is platform-specific and is intentionally not forced by this project.

## Docker Compose

```bash
cp .env.example .env
docker compose up
```

The stack uses `pgvector/pgvector:pg16`, Neo4j 5.26 Community, and a Python 3.12 uv API
container. It installs the locked runtime plus the `documents` extra, runs Alembic, and starts
the API only after both databases are healthy. Database data, uploads, the Linux virtual
environment, and the uv cache use separate named volumes, so a host Windows `.venv` is never
overwritten. Re-run `uv lock` whenever `pyproject.toml` dependencies change before starting the
frozen container install.

## First mock flow

```bash
uv run cognigraph demo
```

The demo creates a workspace and learner, extracts a source-grounded knowledge point from a
text question, teaches Level 1, records two distinct mastery evidence forms, and promotes the
learner to Level 2. It never calls the internet or a real model.

Useful CLI commands:

```bash
uv run cognigraph init
uv run cognigraph db migrate
uv run cognigraph seed-demo
uv run cognigraph workspace create --name "My workspace" --slug my-workspace
uv run cognigraph learner create --workspace <workspace-id> --name "Learner"
uv run cognigraph ingest material.pdf --workspace <workspace-id>
uv run cognigraph ask --learner <learner-id> --message "Teach me Bayes' rule"
uv run cognigraph learner show <learner-id>
uv run cognigraph graph manifest --workspace <workspace-id>
uv run cognigraph graph export --workspace <workspace-id> --format cytoscape
```

`uv run python scripts/seed_demo.py` creates reusable demo workspace and learner records in the
configured database. `uv run python scripts/demo_flow.py` instead runs the isolated in-memory
three-turn teaching demonstration. `scripts/export_graph.py` is a narrow command wrapper and
accepts the same `--workspace` and `--format` options as `cognigraph graph export`.

## Model configuration

Business code only calls the LiteLLM gateway. Each role accepts any LiteLLM model string:

```dotenv
COGNIGRAPH_USE_MOCK_LLM=false
COGNIGRAPH_TEACHER_MODEL=openai/gpt-4.1-mini
COGNIGRAPH_EXTRACTOR_MODEL=anthropic/claude-sonnet-4-20250514
COGNIGRAPH_GRADER_MODEL=gemini/gemini-2.5-flash
COGNIGRAPH_GRAPH_MODEL=openrouter/openai/gpt-4.1-mini
COGNIGRAPH_VISION_MODEL=azure/gpt-4.1
COGNIGRAPH_EMBEDDING_MODEL=openai/text-embedding-3-small
COGNIGRAPH_FALLBACK_MODELS='["ollama/qwen2.5:7b"]'
OPENAI_API_KEY=<provider-key>
```

`COGNIGRAPH_API_KEY` is passed to LiteLLM as an explicit key and is convenient when all configured
roles share one credential. For mixed providers or separate credentials, use the provider-specific
environment variables recognized by LiteLLM, such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or the
corresponding Azure/Bedrock variables. Application secret settings use `SecretStr`, are excluded
from model representations, and are never placed in prompts or logs.

## API outline

- `POST /v1/workspaces`
- `POST /v1/learners`
- `POST /v1/workspaces/{workspace_id}/documents`
- `POST /v1/documents/{document_id}/ingest`
- `POST /v1/chat`
- `GET /v1/graph/manifest`, `/subgraph`, `/nodes/{id}`, `/assertions/{id}`
- `GET /v1/graph/revisions`, `/revisions/{id}`, `/export`
- `GET /v1/learners/{id}/model`, `/model.csv`, `/knowledge-graph`, `/learning-path`, `/evidence`

Every graph edge exposed to Cytoscape carries its first-class `assertion_id`, relation type,
description, confidence, and source count. Node and assertion detail endpoints return source
spans and graph revision identity.

## Verification

```bash
uv lock --check
uv sync --frozen --dev --extra documents
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run mypy src/cognigraph
uv run pytest
```

Live Neo4j tests are opt-in and remain skipped unless their explicit test environment is
configured. All default unit, contract, integration, API, PDF, and end-to-end tests are
offline.

See [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md), and
[PROMPTS.md](PROMPTS.md) for implementation details.
