# Contributing to KnowTier

Thank you for improving KnowTier. Small, focused changes with tests are easiest to review.

## Development setup

Use Python 3.12, uv, Node.js 22, and the committed lockfiles. Follow the local setup in
[README.md](README.md). Tests must remain offline by default and must not require real credentials,
PostgreSQL, or Neo4j unless they use the existing explicit markers and opt-in gates.

Before opening a pull request, run:

```text
uv lock --check
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run mypy src/cognigraph
uv run pytest
cd frontend
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npx playwright test
```

For persistence, graph, release, or desktop changes, also run the relevant production/full-stack and
packaged Smoke workflows described in [PRODUCTION_TESTING.md](PRODUCTION_TESTING.md) and
[docs/DESKTOP_RELEASE.md](docs/DESKTOP_RELEASE.md).

## Design constraints

- Preserve domain, persistence, service, and API layering.
- Model-only facts without external evidence remain non-confirmed.
- Never accept arbitrary Cypher from API or model output.
- Keep all model traffic behind `ModelGateway` and preserve schema validation and safe fallbacks.
- Never commit credentials, learner data, generated packages, local databases, traces, or screenshots
  containing private information.
- Do not weaken strict checks, skip failing tests, or hide exceptions to make CI green.

## Pull requests

Explain the user-facing outcome, tests run, data/schema impact, security/privacy impact, and screenshots
for visual changes. Update the changelog and documentation when behavior or release operations change.
By contributing, you agree that your contribution is licensed under the repository's MIT license.
