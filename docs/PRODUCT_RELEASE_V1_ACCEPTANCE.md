# KnowTier v1.1.0 product acceptance record

This record describes the current stable KnowTier desktop release. The authoritative source is
commit `11c8f93225397c5f66f7fb2920efbe796fc0ac8b`, merged through
[PR #29](https://github.com/Yangjunjie-Lin/KnowTier/pull/29), tagged `v1.1.0`, and published on
2026-08-30 at <https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.1.0>.

Only checks that actually ran are recorded as passing. Optional paid-provider coverage is kept
separate from credential-free release acceptance.

## Release outcome

| Gate | Authoritative evidence | Result |
| --- | --- | --- |
| Source integration | PR #29 into `main` | Pass; 7 remote check runs succeeded |
| Offline quality and version gate | [Desktop release run 33282195693](https://github.com/Yangjunjie-Lin/KnowTier/actions/runs/33282195693) | Pass |
| Real production-shaped browser workflow | React → FastAPI → PostgreSQL → Neo4j → Mock LLM in the release run | Pass |
| Windows x64 | NSIS install smoke and Portable archive lifecycle | Pass |
| macOS Intel x64 | DMG build, architecture check, mount and application smoke | Pass |
| Linux x64 | AppImage execution and installed Debian-package smoke | Pass |
| Release integrity | 18 uploaded assets, 17 SHA-256 entries, three validated CycloneDX SBOMs | Pass |
| Post-release acceptance | [Release-check run 33283654352](https://github.com/Yangjunjie-Lin/KnowTier/actions/runs/33283654352) | Pass; live-model gate, real OCR, and Compose jobs succeeded |

The packaging run intentionally did not dispatch the optional paid SiliconFlow smoke. Provider
compatibility remains covered by the offline OpenAI-compatible contract; a paid live call requires
an explicit manual run and repository secret.

## What changed in v1.1.0

- Added a deterministic learner plan that ranks misconceptions, due review, prerequisites,
  foundation repair, and continued practice into one explainable focus plus alternatives.
- Unified Overview, Learning Path, and Learn around a 20-minute
  **Activate → Build → Check** agenda.
- Added explicit turn intents so hint, example, re-explanation, self-report, and meta requests do not
  become assessment evidence or postpone review.
- Separated the assessed knowledge point from the next teaching target, preventing prerequisite
  redirection from attaching evidence or misconceptions to the wrong topic.
- Made teaching, practice, review, exam, and research modes deterministic policies and required the
  newest independent evidence to pass before mastery promotion.
- Reworked the responsive learner journey around one best next action, one mastery check, clear
  evidence provenance, and desktop/tablet/mobile accessibility.
- Unified hot- and cold-cache document chunk responses behind a strict public schema that excludes
  embeddings, normalized text, source IDs, and internal indexing metadata.

No arbitrary Cypher surface was added and no release-specific schema migration was required for the
adaptive workflow change.

## User-facing acceptance boundary

| Surface | Stable v1.1.0 behavior | Acceptance evidence |
| --- | --- | --- |
| First launch | Create or resume a workspace and learner without deployment identifiers | component and three-viewport Playwright coverage |
| Overview | Explain one recommended learning action and its 20-minute agenda | learning-plan unit tests, responsive visual snapshots, axe checks |
| Learning Path | Show focus, rationale, next milestone, alternatives, prerequisites, and status | plan API/unit tests and route-state coverage |
| Learn | Route support requests separately from answers; teach and assess one target at a time | routing/controller tests, frontend tests, API and full-stack E2E |
| Materials | Upload, ingest, retry, inspect provenance, and expose only the public chunk contract | contract, integration, OCR, and production-shaped browser tests |
| Knowledge and learner graphs | Preserve sources, assertions, evidence, direction, and immutable revisions | graph/export tests, keyboard list view, responsive browser coverage |
| Models and settings | Keep provider traffic behind ModelGateway; support Mock, SiliconFlow, and custom OpenAI-compatible profiles | provider contract, masked-credential API tests, settings E2E |
| Desktop lifecycle | Random authenticated loopback service, App Data persistence, upgrade backup, clean shutdown | sidecar, installed-package, restart, and orphan-process smoke |

## Executed quality gates

The final local release preparation observed:

- Ruff format and lint: pass across 195 files.
- Strict mypy: pass across 110 source files.
- Backend credential-free suite: 248 passed, 16 explicitly deselected external/optional tests.
- Frontend Vitest: 35 files and 169 tests passed.
- Frontend typecheck, ESLint, and production Vite build: pass.
- Playwright UI suite: 15/15 across 1440×900, 1024×768, and 390×844.
- `uv lock --check`, Cargo formatting, and locked Cargo metadata: pass.
- Python, npm, Tauri, Cargo, lockfile, and workflow version contracts: all `1.1.0`.

GitHub repeated the offline gates on the exact `main` commit before packaging. The release workflow
then repeated sidecar authentication, lifecycle, installed-package, and real full-stack checks on
hosted Windows, macOS, and Linux runners.

## Integrity, SBOM, and signing record

The published release contains:

- `KnowTier-Setup-1.1.0-windows-x64.exe`
- `KnowTier-Portable-1.1.0-windows-x64.zip`
- `KnowTier-1.1.0-macOS-x64.dmg`
- `KnowTier-1.1.0-linux-x64.AppImage`
- `knowtier_1.1.0_amd64.deb`
- `SHA256SUMS.txt`
- Node.js, Python, and Rust CycloneDX SBOMs
- license, privacy, changelog, desktop guide, Chinese user guide, and third-party notices
- one explicit signing-status record for each platform

The checksum manifest covers every published asset except itself and matched GitHub's stored asset
digests during final review. The validated SBOMs contain 168 Node.js, 116 Python, and 475 Rust
components.

No platform signing credentials were configured. The release therefore publishes
`UNSIGNED-windows.txt`, `UNSIGNED-macos.txt`, and `UNSIGNED-linux.txt`. Checksums prove file integrity
against the release manifest but do not establish publisher identity.

## Security and evidence invariants

- Facts created from model output without external evidence remain non-confirmed.
- Only schema-validated model output enters domain services.
- No API or model response may submit arbitrary Cypher.
- Learner, workspace, session, target, source, and revision boundaries remain explicit.
- Mastery promotion requires valid independent evidence; support requests and self-reports do not
  inflate evidence or delay review.
- Provider credentials and desktop process tokens stay out of URLs, localStorage, logs, traces,
  screenshots, Git, and ordinary profile JSON.
- React never contacts a model provider directly; all provider traffic passes through the backend
  ModelGateway.

## Known limitations

- Windows, macOS, and Linux assets are unsigned unless a future release explicitly states otherwise.
- The macOS artifact targets Intel x64; Apple Silicon users may require Rosetta.
- OCR and vision are optional large capabilities and depend on the selected runtime/provider.
- Uninstall intentionally retains App Data; complete deletion is a separate documented action.
- The default Mock Provider validates the workflow but is not a claim of production model quality.

## Final identity

- Git tag: `v1.1.0`
- Source commit: `11c8f93225397c5f66f7fb2920efbe796fc0ac8b`
- Release: <https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.1.0>
- Packaging evidence: <https://github.com/Yangjunjie-Lin/KnowTier/actions/runs/33282195693>
- Post-release evidence: <https://github.com/Yangjunjie-Lin/KnowTier/actions/runs/33283654352>
- Signing status: `UNSIGNED` for Windows, macOS, and Linux
