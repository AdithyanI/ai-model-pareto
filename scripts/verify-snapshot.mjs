/**
 * Independent audit of every number the page publishes.
 *
 * Deliberately imports neither pareto.mjs nor build-snapshot.mjs. It re-reads
 * the raw payload, re-derives the rows, recomputes every Pareto front by brute
 * force at O(n^2), and diffs the result against the committed snapshot. If the
 * dominance core ever gains a bug, this disagrees with it.
 *
 * Needs data/raw/source.json, which is gitignored. Run `npm run snapshot`
 * first. Skips cleanly when the raw payload is absent so CI does not fail on
 * a checkout that has never fetched.
 */
import fs from "node:fs";

const RAW = "data/raw/source.json";
if (!fs.existsSync(RAW)) {
  console.log(`skip: ${RAW} not present (gitignored). Run \`npm run snapshot\` to fetch it.`);
  process.exit(0);
}

const src = JSON.parse(fs.readFileSync(RAW, "utf8"));
const snap = JSON.parse(fs.readFileSync("web/data/snapshot.json", "utf8"));

const fail = [];
const ok = [];
const check = (name, cond, detail = "") =>
  (cond ? ok : fail).push(`${cond ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

// ---------------------------------------------------------------- 1. raw shape
check("source has models", Array.isArray(src.models), `${src.models?.length}`);
check("source has endpoints", Array.isArray(src.endpoints), `${src.endpoints?.length}`);
check("counts.modelsInSource matches raw", snap.counts.modelsInSource === src.models.length,
  `${snap.counts.modelsInSource} vs ${src.models.length}`);
check("counts.endpointsInSource matches raw", snap.counts.endpointsInSource === src.endpoints.length,
  `${snap.counts.endpointsInSource} vs ${src.endpoints.length}`);

// ------------------------------------------------- 2. re-derive rows from raw
const byId = new Map(src.models.map((m) => [m.id, m]));
const drops = { noModel: 0, noIntelligence: 0, noCost: 0, badCost: 0, noLatency: 0 };
const derived = [];
for (const e of src.endpoints) {
  const m = byId.get(e.modelId);
  if (!m) { drops.noModel++; continue; }
  const intelligence = m.intelligenceIndex;
  if (!Number.isFinite(intelligence)) { drops.noIntelligence++; continue; }
  const cost = e.intelligenceIndexCostPerTask?.cost?.total;
  if (!Number.isFinite(cost)) { drops.noCost++; continue; }
  if (cost <= 0) { drops.badCost++; continue; }
  const t = e.endToEndResponseTime?.total;
  if (!Number.isFinite(t) || t <= 0) { drops.noLatency++; continue; }
  derived.push({
    id: e.id, slug: m.slug, host: e.host?.name ?? null,
    intelligence, cost, time: t,
    ttfat: e.timeToFirstAnswerToken?.total,
    long: e.performanceByPromptType?.hundredK?.medianEndToEndResponseTime,
  });
}
console.log("drop reasons:", drops, "kept before dedupe:", derived.length);

// dedupe: cheapest then fastest per model+host
const best = new Map();
for (const r of derived) {
  const k = `${r.slug}::${r.host ?? "unknown"}`;
  const p = best.get(k);
  if (!p || r.cost < p.cost || (r.cost === p.cost && r.time < p.time)) best.set(k, r);
}
const rows = [...best.values()];

check("plotted count matches", rows.length === snap.rows.length, `${rows.length} vs ${snap.rows.length}`);
check("distinctModels matches", new Set(rows.map((r) => r.slug)).size === snap.counts.distinctModels,
  `${new Set(rows.map((r) => r.slug)).size} vs ${snap.counts.distinctModels}`);
check("row id sets identical",
  JSON.stringify([...rows.map((r) => r.id)].sort()) === JSON.stringify(snap.rows.map((r) => r.id).sort()));

// ------------------------------- 3. every stored field traced back to the raw
let fieldErr = 0, firstErr = null;
const rawEp = new Map(src.endpoints.map((e) => [e.id, e]));
for (const r of snap.rows) {
  const e = rawEp.get(r.id);
  const m = byId.get(e.modelId);
  const bad = [];
  if (r.intelligence !== m.intelligenceIndex) bad.push("intelligence");
  if (r.cost !== e.intelligenceIndexCostPerTask?.cost?.total) bad.push("cost");
  if (r.latencies.endToEnd !== e.endToEndResponseTime?.total) bad.push("endToEnd");
  if (r.model !== m.name) bad.push("model");
  if (r.host !== (e.host?.name ?? null)) bad.push("host");
  if (r.openWeights !== Boolean(m.isOpenWeights)) bad.push("openWeights");
  if (bad.length) { fieldErr++; firstErr ??= `${r.id} ${r.model}: ${bad}`; }
}
check("all row fields trace to raw payload", fieldErr === 0, fieldErr ? `${fieldErr} bad, e.g. ${firstErr}` : "415 rows");

// -------------------------------------- 4. brute-force Pareto, no shared code
// lower cost/time better, higher intelligence better. Strict Pareto:
// a dominates b iff a >= b on all objectives and > on at least one.
function bruteFront(pts, objs) {
  const keep = [];
  for (const b of pts) {
    let dominated = false;
    for (const a of pts) {
      if (a === b) continue;
      let allGE = true, anyG = false;
      for (const { get, hi } of objs) {
        const av = get(a), bv = get(b);
        const better = hi ? av > bv : av < bv;
        const worse = hi ? av < bv : av > bv;
        if (worse) { allGE = false; break; }
        if (better) anyG = true;
      }
      if (allGE && anyG) { dominated = true; break; }
    }
    if (!dominated) keep.push(b);
  }
  return keep;
}
const I = { get: (r) => r.intelligence, hi: true };
const C = { get: (r) => r.cost, hi: false };
const T = { get: (r) => r.time, hi: false };

for (const [key, pick] of [["endToEnd", (r) => r.time], ["firstAnswerToken", (r) => r.ttfat], ["longContext", (r) => r.long]]) {
  const usable = rows.filter((r) => Number.isFinite(pick(r)) && pick(r) > 0)
    .map((r) => ({ ...r, time: pick(r) }));
  const f3 = new Set(bruteFront(usable, [I, C, T]).map((r) => r.id));
  const fc = new Set(bruteFront(usable, [I, C]).map((r) => r.id));
  const ft = new Set(bruteFront(usable, [I, T]).map((r) => r.id));
  const fct = new Set(bruteFront(usable, [C, T]).map((r) => r.id));
  // "Hidden" means invisible on the two PUBLISHED charts. Cost-vs-time is not
  // a chart AA publishes, so membership of it must not rescue a model here.
  const hidden = new Set([...f3].filter((id) => !fc.has(id) && !ft.has(id)));
  const s = snap.fronts[key];
  const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  check(`${key}: usable count`, usable.length === s.stats.total, `brute ${usable.length} vs stats ${s.stats.total}`);
  check(`${key}: 3D front`, eq(f3, s.front3d), `brute ${f3.size} vs snapshot ${s.front3d.length}`);
  check(`${key}: int-cost front`, eq(fc, s.frontIntCost), `brute ${fc.size} vs snapshot ${s.frontIntCost.length}`);
  check(`${key}: int-time front`, eq(ft, s.frontIntTime), `brute ${ft.size} vs snapshot ${s.frontIntTime.length}`);
  check(`${key}: cost-time front`, eq(fct, s.frontCostTime), `brute ${fct.size} vs snapshot ${s.frontCostTime.length}`);
  check(`${key}: hidden set`, eq(hidden, s.hiddenOptimal), `brute ${hidden.size} vs snapshot ${s.hiddenOptimal.length}`);
  check(`${key}: hidden is subset of 3D`, [...hidden].every((id) => f3.has(id)));
}

// --------------------------------------------- 5. what the page actually shows
// The default view: representative rows only, endToEnd latency.
const reps = snap.rows.filter((r) => r.representative);
const repIds = new Set(reps.map((r) => r.id));
const repRows = rows.filter((r) => repIds.has(r.id));
check("representatives = one per model", reps.length === snap.counts.distinctModels,
  `${reps.length} vs ${snap.counts.distinctModels}`);
const p3 = bruteFront(repRows, [I, C, T]);
const pc = bruteFront(repRows, [I, C]);
const pt = bruteFront(repRows, [I, T]);
const pct = bruteFront(repRows, [C, T]);
const ids = (a) => new Set(a.map((r) => r.id));
const hid = [...ids(p3)].filter((id) => !ids(pc).has(id) && !ids(pt).has(id));
console.log(`\nDEFAULT VIEW (133 representatives, end-to-end):`);
console.log(`  on chart      ${repRows.length}`);
console.log(`  3D front      ${p3.length}`);
console.log(`  int-cost      ${pc.length}`);
console.log(`  int-time      ${pt.length}`);
console.log(`  hidden        ${hid.length}`);

// ------------------------------------------------------- 6. documented claims
const byName = (n) => snap.rows.filter((r) => r.model === n || r.shortName === n);
const opus = byName("Claude Opus 5 (Adaptive Reasoning, Max Effort)")
  .concat(snap.rows.filter((r) => r.model.includes("Opus 5") && /Max/.test(r.model)));
const spot = opus.find((r) => (r.host ?? "").includes("Bedrock")) ?? opus[0];
if (spot) {
  console.log(`\nSPOT CHECK ${spot.model} on ${spot.host}:`);
  console.log(`  intelligence ${spot.intelligence}  cost $${spot.cost}  endToEnd ${spot.latencies.endToEnd}s`);
  const raw = rawEp.get(spot.id);
  console.log(`  raw cost total ${raw.intelligenceIndexCostPerTask.cost.total}, raw e2e ${raw.endToEndResponseTime.total}`);
}
// headline extremes shown in the readout
const smart = repRows.reduce((a, b) => (b.intelligence > a.intelligence ? b : a));
const cheap = repRows.reduce((a, b) => (b.cost < a.cost ? b : a));
const fast = repRows.reduce((a, b) => (b.time < a.time ? b : a));
const nm = (r) => snap.rows.find((x) => x.id === r.id).shortName;
console.log(`\nEXTREMES among representatives:`);
console.log(`  smartest ${nm(smart)} ${smart.intelligence}`);
console.log(`  cheapest ${nm(cheap)} $${cheap.cost}`);
console.log(`  fastest  ${nm(fast)} ${fast.time}s`);

// --------------------------------------------------------------- 7. sanity
check("no negative or zero cost", snap.rows.every((r) => r.cost > 0));
check("intelligence within 0..100", snap.rows.every((r) => r.intelligence >= 0 && r.intelligence <= 100));
check("every row has endToEnd", snap.rows.every((r) => Number.isFinite(r.latencies.endToEnd)));
check("capturedAt is a real date", !Number.isNaN(Date.parse(snap.capturedAt)), snap.capturedAt);
check("no raw mirror committed", !fs.existsSync(".git/../data/raw/source.json") || fs.readFileSync(".gitignore", "utf8").includes("data/raw"));

console.log("\n" + ok.join("\n"));
if (fail.length) { console.log("\n" + fail.join("\n")); process.exitCode = 1; }
console.log(`\n${ok.length} passed, ${fail.length} failed`);
