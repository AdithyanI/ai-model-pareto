import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../src/static-server.mjs";

// Production: serve the built dist/ behind the shared Cloudflare tunnel.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

startStaticServer({
  root,
  host: process.env.AI_MODEL_PARETO_HOST ?? "127.0.0.1",
  port: Number(process.env.AI_MODEL_PARETO_PORT ?? process.env.PORT ?? 8799),
  immutable: true,
  label: "ai-model-pareto",
});
