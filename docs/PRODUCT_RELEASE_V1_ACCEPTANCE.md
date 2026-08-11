# KnowTier v1 product acceptance record

This record covers the product-release candidate built from remote `main` baseline
`5ea7d59525db69a5b9d386c8eb3f0fc004596d75`. It records only checks that were actually executed.
The previously packaged candidate was `v1.0.0-rc.4`. The source candidate is now
`v1.0.0-rc.5` because existing release-candidate tags are immutable. RC.5
must complete a fresh GitHub Actions three-platform build and draft-release assembly before
general-availability `v1.0.0` can be considered.

## Page — function — API — data — test matrix

| Page / state | User-visible function | Real API chain | Durable / derived data | Executed coverage | Result |
| --- | --- | --- | --- | --- | --- |
| First launch | Create Workspace and Learner; restore deep links after initialization | `POST /v1/workspaces`, `POST /v1/learners` | Workspace, Learner, local current context | Vitest initialization; Playwright complete flow at 1440×900, 1024×768, 390×844 | Pass |
| Overview | Mastery, pending review, evidence and graph revision summary | Workspace, learner model/evidence, domain and learner revision reads | SQL learner state and revision metadata | Playwright navigation, axe and visual snapshots in all three viewports | Pass |
| Learning workspace | Focused tutoring flow, on-demand Learning Status Sheet, mode/target/session switching | `POST /v1/chat`, active Teacher model, learner/domain insight reads | Turns, target, evidence, misconceptions, learner/domain revisions | Vitest duplicate/cancel/retry/context tests; Playwright end-to-end tutoring | Pass |
| Upload and camera entry | Upload, ingest and attach material without losing the draft | document upload then `POST /v1/documents/{id}/ingest` | Upload file, chunks, provenance and ingestion report | Vitest upload/ingest failure; Playwright text-file ingestion | Pass |
| Knowledge extraction | Compact validated extraction, multiple candidate ranking and evidence state | ModelGateway Extractor plus deterministic validation/fallback | Knowledge points remain `UNVERIFIED` without external evidence | Backend unit, contract, integration and packaged Mock RAG smoke | Pass |
| Domain graph | Canvas click, list alternative, keyboard selection, filter/fullscreen/export and detail drawer | domain graph/detail/export reads | Versioned nodes, relations, assertions and sources | Playwright canvas/list/keyboard/axe/visual; backend graph regressions | Pass |
| Student graph | Relationship-first learner canvas/list, natural-language filters and optional advanced detail | learner graph, node/assertion detail and revision reads | Learner mastery projection, evidence links and immutable revisions | Vitest presentation projection; Playwright keyboard/axe; integration tutoring flow | Pass |
| Personal model | Mastery, evidence and misconception sections with partial-read handling | learner model/evidence reads | Audited mastery and evidence | Playwright success, 500 and retry recovery; Vitest insight panels | Pass |
| Learning path | Select a target and enter learning without stale navigation state | learning-path read plus chat target selection | Derived path over domain and learner state | Playwright navigation; unit target/session isolation | Pass |
| Domain versions | Version list and detail without exposing raw JSON as primary UI | domain revision list/detail | Immutable domain revisions and audit metadata | Playwright navigation; Vitest version details | Pass |
| Student versions | Learner revision list/detail synchronized after chat | learner revision list/detail | Immutable learner revisions | Chat invalidation tests and integration tutoring flow | Pass |
| Global search | Ctrl/Cmd+K focus, knowledge/material/learner result navigation | global search endpoint | Ranked derived results; source records remain authoritative | Playwright search, keyboard, axe and visual in three viewports | Pass |
| Settings | Chinese/English selection, theme, density, font, local learning preferences and health | `/health`, `/ready` and preference-local state | Non-secret browser preferences only | Vitest persistence/migration/language switching; Playwright accessibility/responsive checks | Pass |
| Models and providers | Mock, SiliconFlow and Custom; quick/advanced mappings; discover/test/activate/delete | `/v1/model-config`, `/models`, connection-test and active-role endpoints | Non-secret profile JSON plus session/keyring credential | Unit/contract/Vitest/Playwright provider lifecycle in three viewports | Pass |
| Loading and empty states | Actionable loading, empty and partial-success presentation | Individual reads remain independently retryable | No synthetic success data | Playwright empty/partial/offline recovery and axe | Pass |
| HTTP and network errors | 401/403/404/429/500, timeout, cancel, retry, request ID and recovery | API middleware and ModelGateway error mapping | Structured JSONL exception log; no secret payloads | Backend error-response tests; Playwright offline/500 recovery | Pass |
| Desktop lifecycle | Random loopback startup, readiness wait, restart persistence, uninstall retention | Sidecar `/ready`, authenticated API and `/shutdown` | `%LOCALAPPDATA%\KnowTier` database/uploads/logs/backups | Rust tests, Sidecar Mock RAG smoke, Portable and installed-package two-start smoke | Pass |

## Defects fixed during acceptance

1. Windows WebView showed a black window because valid Tauri origins were rejected and the hidden
   window was reloaded before sidecar readiness.
2. `Qwen/Qwen2.5-7B-Instruct` was also assigned to Embedding; SiliconFlow correctly rejected its
   `/embeddings` request.
3. The frozen sidecar omitted `owlrl` distribution metadata and raised `PackageNotFoundError`.
4. Mixed Chinese/ASCII questions such as `什么是RAG` were tokenized incorrectly.
5. Auto-ingestion accepted only exactly one candidate instead of deterministically ranking several.
6. A full Knowledge Blueprint and Teacher schema was too large for short questions and caused
   timeout, `finish_reason=length`, malformed JSON or validation failures.
7. Provider errors collapsed to generic 500 and client retry could append a duplicate user turn.
8. A first `/models` refresh on an empty profile unexpectedly switched the UI into advanced mapping.
9. Workspace/Learner/Session/target changes could retain a stale local teaching view; the workbench
   now keys transient state by the complete active context and clears mismatched requests.
10. The three-column learning workbench could compress the composer or cover it with mobile
    navigation; the center column now owns a bounded viewport and the mobile editor honors the safe
    area and bottom navigation.
11. Selecting an existing attachment left its menu above the editor, and the full-stack test queried
    its old generic button role. Selection now closes the menu and the test uses the accessible
    `menuitemcheckbox` role.
12. The frontend Docker context included the complete Tauri target and Sidecar, sending 4.43 GB to
    Docker before a web-only build. `src-tauri` is now excluded; the verified context was 6.26 MB.
13. Runtime model badges exposed provider enum values such as `openai_compatible`; all visible model
    badges now use product-facing provider names.
14. A Vite hot update could temporarily split the application-context module and leave a blank
    development view; a safe global recovery surface now protects the desktop window from any
    unhandled render failure.
15. Small disconnected graphs auto-fitted close to maximum zoom, making long labels overlap; the
    graph now uses a readable small-graph layout, bounded auto-fit and a truthful zoom indicator.
16. Mobile quick teaching actions exposed a platform scrollbar over the composer, provider and
    ingestion states used overly technical language, and several empty/loading states lacked a
    clear next action; these surfaces now remain compact, actionable and screen-reader named.
17. Collapsing the desktop navigation only hid its labels while the content retained the expanded
    offset. The layout now reclaims 176 px and lets every page use the available width.
18. The learner graph treated storage IDs, backend enums and evidence-resource nodes as primary
    labels. A presentation projection now renders learner-facing relationships, mastery and
    evidence summaries, with raw identifiers available only in an advanced disclosure.
19. The learning workspace permanently displayed empty session, tool, graph-update and local
    preference panels. The primary surface now contains only the learning focus, conversation and
    editor; misconceptions, evidence and sources appear only when real data exists.
20. Backend enum strings and English-only labels leaked through several secondary pages. The UI now
    supports persistent Chinese/English selection and maps known backend values to reviewed product
    copy while using a neutral fallback for unknown values.
21. A freshly loaded model profile briefly exposed the new-profile form, so fast edits could be
    overwritten when profile hydration completed. The form now waits for deterministic selection
    and preserves user-authored profile names across Provider changes.
22. Creating a Learner could navigate before its context state committed; the route guard then sent
    the user back to setup. Navigation now occurs only after the created Learner is active.
23. Unexpected JavaScript and health-check errors could expose technical exception text as the main
    message. Only explicitly typed user-validation errors are shown verbatim; unknown failures use
    safe product copy and API details remain behind the technical disclosure.
24. Parent-relative Tauri resource paths produced duplicate `_up_/_up_` documentation in the first
    RC.4 Portable build. Resources now use explicit bundle targets, and CI rejects duplicates or any
    parent-relative resource directory.
25. The learner graph could still render multiple parallel arrows for different facts between the
    same two entities. The presentation now models entity nodes and node-pair relationship lines
    explicitly, consolidates every pair into one undirected line, and keeps the directional facts
    in the line detail.

The fixes preserve the existing graph, evidence, learner, revision and audit boundaries. Compact
model output is schema-validated and deterministically expanded; model-only facts remain
non-confirmed. No API or model output is accepted as arbitrary Cypher.

## Executed quality gates

| Command / gate | Observed result |
| --- | --- |
| `uv lock --check` | Pass |
| `uv run ruff format --check src tests scripts` and `uv run ruff check src tests scripts` | Pass |
| `uv run mypy src/cognigraph` | Pass, 107 source files |
| `uv run pytest` | Pass, 213 tests; 16 explicitly environment-gated live/production/performance tests skipped |
| Desktop pytest selection | Pass, 20 tests |
| Live PostgreSQL/Neo4j integration selection | Pass, 3 tests |
| `npm ci` | Pass, lock unchanged, 0 vulnerabilities reported |
| `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` | Pass; Vitest 31 files / 130 tests |
| `npx playwright test --config=playwright.config.ts` | Pass, 12/12 across desktop/tablet/mobile, including axe, keyboard, visual snapshots, provider security and network/HTTP recovery |
| `npx playwright test --config=playwright.full-stack.config.ts` | Pass, 1/1 in 36.6 s: React, FastAPI, PostgreSQL, Neo4j, Mock LLM and API-restart recovery |
| Rust `fmt --check`, `clippy -D warnings`, `test` | Pass; 3 Rust tests |
| Frozen Sidecar Smoke | Pass: ready, 401 anonymous, 200 authenticated, create Workspace/Learner, Mock RAG chat 200, graceful exit 0 |
| Portable RC4 package Smoke | Pass with two launches, persistence, documentation-layout validation and no orphan Sidecar |
| Installed RC4 NSIS package Smoke | Pass with two cold launches; silent uninstall and reinstall 0; App Data retained; post-reinstall smoke passed |

The production-shaped PostgreSQL/Neo4j/Mock full-stack passed locally against this candidate,
including an API container restart. Three-platform packaging remains configured in
`.github/workflows/release-desktop.yml`. The final handoff associates the GitHub-hosted matrix,
bounded live-provider run and Draft Release URL with the exact pushed RC.4 commit.

## Model configuration and credential security

- All model calls remain behind backend `ModelGateway`; the React client never calls a provider.
- SiliconFlow defaults to `https://api.siliconflow.cn/v1`, discovers models through `GET /models`,
  and separates generation and embedding selection.
- Teacher, Extractor, Grader, Graph, Vision and Embedding can be mapped independently. Quick setup
  applies one generation model while keeping Embedding separate.
- Custom endpoints require HTTPS; explicit local-provider opt-in is required for loopback HTTP.
- API keys are write-only from the UI, masked in API responses, and absent from localStorage,
  ordinary profile JSON, URLs, application logs, traces and screenshots.
- Desktop storage supports the operating-system credential vault; session-only storage and
  credential deletion are also available.

## SiliconFlow evidence

The opt-in live check discovered 91 models, completed an embedding request, and completed structured
Teacher output. A packaged candidate chat for `什么是RAG` returned HTTP 200 with a non-empty response,
assessment, selected target, domain revision and learner revision; repeating the same client request
ID returned the same response without a duplicate user turn. The optional read-only Graph model
suggestion failed in that run, while deterministic graph construction and Teacher output succeeded,
so the observation is partial success rather than a fully successful multi-role model run.

The live workflow is manual/`workflow_dispatch`, reads `SILICONFLOW_API_KEY` from GitHub Secrets,
discovers exact model IDs, limits discovery/chat/embedding calls and token output, uses zero retries,
and does not persist complete prompts or responses.

## Desktop architecture and artifacts

Tauri 2 owns the native window. It starts a PyInstaller FastAPI sidecar on a sidecar-selected random
`127.0.0.1` port, waits for authenticated readiness, then navigates and displays the React UI. API
traffic uses a separate per-process bearer secret, and shutdown is graceful. SQLite and rebuildable
semantic projection, uploads, logs and backups live in OS App Data rather than the install directory.
Server/PostgreSQL/Neo4j/Docker deployment remains available.

Locally verified unsigned Windows RC assets:

| Artifact | SHA-256 |
| --- | --- |
| `KnowTier-Setup-1.0.0-rc.5-windows-x64.exe` | `92F4C2CA17A95CBF54B56E8DB1D6FCCD883C5CDE6258C8472A5932E16566973E` |
| `KnowTier-Portable-1.0.0-rc.5-windows-x64.zip` | `E7B5585C7BFA8DDAEF057189BE255D9EE8784189918F91E2EFFBAACD5B1E54FD` |

These local assets and their evidence logs are under
`desktop-release-local-rc5/`; build outputs are intentionally not committed.
The local `SHA256SUMS.txt` for the installer and Portable ZIP was
verified immediately after packaging. GitHub Actions will
generate the cross-platform checksum manifest and locked Node/Python/Rust CycloneDX SBOMs for the
Draft Release; those files are not claimed as locally complete. Windows Authenticode status is
`NotSigned` for the installer, shell and Sidecar, and the assets include `UNSIGNED-windows.txt`.

## Remaining release limits

- Current Windows validation is local and isolated, not a separate clean Windows VM.
- Current macOS and Linux artifacts must be rebuilt by the fresh GitHub matrix; older Draft assets
  do not contain this candidate's fixes.
- The optional Graph suggestion can still degrade independently; the UI exposes partial success and
  deterministic graph semantics remain available.
- Vision capability is user-mapped but the connection test directly exercises Teacher structured
  output and Embedding; a provider can still reject an incorrectly chosen Vision model at runtime.
- The earlier opt-in SiliconFlow run remains valid evidence. The final handoff records the bounded
  RC.4 workflow run and its exact discovered-model result without persisting prompts or responses.
