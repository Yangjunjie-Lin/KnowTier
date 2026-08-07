# KnowTier v1 product acceptance matrix

Baseline: `b5f7ee1358105ebede35ed414acbbe61d47106ca` (`origin/main`, 2026-08-06)

This matrix is the release acceptance source of truth. `PASS` means the
referenced automated acceptance ran against the release candidate. `PARTIAL`
means the product path is implemented and lower-level checks pass, but one of
the requested packaged or fault-injection gates is still missing. `BLOCKED`
means an external prerequisite prevented the release-candidate gate; blocked
rows prevent promotion from Draft RC to v1.0.0.

| Surface / route | User-visible functions and states | Backend API | Authoritative data | Automated acceptance | Current status |
| --- | --- | --- | --- | --- | --- |
| Initialization `/init` | Create/connect workspace; create/connect learner; provisioning token is request-only; validation, loading, 401/403/409/network recovery | `POST /v1/workspaces`, `POST /v1/learners`, `GET /v1/learners/{id}` | `workspaces`, `learners`; non-secret recent context in device storage | `InitPage.test.tsx`, Playwright onboarding and deep-link suite | PASS |
| Overview `/overview` | Active learner/workspace summary, graph and mastery summaries, recent material, empty/partial/error states | graph manifest/export; learner model/evidence | graph revision, learner knowledge state, recent device documents | responsive/axe/visual page suite | PASS |
| Learning workspace `/learn` | Three-column tutor; mode and target selection; attachments/camera entry; send/cancel/retry/timeout; deduped submit; source, model change, misconception and evidence sections; mobile Learning Status Sheet | `POST /v1/chat`; learner model/evidence/graph detail | tutoring turns/sessions, model runs, learner evidence, learner graph revisions | `LearnPage.test.tsx`, insight hook tests, contract and full-stack Playwright | PASS |
| Materials `/materials` | Upload, drag/drop, camera entry, recent list, size/type validation, progress/error/empty state | `POST /v1/workspaces/{id}/documents`, `GET /v1/documents/{id}` | documents and App Data uploads | contract/full-stack upload suite plus responsive/keyboard/axe | PASS |
| Material detail `/materials/:documentId` | Ingest/re-ingest, extract knowledge, chunks, provenance, parser/OCR/vision status, partial warnings and retry | `POST /v1/documents/{id}/ingest`, `GET /v1/documents/{id}`, `/chunks`, `/extracted-knowledge` | document/chunk/source span/model run/graph revision | component blueprint tests, API integration, full-stack ingestion | PASS |
| Domain graph `/graph/domain` | Canvas interaction, node/assertion detail, list alternative, keyboard, filters, focus subgraph, full screen, export | graph manifest/subgraph/node/assertion/revisions/export | domain nodes/assertions/source spans/revisions and semantic projection | graph component/unit, API graph tests, Playwright canvas/list/export | PASS |
| Student graph `/graph/student` | Learner graph canvas/list, mastery/evidence detail, filters, keyboard, full screen | learner knowledge graph, node/assertion detail, revisions | learner assertions, evidence and learner graph revisions | graph component/API/full-stack tests plus accessibility flow | PASS |
| Personal model `/model` | Mastery/confidence/cognitive level, evidence links, filters, CSV export, empty/error states | `GET /v1/learners/{id}/model`, `/evidence`, `/model.csv` | learner knowledge state and evidence | learner API/integration, CSV safety, page Playwright | PASS |
| Learning path `/learning-path` | Select target, prerequisite order, blocked/ready/mastered status, stale revision notice, empty/error states | `GET /v1/learners/{id}/learning-path` | graph revision plus learner mastery | learning path unit/API and page tests | PASS |
| Domain versions `/history/domain` | Version list, detail drawer, graph changes and evidence provenance, empty/error states | graph revisions list/detail | graph revisions/change events/model runs | version component/API and full-stack persistence test | PASS |
| Learner versions `/history/learner` | Version list/detail, assertion lifecycle and evidence provenance | learner graph revisions list/detail | learner graph revisions/assertions/evidence | version component/API and full-stack persistence test | PASS |
| Global search | Search across knowledge, materials and learner state; keyboard open/close; empty/error states | bounded search API (no arbitrary Cypher) | scoped SQL and bounded semantic projection | API security + keyboard/axe/Playwright | PASS |
| Settings `/settings` | API health/readiness, theme/motion/density/teaching preferences, context reset | `/health`, `/ready` | non-secret device preferences | `SettingsPage.test.tsx`, responsive/axe/visual suite | PASS |
| Models & providers `/settings` | Mock, SiliconFlow, Custom OpenAI-compatible; masked/session/keyring credential; model discovery/search; connection test; unified/role mapping; timeout/retry/temperature/max tokens; activate/delete | `/v1/model-config/*`; provider `GET /models` through backend only | non-secret profile store; API key in process memory or OS credential vault | provider contract, masked API, frontend component, Playwright settings flow, explicitly dispatched live SiliconFlow discovery/chat/embedding smoke | PASS |
| Theme and typography | Light/dark/system, reduced motion, font size, contrast and focus visibility | none | device preferences, never credentials | Vitest plus visual snapshots and axe in all viewports | PASS |
| Responsive shell | Sidebar/top bar, mobile bottom nav, sheets/dialogs, no horizontal overflow or covered composer | all page APIs | current context and query cache | Playwright projects at 1440x900, 1024x768, 390x844 | PASS |
| Error and recovery | Loading/empty/partial, timeout, 401/403/404/429/500, offline and recovery, local retry without losing successful panels | all APIs | query cache keyed by workspace/learner/session/target | route interception matrix, retry and offline Playwright | PARTIAL |
| Desktop first run | Sidecar boot, authenticated ready handshake, onboarding, Mock full flow, App Data persistence | local FastAPI on random `127.0.0.1` port | App Data SQLite/uploads/logs; rehydratable semantic projection | packaged sidecar/lifecycle/install smoke on Windows NSIS/portable, macOS DMG, Linux AppImage/Debian | PASS |
| Desktop upgrade/uninstall | Migration and retained data; no orphan sidecar; uninstall policy is visible | local operational endpoints | App Data retained by default unless user deletes it | installed-upgrade/uninstall/orphan process tests | PARTIAL: lifecycle fixtures pass; installed upgrade/uninstall not yet run |

## Cross-cutting invariants

- Model output is accepted only after the existing Pydantic schema validation;
  model-generated facts without external evidence remain non-confirmed.
- No API or model output can submit arbitrary Cypher.
- Workspace, learner, session and target changes invalidate mismatched UI state
  and query-cache keys.
- API keys and desktop process tokens never enter localStorage, URLs, request or
  model traces, screenshots, logs, Git, or non-secret configuration files.
- A release row is not satisfied by a skipped test, a development-only server,
  or an unpackaged executable.

## Release gate commands

The final report records exact versions, exit codes and counts for these gates:

```text
uv lock --check
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run mypy src/cognigraph
uv run pytest tests/unit tests/contract -m "not postgres and not neo4j and not ocr and not live_model"
uv run pytest tests/integration tests/e2e -m "not postgres and not neo4j and not ocr and not live_model"
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
docker compose -f docker-compose.e2e.yml up --detach --build --wait
npx playwright test --config=playwright.full-stack.config.ts
```
