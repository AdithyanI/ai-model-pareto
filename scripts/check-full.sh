#!/usr/bin/env bash
# Slower validation: fast checks plus a live source reachability probe.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash scripts/check-fast.sh

echo "==> live source still decodable"
node -e '
import("./src/source.mjs").then(async ({ fetchSource }) => {
  const s = await fetchSource();
  if (!s.models?.length || !s.endpoints?.length) throw new Error("empty payload");
  console.log("    ok: " + s.models.length + " models, " + s.endpoints.length + " endpoints");
}).catch((e) => { console.error("    source probe failed: " + e.message); process.exit(1); });
'

echo "==> build"
npm run build >/dev/null && echo "    dist ok"
echo "check-full: ok"
