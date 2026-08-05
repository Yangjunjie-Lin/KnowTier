# Learner Graph

The learner graph is a versioned, auditable projection of one learner's learning state. It is
separate from the authoritative domain graph: an incorrect answer or an unverified learner claim
cannot create a confirmed domain fact.

## SQL records

Migrations `0002` and `0003` create:

- `learner_graph_revisions`: one immutable version per teaching turn, with workspace, learner,
  session, turn, sequence number, parent revision, summary, and timestamp.
- `learner_graph_change_events`: idempotent serialized deltas for audit and recovery.
- `learner_relation_assertions` (`0003`): first-class learner edges with predicate, endpoints, confidence,
  validity interval, source turn, mastery evidence, revision, and supersession.
- `learner_relation_assertion_sources` (`0003`): optional SourceSpan links.

The revision and change-event tables are introduced by `0002`; the assertion and source tables
are introduced by `0003` so each migration has a reversible ownership boundary.

Supported predicates are `HAS_KNOWLEDGE_STATE`, `HAS_MASTERY_EVIDENCE`, `HAS_MISCONCEPTION`,
`REQUIRES_REVIEW`, `BLOCKED_BY_PREREQUISITE`, `READY_FOR_PROMOTION`, `LEARNING_GOAL`,
`RECENTLY_PRACTICED`, `NEEDS_TRANSFER_EVIDENCE`, and `USER_SUPPLIED`.

## Turn transaction

After grading, ChatService performs one SQL transaction:

```text
grade answer
  -> update LearnerKnowledgeState and MasteryEvidence
  -> close superseded learner assertions
  -> create LearnerGraphRevision and LearnerGraphChangeEvent
  -> create current learner assertions
  -> commit the response references
```

Revision sequence numbers are allocated per learner. Repository validation checks workspace,
learner, session, turn, evidence, source ownership, supported predicates, confidence, and
idempotency. A new relation points to the old relation it replaces; historical rows remain
queryable with `valid_to` and `superseded_at`.

## API and projection

The following endpoints support revision and click-through inspection:

```text
GET /v1/learners/{learner_id}/graph/revisions
GET /v1/learners/{learner_id}/graph/revisions/{revision_id}
GET /v1/learners/{learner_id}/graph/assertions/{assertion_id}
GET /v1/learners/{learner_id}/graph/nodes/{node_id}
GET /v1/learners/{learner_id}/knowledge-graph
```

The Cytoscape projection includes assertion id, relation type, natural-language description,
confidence, learner graph revision, source turn, evidence id, validity, and replacement id on
every edge. Detail endpoints expose the learner, knowledge point, level, mastery evidence, grader
dimensions, misconceptions, and replacement history.

`ChatResponse.learner_graph_update.revision_id` identifies the version created by that turn.
`graph_update` always refers only to the domain graph. A normal tutoring turn returns the current
domain revision with zero added/superseded counts; it does not create a new domain revision.

## Domain separation

Domain graph revisions contain sourced theories, definitions, methods, prerequisites, conflicts,
and temporal facts. Learner graph revisions contain mastery, misconceptions, goals, review needs,
and evidence. A learner assertion marked `USER_SUPPLIED` or a model-generated claim without a
source remains unconfirmed until a later source-grounded ingestion explicitly validates it.

## Recovery

Learner graph rows are PostgreSQL system records and survive API restart. The latest revision and
active assertions are loaded by the learner routes without requiring Neo4j. Export consumers should
retain assertion ids and revision ids rather than treating the flattened edge label as identity.
