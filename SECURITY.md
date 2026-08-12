# Security policy

## Supported versions

Security fixes are provided for the latest published release. Upgrade to the newest version before
reporting an issue that may already be resolved.

## Known upstream advisories

The Linux Tauri 2 build transitively includes `glib 0.18.5` through Tauri's GTK3/WebKit stack and is
therefore reported under GHSA-wrw7-89jp-8q8g. Tauri 2.11.5 does not currently expose a compatible
upgrade path to `glib 0.20`; KnowTier does not directly call the affected `VariantStrIter` iterator.
This accepted upstream risk is Linux-only, remains visible in Dependabot and the published Rust SBOM,
and will be removed as soon as the Tauri Linux dependency chain supports the patched series.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include API keys, learner data,
documents, database files, logs, or screenshots containing private information. Use GitHub's
**Security → Report a vulnerability** private reporting flow for this repository. Include the
affected version, platform, impact, minimal reproduction, and whether the problem is reachable in
desktop or server mode. Redact credentials and personal data.

The maintainer will acknowledge a complete report as capacity allows, coordinate a fix and release,
and publish details only after users have a reasonable upgrade path. This policy does not promise a
paid bug bounty or a fixed response SLA.

## Credential and data model

- The frontend never calls an LLM provider directly.
- Provider keys are write-only, masked in API responses, and excluded from browser storage, URLs,
  ordinary profile files, prompts, logs, traces, screenshots, and Git.
- Desktop API traffic is loopback-only and protected by per-process tokens.
- Local learner data remains in the operating system's per-user App Data directory until the user
  deletes it; uninstalling the application intentionally does not silently delete learning data.

See [PRIVACY.md](PRIVACY.md) and [docs/DESKTOP.md](docs/DESKTOP.md) for operational details.
