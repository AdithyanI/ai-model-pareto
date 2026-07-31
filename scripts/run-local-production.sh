#!/usr/bin/env bash
set -euo pipefail

# launchd entrypoint for the ai-model-pareto site.
# Builds dist/ if missing, then serves it for the shared Cloudflare tunnel.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${AI_MODEL_PARETO_HOST:-127.0.0.1}"
PORT="${AI_MODEL_PARETO_PORT:-8799}"
NODE_BIN="${NODE_BIN:-node}"
DIST_DIR="${ROOT_DIR}/dist"
SERVE_SCRIPT="${ROOT_DIR}/scripts/serve-static.mjs"

cd "${ROOT_DIR}"

if [[ ! -f "${DIST_DIR}/index.html" ]]; then
  echo "dist/ missing at ${DIST_DIR}; building..." >&2
  "${NODE_BIN}" src/build-site.mjs
fi

[[ -f "${SERVE_SCRIPT}" ]] || { echo "Missing ${SERVE_SCRIPT}" >&2; exit 1; }

export NODE_ENV=production
export AI_MODEL_PARETO_HOST="${HOST}"
export AI_MODEL_PARETO_PORT="${PORT}"

exec "${NODE_BIN}" "${SERVE_SCRIPT}"
