#!/usr/bin/env bash
set -euo pipefail

# Install/update the Mac mini launchd service for the ai-model-pareto site.
# Builds the static site and serves dist/ on 127.0.0.1:8799 for the shared
# Cloudflare tunnel (pareto.adithyan.io). Mirrors the adi-design pattern.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SCRIPT="${ROOT_DIR}/scripts/run-local-production.sh"

LABEL="com.${USER}.ai-model-pareto"
HOST="127.0.0.1"
PORT="8799"
NODE_BIN="${NODE_BIN:-node}"
BUILD_NOW=1
REFRESH_DATA=0
UNINSTALL=0
STATUS_ONLY=0
LOG_LINES=0
HEALTH_WAIT_SECONDS=40

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Install/update the Mac mini launchd service for ai-model-pareto.

Options:
  --label <value>     LaunchAgent label (default: com.<user>.ai-model-pareto)
  --host <host>       Bind host (default: 127.0.0.1)
  --port <n>          Bind port (default: 8799)
  --node <path>       node binary path (default: node)
  --refresh-data      Refetch the live source snapshot before building
  --skip-build-now    Skip the one-time build during install
  --uninstall         Unload and remove the LaunchAgent plist
  --status            Print launchctl status and local health
  --logs [n]          Tail launchd logs (default lines: 80)
  -h, --help          Show help
USAGE
}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
is_int() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
xml_escape() {
  local v="$1"; v="${v//&/&amp;}"; v="${v//</&lt;}"; v="${v//>/&gt;}"; printf '%s' "$v"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --node) NODE_BIN="${2:-}"; shift 2 ;;
    --refresh-data) REFRESH_DATA=1; shift ;;
    --skip-build-now) BUILD_NOW=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --status) STATUS_ONLY=1; shift ;;
    --logs)
      if [[ -n "${2:-}" && "${2:-}" != --* ]]; then LOG_LINES="$2"; shift 2; else LOG_LINES=80; shift; fi ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$LABEL" ]] || die "missing --label"
[[ -n "$HOST" ]] || die "missing --host"
is_int "$PORT" || die "invalid --port: $PORT"
is_int "$LOG_LINES" || die "invalid --logs value: $LOG_LINES"
command -v "$NODE_BIN" >/dev/null 2>&1 || [[ -x "$NODE_BIN" ]] || die "missing node binary: $NODE_BIN"
[[ -x "$RUN_SCRIPT" ]] || die "missing run script: $RUN_SCRIPT"

PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HOME}/.local/state/ai-model-pareto/log"
OUT_LOG="${LOG_DIR}/ai-model-pareto.out.log"
ERR_LOG="${LOG_DIR}/ai-model-pareto.err.log"
DOMAIN="gui/$(id -u)"
LOCAL_HEALTH_URL="http://${HOST}:${PORT}/health"

print_status() {
  launchctl list "${LABEL}" 2>/dev/null || echo "LaunchAgent not loaded: ${LABEL}"
  if curl -fsS "${LOCAL_HEALTH_URL}" >/dev/null 2>&1; then
    echo "Local health: ok"
  else
    echo "Local health: unavailable"
  fi
  echo "Local URL: http://${HOST}:${PORT}/"
}

wait_for_health() {
  local timeout_seconds="${1:-40}" started_at now
  started_at="$(date +%s)"
  while true; do
    curl -fsS "${LOCAL_HEALTH_URL}" >/dev/null 2>&1 && return 0
    now="$(date +%s)"
    (( now - started_at >= timeout_seconds )) && return 1
    sleep 0.5
  done
}

render_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$(xml_escape "$LABEL")</string>
    <key>ProgramArguments</key>
    <array>
      <string>$(xml_escape "$RUN_SCRIPT")</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$(xml_escape "$ROOT_DIR")</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>$(xml_escape "$OUT_LOG")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "$ERR_LOG")</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>HOME</key>
      <string>$(xml_escape "$HOME")</string>
      <key>NODE_ENV</key>
      <string>production</string>
      <key>AI_MODEL_PARETO_HOST</key>
      <string>$(xml_escape "$HOST")</string>
      <key>AI_MODEL_PARETO_PORT</key>
      <string>$(xml_escape "$PORT")</string>
      <key>NODE_BIN</key>
      <string>$(xml_escape "$NODE_BIN")</string>
    </dict>
  </dict>
</plist>
PLIST
}

if [[ "${STATUS_ONLY}" -eq 1 ]]; then print_status; exit 0; fi

if [[ "${LOG_LINES}" -gt 0 ]]; then
  echo "[logs] stdout: ${OUT_LOG}"; tail -n "${LOG_LINES}" "${OUT_LOG}" 2>/dev/null || true
  echo "[logs] stderr: ${ERR_LOG}"; tail -n "${LOG_LINES}" "${ERR_LOG}" 2>/dev/null || true
  exit 0
fi

if [[ "${UNINSTALL}" -eq 1 ]]; then
  launchctl bootout "${DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
  rm -f "${PLIST_PATH}"
  echo "Uninstalled ${LABEL}"; exit 0
fi

if [[ "${BUILD_NOW}" -eq 1 ]]; then
  cd "${ROOT_DIR}"
  if [[ "${REFRESH_DATA}" -eq 1 ]]; then
    echo "Refreshing live data snapshot..."
    "${NODE_BIN}" src/build-snapshot.mjs
  fi
  bash scripts/check-fast.sh
  "${NODE_BIN}" src/build-site.mjs
fi

mkdir -p "$(dirname "${PLIST_PATH}")" "${LOG_DIR}"
render_plist >"${PLIST_PATH}"
chmod 0644 "${PLIST_PATH}"

launchctl bootout "${DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
# bootstrap honours RunAtLoad, so this starts the service on its own. Do NOT
# add a `kickstart -k` here: it kills the process bootstrap just started, and
# because that process has run for less than ThrottleInterval, launchd delays
# the respawn by the full throttle window. That produced a real ~60s 502 on
# pareto.adithyan.io during a deploy on 2026-07-31.
launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}"

echo "Loaded ${LABEL} from ${PLIST_PATH}"
if ! wait_for_health "${HEALTH_WAIT_SECONDS}"; then
  echo "ERROR: ${LOCAL_HEALTH_URL} did not respond within ${HEALTH_WAIT_SECONDS}s." >&2
  echo "       The site is likely serving 502 right now. Recent log lines:" >&2
  tail -n 15 "${ERR_LOG}" >&2 2>/dev/null || true
  print_status >&2
  exit 1
fi
print_status
