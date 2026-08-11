# Changelog

All notable changes to KnowTier are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning.

## [Unreleased]

## [1.0.0-rc.4] - 2026-08-10

### Added

- Added a persistent Chinese / English interface selector to first-run setup, the application
  header, settings, learning, graphs, materials, progress, paths, history, search, and shared
  loading/error surfaces.
- Added learner-facing presentation adapters for backend statuses, entity types, relationships,
  evidence kinds, providers, and model roles; unknown values now use neutral product language.

### Changed

- Reclaimed the full desktop content width when the sidebar is collapsed, including reduced-motion
  handling and a regression test for the 240 px to 64 px layout change.
- Rebuilt the learner knowledge graph around mastery, attention and natural-language learning links,
  with a relationship-first canvas/list view and internal identifiers confined to an advanced
  technical disclosure.
- Consolidated multiple active relationships between the same two learner nodes into one straight,
  selectable line; the line detail now expands into readable directions, evidence, confidence and
  history without adding labels to the default canvas.
- Added explicit learner-graph ontology metadata for entity nodes and node-pair relationship lines;
  each line now carries its ontology category and relation facts, uses a clean undirected visual,
  and remains deduplicated even if duplicate raw edges reach the canvas.
- Simplified the learning workspace to the active focus, tutoring conversation and editor. Empty
  session, tool, graph-update, preference, evidence and source sections no longer occupy the main
  workspace; generated progress is available on demand.
- Hid decorative horizontal scrollbars on mobile action, tab and relationship-filter strips while
  preserving keyboard and touch scrolling.

### Fixed

- Built the Windows desktop shell as a GUI-subsystem executable so double-clicking the app no
  longer opens a terminal window; the release gate now rejects a console-subsystem main binary.
- Prevented model-profile hydration from overwriting fast user edits, and preserved custom profile
  names when switching Providers.
- Delayed the post-setup overview transition until the created Learner context is active, avoiding
  a route-guard bounce back to initialization.
- Separated explicitly safe client validation messages from unexpected JavaScript errors so input
  guidance remains specific without exposing internal exception text or health errors.
- Mapped Tauri documentation resources to explicit bundle targets and made release assembly reject
  duplicate or parent-relative Portable resource directories.
- Localized shared mastery/confidence labels, sheet close actions, graph fallback labels and status
  text that could remain Chinese after switching the interface to English.
- Updated the real PostgreSQL/Neo4j/Mock full-stack browser flow to open the new learning-details
  tabs before asserting prerequisites, misconceptions and evidence, including after API restart.
- Made the live SiliconFlow smoke skip safely in ordinary offline pytest runs while retaining the
  explicit opt-in, secret requirement and bounded external request budget.
- Refreshed reviewed Windows visual baselines for the focused learning workspace and bilingual
  overview without loosening screenshot thresholds.

## [1.0.0-rc.3] - 2026-08-10

### Changed

- Simplified first-run setup, overview, materials, graph, learner model, learning path, version,
  search, and provider screens around learner-facing language and clear next actions.
- Made mobile graph views list-first, moved implementation identifiers into collapsed technical
  details, and localized graph relationships and model-role labels.
- Refreshed the Windows desktop, tablet, and mobile visual contracts after manual review at
  1440×900, 1024×768, and 390×844.
- Standardized the application shell, focus states, dark semantic colors, safe-area handling,
  learner-facing empty states, ingestion summaries, and provider guidance for a cleaner,
  lower-friction desktop and mobile experience.

### Fixed

- Preserved the active Workspace request scope across Vite hot reloads, page refreshes, and deep
  links so initialization can immediately create a learner and later API calls cannot lose their
  tenant header.
- Corrected theme-button accessibility semantics, document-detail tab semantics, graph keyboard
  labels, mobile search controls, and mobile learning-composer clearance.
- Prevented credential-less provider profiles from appearing connected and kept generation and
  embedding model choices visibly separate.
- Updated the full-stack browser contract for the simplified onboarding and accessible material
  tabs while retaining the strict two-knowledge-point Mock tutoring and API-restart assertions.
- Added a safe whole-application recovery surface so a runtime view failure cannot leave a blank
  desktop window, and hardened IME submission, draft-discard confirmation, model export, and
  loading/retry feedback.
- Prevented small disconnected graphs from over-zooming until long node labels overlap, removed
  invalid Cytoscape selectors and hardware-specific wheel sensitivity, and kept the keyboard-first
  list view available at every size.

## [1.0.0-rc.2] - 2026-08-09

### Added

- Added a user-visible Model Provider center for Mock, SiliconFlow, and custom
  OpenAI-compatible endpoints with dynamic `/models` discovery, separate generation and embedding
  selections, per-role mappings, connection tests, retry/timeout controls, and masked credential
  state.
- Added provider contract coverage for structured chat, streaming, embeddings, rate limits,
  invalid credentials/models, timeouts, malformed responses, and schema-validated multimodal
  Vision requests without contacting a paid provider.
- Added packaged Mock RAG chat, desktop logging, idempotent retry, accessibility, keyboard, and
  three-viewport visual regression coverage.

### Changed

- Desktop installers are held as draft releases until a maintainer has verified every platform
  artifact, checksum, SBOM, and signing-status record.
- Live SiliconFlow validation can target an explicitly requested chat model after verifying the
  exact ID through `/models`; embedding models remain capability-discovered.
- SiliconFlow native embedding vectors narrower than the 1536-wide store are zero-padded without
  changing their dot products, norms, or cosine similarity.
- Short tutoring questions use compact validated model schemas and deterministic expansion while
  preserving unverified-fact, graph-version, evidence, and audit semantics.
- GitHub-hosted workflows use the latest verified stable Node 24 action runtimes, and desktop draft
  creation refuses to move an existing release tag to another commit.
- Graph rendering and markdown/math rendering are emitted as independent production chunks so the
  learning workspace stays below Vite's 500 kB chunk budget.
- Inter and JetBrains Mono are bundled as offline variable fonts so web, CI, and desktop builds use
  deterministic typography instead of platform-specific Linux font fallbacks.

### Fixed

- Allow the packaged desktop shell enough time to initialize WebView2 on a clean Windows profile,
  while retaining bounded failure handling and Sidecar cleanup.
- Make the graph drawer keyboard contract wait for focus readiness before exercising Escape, avoiding
  a race with the dialog's dismiss listener without weakening the accessibility assertion.
- Treat a missing release tag as absent even when GitHub CLI returns a structured API error body,
  so a validated manual RC run can create its immutable tag and Draft Release.

- Fixed the Windows desktop black window caused by an over-restrictive WebView navigation policy
  and a startup race that reloaded the hidden window before the sidecar was ready.
- Fixed `什么是 RAG` failures caused by Chinese/ASCII tokenization, multi-candidate target
  selection, chat models being used for embeddings, missing frozen `owlrl` metadata, oversized
  teacher schemas, and malformed provider responses.
- Fixed duplicate user turns on retry by reusing a stable client request ID and cached successful
  response, while retaining actionable request IDs for server failures.
- Fixed new provider profiles switching unexpectedly from quick configuration to advanced mapping
  after the first model refresh.

### Security

- Provider keys remain server-side, are masked in API responses, are excluded from browser storage,
  URLs, logs, traces, screenshots, and ordinary profile files, and can use an OS credential vault or
  session-only storage.
- Desktop navigation remains limited to Tauri application origins and the authenticated random
  loopback sidecar; provider failures are mapped to bounded, non-secret error responses.

## [1.0.0-rc.1] - 2026-08-06

### Added

- Native KnowTier desktop shell with a bundled loopback-only application service and durable,
  per-user SQLite storage.
- First-launch initialization, transactional schema upgrades, and a database backup before any
  desktop schema migration.
- Windows NSIS installer and portable ZIP, macOS DMG, and Linux AppImage and Debian package.
- SHA-256 checksums and CycloneDX JSON software bills of materials for the locked Rust, Node.js, and
  Python dependency sets alongside every draft desktop release.
- Explicit `UNSIGNED` build records whenever the required Windows or macOS signing credentials are
  unavailable. Linux packages are accompanied by an unsigned-status record and checksums.
- Offline quality gates before packaging and an opt-in, manually dispatched SiliconFlow smoke test
  limited to one discovery, one structured chat, and one embedding request, with zero retries, a
  short timeout, and a hard chat-output token limit.

### Security

- The sidecar binds its own random loopback port, authenticates one readiness handshake, and protects
  API traffic with a separate per-process bearer secret; secrets travel through inherited environment
  and request headers, never command-line arguments or URLs.
- Tauri keeps React on a stable native origin, forwards only `/api` fetches, and enforces one native
  instance plus an independent OS lock on the desktop data directory.
- Mutable desktop data is kept outside the installed application, in the operating system's
  per-user application-data directory.

[Unreleased]: https://github.com/Yangjunjie-Lin/KnowTier/compare/v1.0.0-rc.4...HEAD
[1.0.0-rc.4]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.4
[1.0.0-rc.3]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.1
