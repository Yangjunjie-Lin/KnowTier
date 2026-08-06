# Changelog

All notable changes to KnowTier are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning.

## [Unreleased]

### Changed

- Desktop installers are held as draft releases until a maintainer has verified every platform
  artifact, checksum, SBOM, and signing-status record.

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

[Unreleased]: https://github.com/Yangjunjie-Lin/KnowTier/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/Yangjunjie-Lin/KnowTier/releases/tag/v1.0.0-rc.1
