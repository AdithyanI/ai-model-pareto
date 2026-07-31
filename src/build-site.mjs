import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SRC = path.join(process.cwd(), "web");
const OUT = path.join(process.cwd(), "dist");

if (!fs.existsSync(path.join(SRC, "data", "snapshot.json"))) {
  console.error("Missing web/data/snapshot.json. Run `npm run snapshot` first.");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

/**
 * Cache busting.
 *
 * index.html is served with `no-cache` so a deploy is seen immediately, but
 * without this the fresh HTML still points at the same asset URLs, which the
 * edge and the browser keep serving from cache. A deploy can then be live and
 * invisible for hours, which is exactly what happened once. Every asset
 * reference therefore carries a `?v=` stamp derived from the content of the
 * whole build, so any change produces URLs nothing has cached yet. Only
 * stamped URLs get a long max-age; see `src/static-server.mjs`.
 *
 * One stamp for the build rather than one per file: the site is a hundred or
 * so kilobytes, so re-fetching all of it on a deploy costs nothing, and a
 * single stamp cannot get the dependency order wrong.
 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(OUT).sort();
const hash = crypto.createHash("sha256");
for (const file of files) {
  if (path.basename(file) === "index.html") continue;
  hash.update(path.relative(OUT, file));
  hash.update(fs.readFileSync(file));
}
const stamp = hash.digest("hex").slice(0, 10);
const stampUrl = (url) => (url.includes("?") ? url : `${url}?v=${stamp}`);

const STAMPED = /\?v=[0-9a-f]{6,}$/;
const HTML_REF = /(\b(?:href|src)=")(\.\/[^"]+\.(?:css|mjs|svg))"/g;
const MODULE_REF = /(["'])(\.{1,2}\/[^"']+\.(?:mjs|json))\1/g;

for (const file of files) {
  const ext = path.extname(file);
  if (ext !== ".html" && ext !== ".mjs") continue;
  const before = fs.readFileSync(file, "utf8");
  const after =
    ext === ".html"
      ? before.replace(HTML_REF, (_, attr, url) => `${attr}${stampUrl(url)}"`)
      : before.replace(MODULE_REF, (_, quote, url) => `${quote}${stampUrl(url)}${quote}`);
  if (after !== before) fs.writeFileSync(file, after);
}

// Read the output back and refuse to ship a build that would deploy invisibly.
// The detection below is deliberately broader than the stamping above — any
// quote style, with or without a leading `./` — because the only failure worth
// guarding against is a reference shape the stamping regexes did not know
// about. A guard reusing the same pattern would agree with itself and catch
// nothing.
const ANY_HTML_REF = /(?:href|src)\s*=\s*["']([^"':]+\.(?:css|mjs|js|svg|json))["']/g;
const ANY_MODULE_REF = /(?:from|import|fetch\()\s*["']([^"':]+\.(?:mjs|js|json))["']/g;

const unstamped = [];
for (const file of files) {
  const ext = path.extname(file);
  if (ext !== ".html" && ext !== ".mjs") continue;
  const text = fs.readFileSync(file, "utf8");
  for (const [, url] of text.matchAll(ext === ".html" ? ANY_HTML_REF : ANY_MODULE_REF)) {
    if (!STAMPED.test(url)) unstamped.push(`${path.relative(OUT, file)} -> ${url}`);
  }
}
if (unstamped.length) {
  console.error(`Unstamped asset references would be served stale after a deploy:\n  ${unstamped.join("\n  ")}`);
  process.exit(1);
}

console.log(`built ${path.relative(process.cwd(), OUT)} (assets stamped v=${stamp})`);
