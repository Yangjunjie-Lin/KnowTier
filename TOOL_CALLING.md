# Controlled Tool Calling

KnowTier exposes a closed set of read-only graph tools to the teacher model. The model never
receives a Cypher or SQL endpoint and cannot mutate either the domain graph or the learner graph.

## Protocol

The gateway uses provider-neutral contracts in `cognigraph.llm.schemas`:

- `ToolDefinition` contains a name, description, and JSON Schema parameters.
- `ToolCall` contains the provider call id, registered name, and parsed arguments.
- `ToolResult` contains the call id, name, and a bounded result envelope.
- `ProviderResponse` may contain text, tool calls, finish reason, provider, model, and usage.

LiteLLM receives OpenAI-compatible `tools` and `tool_choice` fields. Providers that return the
older text-only response are normalized into the same `ProviderResponse` shape.

## Turn loop

1. Chat compiles a revision-keyed Context Bundle (manifest, focus subgraph, learner state,
   sources, and recent turns).
2. The teacher receives the bundle and the fixed tool definitions.
3. Each returned call is validated against its Pydantic parameter model and the request context.
4. The semantic query facade executes one named read with bounded depth, nodes, and result count.
5. The result is checked for the same workspace and graph revision, bounded by bytes, and sent
   back as a `tool` message.
6. The gateway repeats until the teacher returns its final structured `TeacherOutput`.

The default limits are four tool steps, 30,000 result bytes, depth three, 100 graph nodes, and
10 seconds per tool.
The loop is finite even when a provider repeatedly requests tools. Duplicate call ids, unknown
names, malformed arguments, stale revisions, and cross-workspace identifiers are rejected and
audited.

## Registered operations

`search_knowledge_points`, `get_graph_manifest`, `get_node_detail`,
`get_relation_assertion_detail`, `get_prerequisite_chain`, `get_related_theories`,
`get_learning_path`, `get_learner_state`, `get_supporting_sources`, and `get_focus_subgraph` are
the only available operations. All parameters are explicit UUIDs, strings, and bounded integers.

Production domain queries read the revisioned Neo4j projection. `get_learner_state` uses a
single bounded PostgreSQL query after workspace/learner ownership checks, and
`get_learning_path` joins those learner rows only when they refer to the same domain revision.
If Neo4j remains behind after the bounded Outbox retry, the current teaching turn switches both
prefetch and tool reads to the fixed-schema SQL-rehydrated graph snapshot for the exact revision.

## Fallback and audit

Set `COGNIGRAPH_TOOL_CALLING_ENABLED=false` to force the prefetch path. If a provider does not
support tools, or rejects the tool request, the gateway retries once with tools removed and adds
a fallback instruction. The API reports `tool_usage.fallback=true` and logs
`tool_calling_fallback=true`; teaching remains available. The rejected provider request and the
successful prefetch retry are separate model-run audit records.

Every model run records role, provider, model, prompt version, usage, latency, status, and the
workspace/learner/session/turn/document/revision context when those records already exist. Each
tool audit records sanitized arguments, result count and bytes, truncation, latency, tool step,
model run id, and graph revision. Secrets, raw documents, and image bytes are never persisted.

## Security invariants

Tool names are selected from an application-owned registry. The executor has no write method and
does not accept query text. Request context is established after SQL ownership checks in ChatService;
the gateway then requires every learner and workspace identifier in model arguments to match it.
Results missing the expected workspace or revision are rejected, so a stale Neo4j projection cannot
enter a teaching prompt.

Useful offline checks:

```powershell
uv run pytest tests/contract/test_tool_calling.py -q
uv run pytest tests/integration/test_tool_query_audit.py -q
```
