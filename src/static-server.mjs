import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Minimal static server for a built directory.
 *
 * `immutable` is off in dev so edits show up on reload, and on in production
 * where the tunnel fronts a build whose content is fixed until the next deploy.
 * HTML is always revalidated so a deploy is picked up immediately.
 */
export function createStaticServer({ root, immutable = false }) {
  const rootDir = path.resolve(root);

  return http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);

    if (url === "/health") {
      const ok = fs.existsSync(path.join(rootDir, "index.html"));
      res.writeHead(ok ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ status: ok ? "ok" : "missing-build", root: rootDir }));
      return;
    }

    const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
    const file = path.join(rootDir, rel);

    // Path traversal guard: the resolved path must stay inside the root.
    if (!file.startsWith(rootDir + path.sep) && file !== rootDir) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }

    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end("not found");
      return;
    }
    if (stat.isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    const ext = path.extname(file);
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }

    const isHtml = ext === ".html";
    const cache = !immutable || isHtml ? "no-cache" : "public, max-age=3600, must-revalidate";

    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-length": stat.size,
      "cache-control": cache,
      etag,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
}

export function startStaticServer({ root, host, port, immutable, label }) {
  const server = createStaticServer({ root, immutable });
  server.listen(port, host, () => {
    console.log(`${label ?? "static"} serving ${root} on http://${host}:${port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return server;
}
