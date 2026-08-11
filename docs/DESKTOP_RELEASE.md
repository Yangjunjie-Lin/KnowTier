# Desktop release runbook

The desktop workflow builds platform-native artifacts only after its offline quality gate succeeds.
It creates a GitHub **draft** release so a maintainer can inspect the binaries, SBOM, checksums, and
signing evidence before anything is published.

## Trigger and version contract

`.github/workflows/release-desktop.yml` runs for `v*` tags and through `workflow_dispatch`.

- A pushed tag performs the gate, builds all platforms, and creates or refreshes a draft release.
- A manual run always performs the gate and builds. Set `create_draft_release` only when the run
  should create a draft, and provide the intended `v<semver>` tag. The current candidate is
  `v1.0.0-rc.5`.
- Set `run_live_siliconflow` only for an intentional paid-provider smoke test. It is impossible for
  that job to run from a tag or other automatic event.

The release tag and all Python, npm, Tauri, and Cargo manifests and lockfiles must describe
`1.0.0-rc.5` (the Python lock uses its normalized PEP 440 spelling). Update the changelog and
privacy notice when their contents change, commit the release state, then create
`v1.0.0-rc.5` from that reviewed commit. Release tags are immutable: if a candidate tag already
exists at another commit, increment the RC version instead of moving the tag.

## Quality gate and build matrix

The gate uses Python 3.12, Node.js 22, frozen Python and npm locks, backend formatting/lint/type
checks, offline unit/contract/SQLite-backed integration and workflow tests, frontend
type/lint/unit/build checks, and the API-contract browser smoke. Default tests must not contact a
model provider, PostgreSQL, or Neo4j. The Tauri packaging CLI and PyInstaller are version-pinned by
the workflow; runtime dependencies come from the repository locks. Each packaging runner depends on
that gate:

Each platform build also executes the packaged sidecar: it verifies the authenticated readiness
handshake, rejects anonymous UI access, serves the authenticated React entry point, and exits with
code zero after the graceful shutdown request. Tauri keeps the React UI on its stable application
origin and forwards only `/api` fetches to the random loopback port announced over the captured
sidecar control pipe.

- `windows-latest`: Tauri `nsis` bundle plus a ZIP made from the release executable and its sidecar
- `macos-15-intel`: Tauri `dmg` bundle for x86-64 (Intel runner; the sidecar architecture is asserted)
- `ubuntu-latest`: Tauri `appimage` and `deb` bundles for x86-64

Artifacts from the three isolated runners are joined only in the release job. That job refuses to
continue if any required format or platform signing-status record is missing.

## Signing and notarization

Configure these encrypted repository secrets when signed candidates are required:

| Platform | Secrets | Result when absent |
| --- | --- | --- |
| Windows | `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD` | No certificate is imported and `UNSIGNED-windows.txt` is emitted |
| macOS | `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD` | No signing identity is imported and `UNSIGNED-macos.txt` is emitted |
| macOS notarization | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | The status record says notarization credentials are incomplete |
| Linux | No repository signing key is currently consumed | `UNSIGNED-linux.txt` is always emitted; use checksums for integrity |

The certificate secrets contain base64-encoded PKCS#12 data. The workflow imports them into an
ephemeral runner keychain or certificate store and deletes the temporary certificate file. Never
place certificates, passwords, API keys, or notarization credentials in the workflow file, npm
configuration, logs, artifacts, or release notes. Environment values are passed only to the relevant
runner step.

A signed status record is build evidence, not a substitute for inspection. On Windows, inspect both
the NSIS and portable signatures. On macOS, verify the code signature and Gatekeeper assessment:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/KnowTier.app
spctl --assess --type execute --verbose=2 /Applications/KnowTier.app
```

## SiliconFlow paid smoke boundary

The SiliconFlow job has three independent gates: the event must be `workflow_dispatch`, the
`run_live_siliconflow` boolean must be selected, and the `SILICONFLOW_API_KEY` repository secret must
be present. The key is never used by tag, push, pull-request, or release events.

The smoke dynamically discovers one chat model and one embedding model so it does not depend on a
stale model identifier. Its entire external budget is one model-list request, one fixed structured
chat prompt, and one single-text embedding request. It disables streaming and tools, makes no retries,
sets a short per-request and job timeout, and caps the chat output at 96 tokens. This is a
connectivity/schema smoke, not an evaluation suite and not permission to process user documents. A
missing key fails the explicitly requested job rather than silently reporting success.

For a deliberate model-specific check, set the optional `siliconflow_chat_model` dispatch input.
The smoke still fetches `/models` first and fails without making the chat request if the exact model
ID is unavailable. The embedding model remains capability-discovered so the workflow never embeds a
provider model catalog in source control.

SiliconFlow embedding models use their native output width because several otherwise compatible
models reject OpenAI's optional `dimensions` request field. Vectors narrower than KnowTier's
1536-wide store are zero-padded before persistence; this preserves their dot products, norms, and
cosine similarity. Empty vectors and vectors wider than the configured store are rejected rather
than truncated.

## SBOM, checksums, and draft release

After all builds pass, the release job:

1. downloads the five expected installers/packages and three signing-status records;
2. generates and validates CycloneDX JSON SBOMs from the locked Rust, Node.js, and Python dependency
   trees (CycloneDX 1.5 for Rust and Python, and 1.6 for Node.js);
3. writes `SHA256SUMS.txt` over every release asset except the checksum file itself and immediately
   verifies the completed manifest;
4. creates a new draft release, or refreshes an existing draft for the same tag; it never publishes
   a release and refuses to replace assets if the tag already names a published release.

The workflow refuses to replace assets on an already published release. A maintainer should then:

1. download the draft assets into a clean machine and verify `SHA256SUMS.txt`;
2. compare the artifact list with the five-format matrix;
3. inspect the CycloneDX SBOM and resolve unacceptable licenses or vulnerabilities;
4. confirm every signing-status record, and independently verify platform signatures where present;
5. review the CI packaged smoke results for first launch, restart, App Data state creation, and
   orphan-sidecar cleanup; then manually verify upgrade backup, uninstall behavior, and clean
   shutdown of the local service on a clean machine;
6. review generated notes and `CHANGELOG.md`, then publish the draft manually.

Keep a draft when any artifact is unsigned unexpectedly, a checksum differs, an SBOM is missing, or
a platform smoke fails. Publishing is a deliberate maintainer action and is not performed by the
workflow.
