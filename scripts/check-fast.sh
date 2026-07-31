#!/usr/bin/env bash
# Fast, deterministic, local checks. Runs at commit time.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0

echo "==> syntax"
for f in src/*.mjs web/*.mjs web/lib/*.mjs test/*.mjs; do
  node --check "$f" || fail=1
done

echo "==> dominance tests"
node --test "test/*.test.mjs" >/dev/null || fail=1

echo "==> data snapshot present and parseable"
node -e '
const fs = require("fs");
const p = "web/data/snapshot.json";
if (!fs.existsSync(p)) { console.error("missing " + p + " — run npm run snapshot"); process.exit(1); }
const s = JSON.parse(fs.readFileSync(p, "utf8"));
for (const k of ["capturedAt", "source", "rows", "latencyDefinitions"]) {
  if (!(k in s)) { console.error("snapshot missing key: " + k); process.exit(1); }
}
if (!Array.isArray(s.rows) || s.rows.length < 50) { console.error("snapshot has too few rows"); process.exit(1); }
for (const r of s.rows) {
  if (!Number.isFinite(r.intelligence) || !Number.isFinite(r.cost) || r.cost <= 0) {
    console.error("bad row: " + r.id); process.exit(1);
  }
}
console.log("    " + s.rows.length + " rows, captured " + s.capturedAt);
' || fail=1

echo "==> snapshot numbers match the raw payload"
node scripts/verify-snapshot.mjs | tail -1 || fail=1

echo "==> no raw dataset committed"
if git ls-files --error-unmatch data/raw >/dev/null 2>&1; then
  echo "data/raw must not be committed"; fail=1
fi

[ "$fail" -eq 0 ] && echo "check-fast: ok"
exit "$fail"
