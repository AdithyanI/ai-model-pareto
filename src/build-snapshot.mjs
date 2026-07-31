import fs from "node:fs";
import path from "node:path";
import { fetchSource } from "./source.mjs";
import { frontierBreakdown, paretoFront, preferenceMap, OBJECTIVES } from "../web/lib/pareto.mjs";

const OUT = path.join(process.cwd(), "web", "data", "snapshot.json");
const RAW_DIR = path.join(process.cwd(), "data", "raw");

/**
 * Latency policy. Artificial Analysis exposes several non-equivalent measures
 * and they must not be collapsed into one word. We keep three that answer
 * genuinely different questions, all backed by real fields in the payload.
 *
 * Note: the payload has no `intelligenceIndexTimePerTask` field, so AA's
 * "time per Intelligence Index task" chart cannot be reproduced from this
 * source. We do not synthesise it. `endToEndResponseTime.total` mirrors the
 * long-prompt measurement exactly and has full coverage, so it is the default.
 */
const LATENCY = {
  endToEnd: {
    label: "End-to-end response",
    hint: "Request sent to last token received, on AA's long prompt. Answers 'how long until I have the whole answer?'",
    pick: (e) => e.endToEndResponseTime?.total,
  },
  firstAnswerToken: {
    label: "Time to first answer token",
    hint: "Includes reasoning time, so it is the honest 'first useful word' measure rather than the first stream chunk.",
    pick: (e) => e.timeToFirstAnswerToken?.total,
  },
  longContext: {
    label: "End-to-end at 100K context",
    hint: "Same measure on a 100K-token prompt. Long-context latency reorders the field.",
    pick: (e) => e.performanceByPromptType?.hundredK?.medianEndToEndResponseTime,
  },
};

function buildRows(models, endpoints) {
  const byId = new Map(models.map((m) => [m.id, m]));
  const rows = [];

  for (const e of endpoints) {
    const model = byId.get(e.modelId);
    if (!model) continue;
    const intelligence = model.intelligenceIndex;
    const cost = e.intelligenceIndexCostPerTask?.cost?.total;
    if (!Number.isFinite(intelligence) || !Number.isFinite(cost) || cost <= 0) continue;

    const latencies = {};
    for (const [key, def] of Object.entries(LATENCY)) {
      const v = def.pick(e);
      if (Number.isFinite(v) && v > 0) latencies[key] = v;
    }
    if (!Number.isFinite(latencies.endToEnd)) continue;

    rows.push({
      id: e.id,
      model: model.name,
      shortName: model.shortName ?? model.name,
      slug: model.slug,
      creator: model.creator?.name ?? null,
      host: e.host?.name ?? null,
      openWeights: Boolean(model.isOpenWeights),
      reasoning: Boolean(model.isReasoning),
      releaseDate: model.releaseDate ?? null,
      estimated: Boolean(model.intelligenceIndexIsEstimated),
      contextWindowTokens: e.contextWindowTokens ?? model.contextWindowTokens ?? null,
      intelligence,
      cost,
      latencies,
      // Cost/time split shows *why* a configuration sits where it does.
      costSplit: {
        input: e.intelligenceIndexCostPerTask?.cost?.input ?? null,
        reasoning: e.intelligenceIndexCostPerTask?.cost?.reasoning ?? null,
        answer: e.intelligenceIndexCostPerTask?.cost?.answer ?? null,
      },
      timeSplit: {
        input: e.endToEndResponseTime?.input ?? null,
        reasoning: e.endToEndResponseTime?.reasoning ?? null,
        answer: e.endToEndResponseTime?.answer ?? null,
      },
      outputSpeed: e.performanceByPromptType?.medium?.medianOutputSpeed ?? null,
    });
  }

  return rows;
}

/**
 * Identity policy: a plotted point is a model configuration on a specific host,
 * because price and latency are properties of the host, not the model. Where a
 * model/host pair appears more than once we keep the cheapest, then fastest.
 */
function dedupe(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = `${row.slug}::${row.host ?? "unknown"}`;
    const prev = best.get(key);
    if (
      !prev ||
      row.cost < prev.cost ||
      (row.cost === prev.cost && row.latencies.endToEnd < prev.latencies.endToEnd)
    ) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

/** Cheapest+fastest host per model, for the less noisy default view. */
function markRepresentatives(rows) {
  const byModel = new Map();
  for (const row of rows) {
    const prev = byModel.get(row.slug);
    const score = (r) => r.cost * Math.max(r.latencies.endToEnd, 1);
    if (!prev || score(row) < score(prev)) byModel.set(row.slug, row);
  }
  const chosen = new Set([...byModel.values()].map((r) => r.id));
  for (const row of rows) row.representative = chosen.has(row.id);
}

async function main() {
  const dryRun = process.argv.includes("--from-cache");
  let source;

  if (dryRun && fs.existsSync(path.join(RAW_DIR, "source.json"))) {
    source = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "source.json"), "utf8"));
  } else {
    source = await fetchSource();
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(path.join(RAW_DIR, "source.json"), JSON.stringify(source));
  }

  const rows = dedupe(buildRows(source.models, source.endpoints));
  markRepresentatives(rows);

  // Frontiers are computed per latency definition so the UI can switch honestly.
  const fronts = {};
  for (const key of Object.keys(LATENCY)) {
    const usable = rows.filter((r) => Number.isFinite(r.latencies[key]));
    for (const r of usable) r.time = r.latencies[key];
    const stats = frontierBreakdown(usable);
    const front = paretoFront(usable, [OBJECTIVES.intelligence, OBJECTIVES.cost, OBJECTIVES.time]);
    fronts[key] = {
      label: LATENCY[key].label,
      hint: LATENCY[key].hint,
      stats,
      front3d: usable.filter((r) => r.front3d).map((r) => r.id),
      frontIntCost: usable.filter((r) => r.frontIntCost).map((r) => r.id),
      frontIntTime: usable.filter((r) => r.frontIntTime).map((r) => r.id),
      frontCostTime: usable.filter((r) => r.frontCostTime).map((r) => r.id),
      hiddenOptimal: usable.filter((r) => r.hiddenOptimal).map((r) => r.id),
      preferenceMap: preferenceMap(front),
    };
    for (const r of usable) delete r.time;
    for (const r of usable) {
      delete r.front3d;
      delete r.frontIntCost;
      delete r.frontIntTime;
      delete r.frontCostTime;
      delete r.hiddenOptimal;
    }
  }

  const snapshot = {
    capturedAt: source.capturedAt,
    source: { name: "Artificial Analysis", url: source.sourceUrl },
    provenance: source.provenance,
    counts: {
      modelsInSource: source.models.length,
      endpointsInSource: source.endpoints.length,
      plotted: rows.length,
      distinctModels: new Set(rows.map((r) => r.slug)).size,
    },
    latencyDefinitions: Object.fromEntries(
      Object.entries(LATENCY).map(([k, v]) => [k, { label: v.label, hint: v.hint }]),
    ),
    fronts,
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot));

  console.log(`captured ${snapshot.capturedAt}`);
  console.log(`plotted ${rows.length} configurations across ${snapshot.counts.distinctModels} models`);
  for (const [key, f] of Object.entries(fronts)) {
    console.log(
      `  ${key.padEnd(18)} 3D ${String(f.stats.front3d).padStart(3)} | int-cost ${String(
        f.stats.frontIntCost,
      ).padStart(3)} | int-time ${String(f.stats.frontIntTime).padStart(3)} | hidden ${f.stats.hiddenOptimal}`,
    );
  }
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
