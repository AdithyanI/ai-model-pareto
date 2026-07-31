#!/usr/bin/env bash
set -euo pipefail

# Build, validate, refresh the launchd service, and smoke the local production
# URL for ai-model-pareto. Called by the shared reconcile loop after a push to
# main, and safe to run by hand.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

HOST="127.0.0.1"
PORT="8799"
PUBLIC_URL="https://pareto.adithyan.io/"
REFRESH_DATA=0
APPLY=0
CHECK_PUBLIC=1

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--apply] [--refresh-data] [--skip-public]

Without --apply this prints what would happen and exits.

  --apply          Build, reload the launchd service, and smoke the result
  --refresh-data   Refetch the live Artificial Analysis snapshot first
  --skip-public    Skip the public HTTPS smoke check
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --refresh-data) REFRESH_DATA=1; shift ;;
    --skip-public) CHECK_PUBLIC=0; shift ;;
    --plain|--no-input) shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${APPLY}" -eq 0 ]]; then
  echo "[dry-run] would build dist/, reload com.${USER}.ai-model-pareto on ${HOST}:${PORT}, smoke ${PUBLIC_URL}"
  echo "[dry-run] re-run with --apply"
  exit 0
fi

if [[ "${REFRESH_DATA}" -eq 1 ]]; then
  echo "==> refreshing live snapshot"
  node src/build-snapshot.mjs
fi

echo "==> checks"
bash scripts/check-fast.sh

echo "==> build"
node src/build-site.mjs

echo "==> reload service"
./scripts/install-launchd-ai-model-pareto.sh --host "${HOST}" --port "${PORT}" --skip-build-now

echo "==> smoke local"
curl -fsS "http://${HOST}:${PORT}/health" >/dev/null
curl -fsS "http://${HOST}:${PORT}/data/snapshot.json" >/dev/null
echo "    local ok"

if [[ "${CHECK_PUBLIC}" -eq 1 ]]; then
  echo "==> smoke public"
  if curl -fsS -o /dev/null "${PUBLIC_URL}"; then
    echo "    ${PUBLIC_URL} ok"
  else
    echo "    WARNING: ${PUBLIC_URL} not reachable; check the shared tunnel" >&2
  fi
fi

echo "deploy: ok"
