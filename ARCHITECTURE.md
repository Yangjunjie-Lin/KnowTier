# Architecture

## Boundaries

`domain` contains strict Pydantic contracts and enums. It has no database, model provider, or
HTTP dependency. `persistence` implements the PostgreSQL system of record, Neo4j projection,
repositories, migrations, and Outbox. `ingestion`, `extraction`, `graph`, `learner`, and
`tutoring` are domain services. `services` composes use cases, while `api` and `cli` are thin
delivery layers.

The LLM is intentionally not the state machine. It may propose a `KnowledgeBlueprint`, grade
the seven response dimensions defined by `GraderOutput`, and generate bounded prose. Pydantic validation,
`GraphDeltaValidator`, SHACL validation, `EvidenceRuleEstimator`, and `TeachingController`
decide what can be persisted and whether a learner changes level.

## Ingestion and graph transaction

```text
upload validation and SHA-256 deduplication
  -> immutable local blob
  -> Docling-first parsing / per-page PDF completion / optional OCR and Vision
  -> SourceSpan and hierarchical chunk creation
  -> embedding
  -> strict KnowledgeBlueprint extraction
  -> canonicalization, deduplication, conflict detection
  -> GraphDelta validation
  -> PostgreSQL GraphRevision + GraphChangeEvent + Outbox (one transaction)
  -> idempotent Neo4j projection
  -> revision-keyed GraphManifest refresh
```

Source spans and chunks are staged in PostgreSQL before the graph transaction so provenance
foreign keys are valid. `GraphDeltaRepository.persist_delta` locks the revision sequence,
checks the base revision, writes SQL graph records and an Outbox message atomically, and returns
the committed revision ID. The runtime projection uses that same ID. `OutboxDispatcher`
claims with `SKIP LOCKED`, applies a fixed-schema payload, and marks the revision projected;
failures retain retry state and exponential delay. No semantic relation is hard-deleted.
Source spans, chunks, and per-document GraphDelta IDs are content-derived, so a retry after a
process failure addresses the same records. If the graph transaction committed before the
document report did, startup recovery reconstructs that report from the matching
`GraphChangeEvent` instead of creating another revision.

Duplicate triples add provenance. Temporal competing objects close the old validity interval
and add `SUPERSEDES`; non-temporal competing objects remain active in a reviewable conflict
set. User claims and authoritative material remain separate assertions with distinct epistemic
status and evidence.

When enabled, a graph model receives only the candidate blueprint and a bounded lexical subgraph.
It returns a `GraphComparisonProposal`; deterministic canonicalization and validation convert only
review artifacts into `GraphDelta`. The model never chooses canonical IDs or writes a repository.

## Tutoring turn

LangGraph expresses six orchestration nodes: understand/retrieve, evaluate, choose action,
compile context, generate, and persist. A deterministic sequential runner provides identical
behavior when running the minimal mock installation. Domain decisions remain outside
LangGraph.

```text
intent and target selection
  -> prerequisite/mastery lookup
  -> optional previous-answer grading
  -> explainable mastery update
  -> deterministic TeachingDirective
  -> bounded ContextBundle
  -> one teacher response and one mastery check
  -> SQL turn/evidence/state persistence
```

`EvidenceRuleEstimator` requires two distinct turns, two evidence forms, threshold correctness,
valid reasoning, sufficient independence, and no critical misconception. A self-report never
promotes. BKT is available as an explicit four-parameter alternative.
The complete workflow is serialized per runtime and session. PostgreSQL additionally locks the
session row while allocating turn ordinals and uses bounded savepoint retries, so concurrent API
processes cannot create duplicate sessions or turn numbers.

## Bounded model context

The model never receives the full graph or full conversation. `GraphContextCompiler` receives
a revision-keyed manifest, one-to-three-hop candidates, relevant learner states, sources,
teaching policy, session goal, and a short recent window. It applies deterministic UTF-8 token
cost estimation and priority truncation. Older turns remain in PostgreSQL and are not
re-summarized on every call.

Models with tool calling may use only the named fixed-schema query tools. Depth and result
limits are validated by Pydantic, every call records its graph revision, and no raw Cypher API
exists. Production domain reads use the Neo4j semantic projection, while learner mastery reads
come from a bounded PostgreSQL ownership query because learner state is a SQL system record. A
revision check prevents stale projection data from entering a teaching prompt. If a bounded
Outbox dispatch retry still leaves Neo4j behind, that turn uses the fixed-schema SQL-rehydrated
graph snapshot at the requested revision and records `semantic_projection_fallback=true`.
Models without tool calling receive equivalent prefetched context. Sanitized tool-call audits
are buffered, written to PostgreSQL in bounded batches, retried on failure, and flushed during
graceful shutdown.

Each completed turn also creates a `LearnerGraphRevision` and first-class learner assertions in the
same SQL unit of work. This student projection can be queried and exported independently without
changing the domain `GraphRevision`.

## Runtime and restart behavior

PostgreSQL remains authoritative for commits, audit history, and rebuilding. Each workspace graph
is lazily hydrated into a bounded validation snapshot from SQL records after a process restart.
Neo4j is the primary runtime semantic query store and remains an independently rebuildable
projection. `/ready` checks both SQL and the configured graph repository. Mock mode uses the
behavior-compatible in-memory graph repository while retaining PostgreSQL/SQLite operational
records.

Schema migration is an operational prerequisite, not an implicit FastAPI startup side effect.
`cognigraph init` creates local paths, runs Alembic using the URL resolved by `Settings`, and
then starts the runtime once to register Prompt assets. Docker Compose performs the same ordering
after PostgreSQL and Neo4j pass their health checks. Its frozen install uses the committed
`uv.lock`, the `documents` extra, and an isolated Linux `.venv` volume; dependency changes
therefore require an intentional lock refresh before container startup.

SQLite and the in-memory graph repository are offline-compatible substitutes for deterministic
tests and the mock demo. Production remains PostgreSQL plus Neo4j. A release check should
exercise migrations, readiness, and Outbox projection against the Compose services as well as
the default offline suite.

Docling is the rich layout parser. For mixed PDFs, page-bound Docling blocks and the PDF text
layer are checked page by page; only unresolved pages are rendered for OCR and then Vision.
The core format adapters retain offline PDF, DOCX, PPTX, Markdown, and text paths. The `ocr`
extra resolves PaddleOCR and the CPU PaddlePaddle runtime in the committed lock file against
their supported 3.x APIs. Wheel availability remains platform-specific, which is why OCR has a
separate Compose profile and release acceptance job.

## Security

Uploads enforce MIME/extension/size constraints, filename-only paths, resolved-root checks,
and SHA-256 deduplication. Source spans and learner text are placed in dedicated JSON fields and
explicitly marked as untrusted data in model calls. Prompts contain no credentials. SQLAlchemy
and Neo4j repositories use bound parameters; arbitrary SQL/Cypher is not accepted. Error
handlers return stable messages and do not expose stack traces. Structured logs carry
correlation identifiers without full source documents or secrets.
