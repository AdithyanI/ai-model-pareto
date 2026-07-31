import path from "node:path";
import { startStaticServer } from "./static-server.mjs";

// Dev: serve the source tree directly so edits need no rebuild.
startStaticServer({
  root: path.join(process.cwd(), "web"),
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4178),
  immutable: false,
  label: "dev",
});
