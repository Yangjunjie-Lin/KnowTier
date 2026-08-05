# Data Model

## PostgreSQL

PostgreSQL owns operational state, audit history, version sequencing, and Outbox delivery.
Alembic migrations `0001` through `0005` create these tables:

| Table | Purpose |
| --- | --- |
| `workspaces` | Tenant boundary, language, settings, active state |
| `learners` | Learner identity and preferences |
| `sessions` | Requested mode, goal, active target and lifecycle |
| `turns` | Ordered user/assistant turns, assessment and context revision |
| `documents` | Immutable upload metadata, SHA-256, parser and report |
| `document_chunks` | Retrieval chunks with pgvector embedding |
| `source_spans` | Page/heading/offset/bounding-box source evidence |
| `learner_knowledge_states` | Level, mastery, confidence, counters and review schedule |
| `mastery_evidence` | Four-dimensional graded evidence per turn |
| `model_configs` | Per-role LiteLLM routing, retries and concurrency |
| `model_runs` | Tokens, estimated cost, latency, status and error type |
| `prompt_versions` | Immutable content hash and active prompt version |
| `graph_revisions` | Per-workspace monotonic revision and projection status |
| `graph_change_events` | Idempotent canonical GraphDelta audit event |
| `outbox_messages` | Claim/retry/publish state for Neo4j projection |
| `graph_nodes` | SQL audit copy of versioned graph nodes |
| `relation_assertions` | First-class, temporal semantic assertions |
| `graph_node_sources` | Node-to-SourceSpan provenance |
| `assertion_sources` | Assertion-to-SourceSpan provenance |
| `graph_conflicts` | Competing assertion review records |
| `tool_call_audits` | Controlled graph tool parameters and result metadata |
| `learner_graph_revisions` | Immutable per-turn learner graph versions |
| `learner_graph_change_events` | Idempotent learner graph deltas |
| `learner_relation_assertions` | First-class learner relations and validity history |
| `learner_relation_assertion_sources` | Learner assertion provenance links |
| `graph_model_proposals` | Read-only graph-model comparison advice and fallback audit |
| `audit_events` | General security and mutation audit stream |
| `stored_blobs` | Content-addressed blob metadata |

UUID primary keys, workspace indexes, check constraints, and uniqueness constraints prevent
cross-workspace duplicates and invalid mastery ranges. PostgreSQL stores the committed graph
history even if Neo4j is unavailable.

Alembic is the only production schema lifecycle entry point. `cognigraph init` and
`cognigraph db migrate` both resolve the database URL through `Settings`, so values loaded from
`.env` and explicit environment overrides target the same database as the API. SQLite creates
its parent directory before migration and is used for offline tests; the Compose profile applies
the same migration to PostgreSQL and enables the `vector` extension before API startup.

## Neo4j projection

Ontology and content labels include `EntityType`, `RelationType`, `Constraint`, `Theory`,
`Domain`, `EpistemicStatus`, `KnowledgePoint`, `Definition`, `Method`, `Example`,
`Counterexample`, `Misconception`, `Question`, `LearningStage`, `SourceDocument`, and
`SourceSpan`. The ontology can name learner-oriented types such as `LearnerKnowledgeState`, but
the versioned learner graph and its first-class assertions remain PostgreSQL system records;
they are queried independently and are not authoritative Neo4j state.

Semantic relations are not opaque Neo4j edges. Each is a `RelationAssertion` node connected by
fixed projection edges:

```text
(subject)-[:SUBJECT_OF]->(assertion:RelationAssertion)
(assertion)-[:OBJECT_IS]->(object)
(assertion)-[:INSTANCE_OF]->(relation_type:RelationType)
(assertion)-[:SUPPORTED_BY]->(source_span:SourceSpan)
```

Core predicates are `IS_A`, `PART_OF`, `REQUIRES`, `ENABLES`, `EXPLAINS`, `CONTRASTS_WITH`,
`SIMILAR_TO`, `APPLIES_TO`, `FAILS_WHEN`, `SUPPORTED_BY`, `DERIVED_FROM`, `EXAMPLE_OF`,
`COUNTEREXAMPLE_OF`, `MISCONCEPTION_ABOUT`, `ASSESSES`, `TEACHES`, `MASTERED_BY`,
`SUPERSEDES`, and `CONFLICTS_WITH`.

Every assertion stores subject, predicate, object, natural-language description, confidence,
epistemic status, validity interval, creation actor/time, source IDs, model run, graph revision,
and optional superseded assertion. Assertions are independently addressable and queryable.

## Export model

Cytoscape export flattens each active assertion to a visual edge but keeps `assertion_id`,
predicate, description, confidence, and source count. JSON-LD and Turtle preserve assertions as
resources rather than losing provenance in direct RDF predicates. Learner graph export contains
learner state nodes and first-class learner assertion edges with revision and evidence metadata;
it does not duplicate or mutate the domain graph.
