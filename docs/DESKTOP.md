# KnowTier desktop guide

KnowTier Desktop packages the web interface and its application service as one local-first app. The
desktop service chooses and binds a random loopback port itself, uses process-scoped control tokens,
and stores mutable data outside the installed application so upgrades do not overwrite a learner's
workspace. The React UI always runs on Tauri's stable application origin, so browser preferences and
the selected workspace survive restarts even though the private API port changes.

The current build is `v1.0.0-rc.2`. It is a release candidate and remains a GitHub Draft Release;
it is not a general-availability `v1.0.0` release.

## Choose a download

Draft and published releases contain the following platform artifacts:

| Platform | Artifact | Intended use |
| --- | --- | --- |
| Windows | `KnowTier-Setup-<version>-windows-x64.exe` | Per-user NSIS installation |
| Windows | `KnowTier-Portable-<version>-windows-x64.zip` | No-install app and bundled sidecar; data is still stored in app data |
| macOS | `KnowTier-<version>-macOS-x64.dmg` | Drag the application into `Applications` |
| Linux | `KnowTier-<version>-linux-x64.AppImage` | Distribution-independent executable |
| Linux | `knowtier_<version>_amd64.deb` | Debian or Ubuntu installation |

Each release also includes `SHA256SUMS.txt`, CycloneDX JSON SBOMs (`*.cdx.json`) for the Rust,
Node.js, and Python dependency sets, and one signing-status text file per platform. Treat a draft as
a release candidate, not a general-availability build.

## Verify before running

Download the artifact, `SHA256SUMS.txt`, and its signing-status record from the same release. On
macOS or Linux, verify all files present in one directory with:

```bash
sha256sum --check SHA256SUMS.txt --ignore-missing
```

On Windows PowerShell, compare the result of the following command with the matching line in
`SHA256SUMS.txt`:

```powershell
Get-FileHash .\KnowTier-Setup-1.0.0-rc.2-windows-x64.exe -Algorithm SHA256
```

A status file containing `UNSIGNED` means the build lacks a platform code signature. A checksum
still detects accidental corruption and confirms that a file matches the release manifest, but it
does not establish publisher identity. For an unsigned release candidate, verify the checksum from
a trusted project page and apply your organization's software policy before bypassing an operating
system warning.

## Install and start

### Windows

Run the NSIS installer for a normal per-user installation. The installer bundle is configured to
include the repository's MIT `LICENSE`, `PRIVACY.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, and
desktop runbook as local resources. The portable archive includes the same files for offline review.
For the portable build, extract the whole ZIP to a user-writable folder and keep `KnowTier.exe` and
its target-suffixed sidecar together; moving only the main executable breaks startup. Windows
SmartScreen can warn about an unsigned build; do not bypass the warning unless the release explicitly
reports `UNSIGNED` and its checksum matches. The portable ZIP does not make the learning data
portable.

### macOS

Open the DMG and drag KnowTier to `Applications`. An unsigned or unnotarized candidate can be blocked
by Gatekeeper. Confirm the signing-status record and checksum before using **Privacy & Security →
Open Anyway**; managed devices may forbid this completely.

### Linux

For an AppImage, make the file executable and run it:

```bash
chmod +x KnowTier-1.0.0-rc.2-linux-x64.AppImage
./KnowTier-1.0.0-rc.2-linux-x64.AppImage
```

For Debian or Ubuntu, install the package with `sudo apt install ./knowtier_1.0.0-rc.2_amd64.deb`.
Linux packages currently rely on the published checksum rather than a distribution repository
signature and are explicitly identified as unsigned.

## Configure a model provider

Desktop starts with the deterministic Mock Provider, so first launch and ordinary UI exploration do
not require a credential or make a paid model request. In **Settings → Model Configuration**, a user
can add SiliconFlow or another OpenAI-compatible endpoint, test model discovery, select models for
all six roles, and activate the profile. SiliconFlow uses its fixed HTTPS API origin. A custom origin
must use HTTPS, except that explicit local-development opt-in permits loopback HTTP.

A credential can be kept only for the current session or stored in the operating system's secure
credential vault when a supported vault is available. KnowTier persists non-secret profile settings
separately and never silently replaces a missing credential with another provider. Review the
provider's pricing and privacy terms before activation; prompts, relevant learning context, and
document excerpts can then be sent to that provider.

## Data, upgrades, and removal

KnowTier creates these per-user locations on first launch:

- Windows: `%LOCALAPPDATA%\KnowTier`
- macOS: `~/Library/Application Support/KnowTier`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/KnowTier`

The active database is `knowtier.sqlite3`. Uploaded material, logs, migration backups, and desktop
state live in sibling paths. When a release requires a desktop schema upgrade, KnowTier performs the
upgrade transactionally and first creates a timestamped database copy in `backups`. Starting an older
application against a newer unsupported schema is refused rather than attempting a destructive
downgrade.

Before a manual backup, quit KnowTier completely and copy the entire data directory. To remove all
local information, uninstall or delete the executable, then separately delete that directory.
See [the privacy notice](../PRIVACY.md) before sharing a database, backup, upload, or log.

## Troubleshooting

- **A second window cannot start:** wait for the existing KnowTier process to exit. If it crashed,
  confirm no process remains before retrying; do not delete the database lock or WAL files while a
  process is alive.
- **The app reports data from a newer version:** reinstall that newer KnowTier version and restore
  only from a known-good backup if needed. There is no automatic downgrade path.
- **The local service does not become ready:** close the app, restart it once, then inspect the newest
  file under the `logs` directory. Redact document names, paths, and request metadata before sharing.
- **macOS or Windows blocks launch:** check the platform signing-status file and SHA-256 checksum.
  Never assume an operating-system warning is harmless.
- **Windows opens no application window:** install or repair the Microsoft Edge WebView2 Runtime.
  The NSIS path can provision it, while a portable ZIP relies on the runtime already present on the
  machine.
- **AppImage does not launch:** ensure it is executable. Some Linux distributions also require FUSE;
  use the Debian package where appropriate.

Release engineering and signing details are in [DESKTOP_RELEASE.md](DESKTOP_RELEASE.md).
