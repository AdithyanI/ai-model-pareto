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
 * Caching is keyed on the `?v=` stamp the build writes into every asset
 * reference (see `src/build-site.mjs`). A stamped URL names one exact build,
 * so it can be cached hard and forever; an unstamped one might mean anything,
 * so it revalidates. HTML is never cached, because it is what carries the new
 * stamps. `immutable` is off in dev, where nothing is stamped and every edit
 * has to show up on reload.
 */
export function createStaticServer({ root, immutable = false }) {
  const rootDir = path.resolve(root);

  return http.createServer((req, res) => {
    const [rawPath, query = ""] = (req.url ?? "/").split("?");
    const url = decodeURIComponent(rawPath);

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
    const versioned = /(^|&)v=[0-9a-f]{6,}(&|$)/.test(query);
    const cache =
      !immutable || isHtml || !versioned ? "no-cache" : "public, max-age=31536000, immutable";

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
