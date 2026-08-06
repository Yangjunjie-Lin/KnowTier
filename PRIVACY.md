# KnowTier privacy notice

Last updated: 2026-08-06

KnowTier is a local-first learning application. The project does not operate an analytics service,
advertising network, user-account service, or automatic crash-reporting endpoint for the desktop
application. This notice describes what the application stores and when information can leave the
device.

## Data stored on the device

Depending on the features used, KnowTier stores imported learning materials, extracted text,
knowledge and learner graphs, tutoring conversations, assessments, application settings, and
operational logs. Desktop data is stored under a per-user directory:

- Windows: `%LOCALAPPDATA%\KnowTier` (or `%APPDATA%\KnowTier` when local app data is unavailable)
- macOS: `~/Library/Application Support/KnowTier`
- Linux: `${XDG_DATA_HOME}/KnowTier`, or `~/.local/share/KnowTier` when `XDG_DATA_HOME` is unset

The directory contains the SQLite database (`knowtier.sqlite3`), imported-file storage (`uploads`),
logs, schema-migration backups, non-secret model profile settings, and a small desktop state file. A
developer or administrator can override the root with `KNOWTIER_DESKTOP_DATA_DIR`. The Windows
portable build uses the same per-user location by default; “portable” means that installation is not
required, not that user data is written beside the executable.

Uninstalling KnowTier does not automatically erase this directory. To delete local data, close the
application, retain any backup you want, and remove the KnowTier data directory. Backups may contain
the same personal information as the active database and should be protected accordingly.

## Network disclosure

The desktop interface talks to its application service over the loopback interface. A one-time
bootstrap token authenticates readiness and a separate per-process token protects API and shutdown
traffic. Neither secret is placed in a command-line argument, URL, or application log. Other software
running as the same user may still be able to inspect files or processes; use normal operating-system
account protections.

Information leaves the device only when a network-backed feature is configured or when the user
connects the interface to a remote deployment. In particular:

- A configured language or embedding provider receives the prompts, context, and document excerpts
  needed for the requested operation. That provider's terms, retention policy, and region then
  apply. SiliconFlow is not contacted by default.
- A configured remote KnowTier API receives the requests and uploaded content sent to that
  deployment. Its operator controls storage and retention.
- Installing or downloading releases uses the normal network services selected by the user and is
  outside the running application's data flow.

Do not place a provider key in a document or chat. A key entered in Desktop is either retained only
for the current session or, when the user selects that option and a secure backend is available,
stored by the operating system's credential vault. Non-secret model profile settings are stored in
the application-data directory; the key is not written into that profile or the learner database.
Environment and remote-deployment credentials are handled by their respective operator. Logs can
contain request metadata and error details, so inspect them before sharing.

## Model output and evidence

Model-generated claims are not treated as confirmed facts without external evidence. KnowTier may
store model responses and provenance so that a learner can review how an explanation was produced.
Deleting the local data does not delete copies already sent to a configured provider or remote
deployment; contact that operator for its deletion procedure.

## Children, sensitive data, and sharing

KnowTier does not knowingly collect data into a project-operated service, but learning materials can
contain personal or sensitive information. Users and organizations are responsible for choosing
appropriate providers, obtaining any required consent, and following institutional retention rules.
Before sharing logs, databases, backups, screenshots, or imported files, review and redact them.

## Changes and questions

Material changes to this notice are recorded in `CHANGELOG.md`. Privacy or security questions can be
reported through the project's issue tracker; use a private security-reporting channel rather than a
public issue when a report contains a vulnerability or personal data.
