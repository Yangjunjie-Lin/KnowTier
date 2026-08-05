# KnowTier frontend

React 18, TypeScript, Vite, Tailwind CSS, Radix UI, and Cytoscape.js frontend for the
KnowTier tutoring API.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A running KnowTier API for workflows that use server data

## Development

Install dependencies and start Vite:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Browser requests use `/api` and Vite proxies them to
`http://127.0.0.1:8000` by default, so FastAPI does not need permissive CORS settings.
Override the development upstream without exposing it to production JavaScript:

```powershell
$env:VITE_DEV_API_PROXY_TARGET="http://127.0.0.1:8001"
npm run dev
```

Copy `.env.example` to `.env.local` when local overrides are needed. Do not put model API
keys, Workspace provisioning tokens, or document content in frontend environment files.

## Verification

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
```

Playwright requires a browser installation before the first end-to-end run:

```powershell
npx playwright install chromium
```

The end-to-end suite installs deterministic same-origin API fixtures in the browser, covers the
same contracts as backend Mock mode, and does not require provider credentials, PostgreSQL, or
Neo4j. Backend integration remains covered by the offline Python test suite and can also be
checked manually with `COGNIGRAPH_USE_MOCK_LLM=true`.

## Production image

The production image uses Node only to compile the application. Nginx serves the static output,
falls back to `index.html` for client-side routes, and proxies `/api`, `/health`, and `/ready` to
the Compose `api` service. `/api` is a build-time public base path; secrets must never be passed as
Vite build arguments.

Build and start the complete PostgreSQL, Neo4j, API, and frontend stack from the repository root:

```powershell
docker compose up --build
```

Open `http://127.0.0.1:8080`. Set `FRONTEND_PORT` before starting Compose to use another host
port. The API remains available directly on `http://127.0.0.1:8000` for diagnostics.

To build only the frontend image after the API stack is available:

```powershell
docker compose build frontend
docker compose up frontend
```

Validate the Compose model without starting services:

```powershell
docker compose config --quiet
```

Vite variables are compiled into the static bundle. Changing them requires rebuilding the image.
Runtime Workspace and Learner IDs belong in browser state; provisioning tokens are request-only.
