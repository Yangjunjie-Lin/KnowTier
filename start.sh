#!/usr/bin/env bash
set -Eeuo pipefail

API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$REPOSITORY_ROOT/frontend"
DATA_ROOT="$REPOSITORY_ROOT/data/local"
DATABASE_PATH="$DATA_ROOT/knowtier.db"
UPLOAD_PATH="$DATA_ROOT/uploads"
MODEL_CONFIG_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/knowtier-mock-models.XXXXXX")"
MODEL_CONFIG_PATH="$MODEL_CONFIG_DIRECTORY/models.json"
READY_URL="http://127.0.0.1:${API_PORT}/ready"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
BACKEND_PID=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Required command '%s' was not found. Install it and run start.sh again.\n" "$1" >&2
    exit 1
  fi
}

validate_port() {
  case "$1" in
    ''|*[!0-9]*)
      printf '%s must be an integer between 1 and 65535.\n' "$2" >&2
      exit 1
      ;;
  esac
  if (( $1 < 1 || $1 > 65535 )); then
    printf '%s must be an integer between 1 and 65535.\n' "$2" >&2
    exit 1
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill -TERM "$BACKEND_PID" 2>/dev/null || true
    for _ in {1..25}; do
      kill -0 "$BACKEND_PID" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill -KILL "$BACKEND_PID" 2>/dev/null || true
    fi
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  rm -rf -- "$MODEL_CONFIG_DIRECTORY"
  exit "$exit_code"
}

wait_for_ready() {
  "$UV_PROJECT_ENVIRONMENT/bin/python" - "$READY_URL" "$BACKEND_PID" <<'PY'
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

url = sys.argv[1]
backend_pid = int(sys.argv[2])
deadline = time.monotonic() + 60
while time.monotonic() < deadline:
    try:
        os.kill(backend_pid, 0)
    except ProcessLookupError:
        raise SystemExit("KnowTier API stopped before it became ready.") from None
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            payload = json.load(response)
        if response.status == 200 and payload.get("ready") is True:
            raise SystemExit(0)
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError):
        time.sleep(0.4)
raise SystemExit("KnowTier API did not become ready within 60 seconds.")
PY
}

trap cleanup EXIT
trap 'exit 130' INT TERM

require_command uv
require_command npm
require_command node
validate_port "$API_PORT" API_PORT
validate_port "$FRONTEND_PORT" FRONTEND_PORT
if [[ "$API_PORT" == "$FRONTEND_PORT" ]]; then
  printf 'API_PORT and FRONTEND_PORT must be different.\n' >&2
  exit 1
fi

port_in_use() {
  node - "$1" <<'NODE'
const net = require("node:net");
const socket = net.createConnection({ host: "127.0.0.1", port: Number(process.argv[2]) });
let settled = false;
const finish = (code) => {
  if (settled) return;
  settled = true;
  socket.destroy();
  process.exit(code);
};
socket.setTimeout(250, () => finish(1));
socket.once("connect", () => finish(0));
socket.once("error", () => finish(1));
NODE
}

if port_in_use "$API_PORT"; then
  printf 'Port %s is already in use. Choose another API_PORT.\n' "$API_PORT" >&2
  exit 1
fi
if port_in_use "$FRONTEND_PORT"; then
  printf 'Port %s is already in use. Choose another FRONTEND_PORT.\n' "$FRONTEND_PORT" >&2
  exit 1
fi

mkdir -p -- "$DATA_ROOT" "$UPLOAD_PATH"

# These exported values override .env without exposing or using provider credentials.
export UV_PROJECT_ENVIRONMENT="$DATA_ROOT/runtime-venv-unix"
export COGNIGRAPH_ENVIRONMENT="development"
export COGNIGRAPH_DESKTOP_MODE="false"
export COGNIGRAPH_WORKSPACE_SCOPE_REQUIRED="false"
export COGNIGRAPH_WORKSPACE_PROVISIONING_TOKEN=""
export COGNIGRAPH_DATABASE_URL="sqlite+aiosqlite:///$DATABASE_PATH"
export COGNIGRAPH_STORAGE_PATH="$UPLOAD_PATH"
export COGNIGRAPH_NEO4J_REQUIRED="false"
export COGNIGRAPH_USE_MOCK_LLM="true"
export COGNIGRAPH_MOCK_LEARNING_INSIGHTS_FIXTURE_ENABLED="false"
export COGNIGRAPH_OCR_ENABLED="false"
export COGNIGRAPH_MODEL_CONFIG_PATH="$MODEL_CONFIG_PATH"
export COGNIGRAPH_MODEL_CONFIGURATION_TOKEN=""
export COGNIGRAPH_API_KEY=""
export OPENAI_API_KEY=""
export ANTHROPIC_API_KEY=""
export GEMINI_API_KEY=""
export OPENROUTER_API_KEY=""
export SILICONFLOW_API_KEY=""
export AZURE_API_KEY=""
export AWS_ACCESS_KEY_ID=""
export AWS_SECRET_ACCESS_KEY=""
export AWS_SESSION_TOKEN=""
export VITE_DEV_API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"

cd -- "$REPOSITORY_ROOT"
printf 'Installing locked backend dependencies...\n'
uv sync --frozen --dev --extra documents

printf 'Installing locked frontend dependencies...\n'
npm --prefix "$FRONTEND_ROOT" ci --no-audit --no-fund

printf 'Initializing the local SQLite database...\n'
"$UV_PROJECT_ENVIRONMENT/bin/cognigraph" init

printf 'Starting KnowTier API on http://127.0.0.1:%s...\n' "$API_PORT"
"$UV_PROJECT_ENVIRONMENT/bin/uvicorn" cognigraph.main:app \
  --host 127.0.0.1 \
  --port "$API_PORT" &
BACKEND_PID=$!

wait_for_ready
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  printf 'KnowTier API stopped immediately after its readiness check.\n' >&2
  exit 1
fi
printf 'KnowTier is ready at %s (press Ctrl+C to stop).\n' "$FRONTEND_URL"
npm --prefix "$FRONTEND_ROOT" run dev -- \
  --host 127.0.0.1 \
  --port "$FRONTEND_PORT" \
  --strictPort \
  --open
