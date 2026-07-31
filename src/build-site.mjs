import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "web");
const OUT = path.join(process.cwd(), "dist");

if (!fs.existsSync(path.join(SRC, "data", "snapshot.json"))) {
  console.error("Missing web/data/snapshot.json. Run `npm run snapshot` first.");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
console.log(`built ${path.relative(process.cwd(), OUT)}`);
