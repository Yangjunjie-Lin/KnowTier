# Prompt Management

Prompt source files live under `src/cognigraph/prompts`. On startup they are hashed and
registered as immutable active versions in `prompt_versions`.

Packaged files are the runtime source of Prompt content; the database row is the immutable audit
record of the name, declared version, content, content hash, creation time, and active flag.
Model runs separately record the Prompt version. `cognigraph init` migrates the database before
this registration step. A Prompt content change must be accompanied by a declared version
increment—reusing a version with a different hash is rejected rather than silently rewriting
model history.

| Prompt | Responsibility |
| --- | --- |
| `teacher_system.md` | Six levels, one minimal objective, guided response and one check |
| `knowledge_extractor.md` | Strict source-grounded `KnowledgeBlueprint` candidates |
| `response_grader.md` | Correctness, reasoning, independence, transfer and misconceptions |
| `graph_delta_builder.md` | Candidate-only append/supersede graph proposal |
| `conflict_resolver.md` | Conflict classification without deleting history |

The gateway supplies each structured-output JSON Schema directly to LiteLLM. Invalid output is
repaired only through a bounded retry. Every attempt records provider, model, role, prompt
version, tokens, estimated cost, latency, status, and error class.

Document text and learner messages are explicitly labeled untrusted data. They cannot replace
the system prompt, choose a graph mutation, execute a tool, or provide database identifiers.
Prompts receive only a compiled Context Bundle and never contain database credentials, model
keys, the entire graph, or the full conversation history.
