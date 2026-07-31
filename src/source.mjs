import crypto from "node:crypto";
import zlib from "node:zlib";

const ORIGIN = "https://artificialanalysis.ai";
const PAGE = `${ORIGIN}/models`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/**
 * The page ships its dataset as an encrypted blob referenced by a manifest
 * `{path, key}` embedded in the Next.js flight payload. The client derives the
 * AES-GCM IV from the SHA-256 of the raw key bytes (not the hex string).
 */
export function extractManifests(html) {
  const seen = new Map();
  const re = /\\"manifest\\":\{\\"path\\":\\"([^\\"]+)\\",\\"key\\":\\"([0-9a-f]+)\\"\}/g;
  let m;
  while ((m = re.exec(html)) !== null) seen.set(m[1], { path: m[1], key: m[2] });
  if (seen.size === 0) {
    throw new Error(
      "No data manifests found. The page delivery shape likely changed; re-inspect before trusting any snapshot.",
    );
  }
  return [...seen.values()];
}

export function decryptPayload(buffer, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.createHash("sha256").update(key).digest().subarray(0, 12);
  const tag = buffer.subarray(buffer.length - 16);
  const body = buffer.subarray(0, buffer.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
}

async function get(url, as) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return as === "buffer" ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** Fetch live models + endpoints payloads with provenance. */
export async function fetchSource() {
  const capturedAt = new Date().toISOString();
  const html = await get(PAGE, "text");
  const manifests = extractManifests(html);

  const payloads = [];
  for (const manifest of manifests) {
    const raw = await get(`${ORIGIN}${manifest.path}`, "buffer");
    payloads.push({
      manifest,
      bytes: raw.length,
      sha256: crypto.createHash("sha256").update(raw).digest("hex"),
      json: decryptPayload(raw, manifest.key),
    });
  }

  const modelsPayload = payloads.find((p) => !Array.isArray(p.json) && Array.isArray(p.json?.models));
  const endpointsPayload = payloads.find((p) => Array.isArray(p.json));
  if (!modelsPayload || !endpointsPayload) {
    throw new Error("Expected one models payload and one endpoints payload; shape changed.");
  }

  return {
    capturedAt,
    sourceUrl: PAGE,
    models: modelsPayload.json.models,
    endpoints: endpointsPayload.json,
    provenance: payloads.map((p) => ({
      path: p.manifest.path,
      bytes: p.bytes,
      sha256: p.sha256,
    })),
  };
}
