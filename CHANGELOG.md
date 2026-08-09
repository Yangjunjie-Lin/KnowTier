# Changelog

All notable changes to KnowTier are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning.

## [Unreleased]

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

[Unreleased]: https://github.com/Yangjunjie-Lin/KnowTier/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.1
