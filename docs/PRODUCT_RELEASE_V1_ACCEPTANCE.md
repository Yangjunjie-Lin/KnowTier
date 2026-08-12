# KnowTier v1.0.0 product acceptance record

This record is the release gate for the first general-availability build. The remote `main` baseline
at the start of final acceptance was `0f808f30de1ca1ba06e91b4f6b0ecc3e7240b2d5`; the final release
SHA and GitHub Release URL are recorded after the immutable tag and cross-platform workflow finish.
Only checks that actually ran are marked as passing.

## Page — function — API — data — test matrix

| Page / state | User-visible function | Real API chain | Durable / derived data | Executed coverage | Result |
| --- | --- | --- | --- | --- | --- |
| First launch | Create Workspace/Learner and restore deep links | `POST /v1/workspaces`, `POST /v1/learners` | Workspace, Learner, current context | Vitest plus three-viewport Playwright | Pass |
| Overview | Mastery, review, evidence, graph summary | learner/domain reads | SQL learner state and revisions | Playwright navigation, axe, visuals | Pass |
| Learning | Tutoring, target/session switching, status on demand | `POST /v1/chat`, active Teacher, insight reads | Turns, evidence, misconceptions, learner/domain revisions | Vitest duplicate/cancel/retry/context plus Contract/full-stack E2E | Pass |
| Materials | Upload, camera entry, ingest, retry | document upload and ingest | App Data upload, chunks, provenance, report | Vitest failures plus real full-stack ingestion | Pass |
| Extraction | Schema-validated grounded knowledge extraction | ModelGateway Extractor | non-confirmed facts remain unverified without evidence | unit, provider contract, integration, Mock RAG | Pass |
| Domain graph | Canvas/list, keyboard, filter, fullscreen, export, details | domain graph/detail/export | versioned nodes, assertions, sources | Playwright, backend graph/export, production E2E | Pass |
| Student graph | One line per node pair and ontology fact details | learner graph/node/assertion/revision | mastery/evidence projection and immutable revisions | Vitest, three-viewport E2E, real browser verification | Pass |
| Personal model | Mastery, evidence, misconceptions, partial reads | learner model/evidence | audited mastery and evidence | Playwright success/failure/retry and Vitest | Pass |
| Learning path | Select target without stale state | learning-path plus chat target | derived path | Playwright and session-isolation unit tests | Pass |
| Versions | Domain/learner history and readable details | revision list/detail | immutable revisions and audit metadata | Playwright, Vitest, production restart recovery | Pass |
| Search | Ctrl/Cmd+K and ranked navigation | global search | derived ranked results | three-viewport keyboard/axe/visual E2E | Pass |
| Settings | Language, theme, density, font, health, preferences | health/ready plus local preferences | non-secret browser preferences | Vitest and Playwright | Pass |
| Models | Mock, SiliconFlow, Custom; discovery/test/activate/delete | backend model-config and `/models` proxy | non-secret profiles plus session/keyring credential | unit, contract, API, three-viewport provider E2E | Pass |
| Errors | Loading, empty, partial, timeout, offline, 401/403/404/429/500 | structured API errors and retries | request IDs and sanitized JSONL logs | backend errors plus Playwright recovery | Pass |
| Desktop | Random loopback boot, first run, persistence, upgrade, shutdown | authenticated local ready/API/shutdown | App Data SQLite/uploads/logs/backups | pytest desktop, Rust, Sidecar, Portable and installed-package Smoke | Pass |

## Defects fixed during final acceptance

1. Learner graphs with two knowledge nodes on the same concentric ring could calculate extreme
   coordinates and render an empty canvas. The layout now uses a safe node-count sweep and reflows
   when the WebView/container size becomes stable.
2. Multiple learner facts between one entity pair could appear as overlapping lines. The final
   Cytoscape boundary now guarantees one undirected presentation line while retaining every
   directional fact, confidence, evidence, history, and ontology category in the detail view.
3. Production HTTP Smoke could be intercepted by a workstation system proxy even though it targets
   localhost. The test client now ignores environment proxy settings for both initial and recovery
   phases.
4. Production Smoke assumed the ingestion revision remained the newest after teaching. Chat may
   legitimately create a newer graph-model revision, so acceptance now checks that the ingestion
   revision remains present and directly auditable.
5. Version replacement left two Python files with non-canonical line endings/format. Ruff formatting
   was restored, and generated local evidence/package directories are ignored without removing them.

These fixes preserve the graph, evidence, learner, revision and audit boundaries. Model output stays
schema-validated with deterministic fallback; unsupported facts remain non-confirmed. No API or model
output is accepted as arbitrary Cypher.

## Executed quality gates

| Command / gate | Observed result |
| --- | --- |
| `uv lock --check` | Pass |
| Ruff format/lint and strict mypy | Pass; 107 typed source files |
| `uv run pytest` | Pass; 215 passed, 16 explicit external/performance/OCR/live skips |
| OpenAI-compatible Provider Contract | Pass; chat, stream, JSON, embedding, timeout, 429, invalid key/model, malformed response |
| `npm ci` | Pass; 0 vulnerabilities reported |
| Frontend typecheck/lint/Vitest/build | Pass; 31 files, 132 tests, production build |
| Playwright Contract E2E | Pass; 12/12 at 1440×900, 1024×768, 390×844 with axe, keyboard, visuals, provider security, network/HTTP recovery |
| Rust GNU `fmt` and `test` | Pass; 3/3 desktop shell tests |
| Compose validation | Pass for production and E2E manifests |
| PostgreSQL/pgvector boundary | Pass; 2/2 |
| Live Neo4j repository boundary | Pass; 1/1 |
| Real React→FastAPI→PostgreSQL→Neo4j→Mock LLM | Pass; ingestion, tutoring, graphs, versions and API restart persistence |
| Production API Smoke and restart recovery | Pass after proxy isolation; both phases pass |
| Frozen Sidecar Smoke | Pass: ready, anonymous 401, authenticated 200, Workspace/Learner, Mock Chat, graceful exit |
| Windows Portable/installed package Smoke | Pass on stable v1.0.0: two cold launches, persistence, GUI subsystem, no orphan Sidecar, silent uninstall retaining App Data, reinstall, and post-reinstall smoke |

The release workflow repeats the offline gate and real full-stack suite before building each platform.
The final GitHub-hosted matrix is authoritative for macOS/Linux packages and stable-version checksums.

## LLM configuration and credential security

- All calls remain behind backend `ModelGateway`; React never contacts a provider.
- SiliconFlow defaults to `https://api.siliconflow.cn/v1`, discovers `/models` dynamically, and
  separates generation and embedding capability selection.
- Teacher, Extractor, Grader, Graph, Vision, and Embedding support quick or role-specific mapping.
- Custom endpoints require HTTPS; explicit local-provider opt-in is required for loopback HTTP.
- Keys are write-only, masked in responses, and absent from localStorage, URLs, logs, traces,
  screenshots, Git, and ordinary profile JSON.
- Desktop uses the OS credential vault where available and also supports session-only credentials and
  explicit deletion.

The bounded live SiliconFlow workflow is manual-only, reads `SILICONFLOW_API_KEY` from GitHub
Secrets, performs model discovery plus one structured chat and one embedding request, uses zero
retries and a hard token cap, and does not persist full prompts or responses. The previously executed
provider check was partially successful for Teacher/Embedding while Graph suggestion degraded safely;
it is not represented as complete multi-role validation.

## Desktop architecture and release artifacts

Tauri 2 owns the native window and starts a PyInstaller FastAPI sidecar. The service selects a random
`127.0.0.1` port, uses one-time bootstrap plus per-process control tokens, waits for authenticated
readiness, and shuts down gracefully. SQLite and rebuildable semantic projection, uploads, logs, and
backups live in per-user OS App Data. Server/PostgreSQL/Neo4j/Docker deployment remains supported.

Stable artifact hashes are generated by the final cross-platform workflow and published in the
release's `SHA256SUMS.txt`. Each release also includes Node/Python/Rust CycloneDX SBOMs, changelog,
license/privacy material, and explicit signing-status records. No signing certificate is configured
for this release; assets must be labelled `UNSIGNED`, never represented as signed.

Locally verified Windows artifacts before the independent GitHub-hosted rebuild:

| Artifact | SHA-256 |
| --- | --- |
| `KnowTier-Setup-1.0.0-windows-x64.exe` | `5ecfeb7cb378f69d99c302ca7ba70cd9a04bb314c50fa11ea1425a37d3decddc` |
| `KnowTier-Portable-1.0.0-windows-x64.zip` | `343ec85bd4705814a595b57a013ac084bd272c8d7f64bca8cb191f781d84928c` |

They are under an ignored local `desktop-release-v1.0.0-final-secure/` directory. GitHub-hosted artifacts will
have different reproducible-build hashes and are the authoritative public downloads.

## Known limitations

- Windows, macOS, and Linux artifacts are unsigned unless their release record explicitly says
  otherwise; operating-system warnings are expected and checksums do not establish publisher identity.
- macOS output is Intel x64, not Apple Silicon native. Apple Silicon users may require Rosetta.
- OCR and Vision are optional large runtimes/capabilities. The default desktop remains lightweight;
  image/provider capability depends on the configured model and platform runtime.
- Uninstall keeps App Data intentionally to prevent silent learner-data loss; complete removal is a
  separate documented user action.
- The Graph model can degrade independently; deterministic graph construction and explicit partial
  success remain available.
- The Linux Tauri 2 build transitively retains `glib 0.18.5` through the current GTK3/WebKit stack,
  which is reported by GHSA-wrw7-89jp-8q8g. KnowTier does not use the affected `VariantStrIter` API;
  no compatible `glib 0.20` upgrade exists in Tauri 2.11.5, so the advisory remains visible until the
  upstream desktop stack migrates.

## Final release identity

- Baseline remote `main`: `0f808f30de1ca1ba06e91b4f6b0ecc3e7240b2d5`
- Final release SHA: recorded after merge
- GitHub Actions desktop-release run: recorded after completion
- GitHub Release: <https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0>
- Signing status: `UNSIGNED` unless the final platform record states otherwise
