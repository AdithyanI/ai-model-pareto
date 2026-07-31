/**
 * Everything the pages agree about, with no DOM in it.
 *
 * The chart page and the reading page have to quote the same numbers or the
 * site contradicts itself, so filtering, dominance and the choice of worked
 * example all live here rather than in whichever page happened to need them
 * first.
 */
import { paretoFront, dominates, OBJECTIVES } from "./pareto.mjs";
import { makeScale } from "./projection.mjs";
import { budgetPanels } from "./budgets.mjs";

export async function loadSnapshot(url = "./data/snapshot.json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json();
}

/** Rows in scope, with the chosen latency resolved onto `time`. */
export function filterRows(data, { latency, scope }) {
  const rows = data.rows.filter((r) => {
    if (!Number.isFinite(r.latencies[latency])) return false;
    if (scope === "representative" && !r.representative) return false;
    if (scope === "open" && !r.openWeights) return false;
    return true;
  });
  for (const r of rows) r.time = r.latencies[latency];
  return rows;
}

/**
 * Dominance is computed against exactly the configurations passed in, so a
 * point is never greyed out by a rival the reader has filtered away.
 */
export function analyse(rows) {
  const { intelligence, cost, time } = OBJECTIVES;
  const ids = (front) => new Set(front.map((r) => r.id));
  const fic = ids(paretoFront(rows, [intelligence, cost]));
  const fit = ids(paretoFront(rows, [intelligence, time]));
  const fct = ids(paretoFront(rows, [cost, time]));
  const f3d = ids(paretoFront(rows, [intelligence, cost, time]));
  const fronts = { intelligenceCost: fic, intelligenceTime: fit, costTime: fct };

  const scales = {
    cost: makeScale(rows.map((r) => r.cost), { log: true }),
    intelligence: makeScale(rows.map((r) => r.intelligence)),
    time: makeScale(rows.map((r) => r.time), { log: true }),
  };

  const points = rows.map((r) => {
    const onFront = {
      three: f3d.has(r.id),
      intCost: fic.has(r.id),
      intTime: fit.has(r.id),
      costTime: fct.has(r.id),
    };
    // The finding: optimal in 3D, yet absent from both published flat charts.
    const hiddenOptimal = onFront.three && !onFront.intCost && !onFront.intTime;
    return {
      id: r.id,
      row: r,
      onFront,
      state: hiddenOptimal
        ? "hidden"
        : onFront.intCost || onFront.intTime || onFront.costTime
          ? "front2d"
          : onFront.three
            ? "front3d"
            : "dominated",
      cube: {
        x: scales.cost(r.cost),
        y: scales.intelligence(r.intelligence),
        z: scales.time(r.time),
      },
    };
  });

  // The panels are the same finding, decomposed: the union of their frontiers
  // is the three-way frontier exactly. See lib/budgets.mjs.
  const panels = budgetPanels(rows, fronts);
  const revealed = new Set();
  for (const panel of panels) for (const id of panel.revealed) revealed.add(id);

  const counts = {
    plotted: points.length,
    hidden: points.filter((p) => p.state === "hidden").length,
    front3d: points.filter((p) => p.onFront.three).length,
    frontIntCost: fic.size,
    frontIntTime: fit.size,
    revealedHere: revealed.size,
  };

  return { rows, fronts, scales, points, panels, counts };
}

/** The most convincing rival: the one that dominates with the most intelligence. */
export function bestRival(rows, row, objectives) {
  let best = null;
  for (const other of rows) {
    if (other.id === row.id) continue;
    if (!dominates(other, row, objectives)) continue;
    if (!best || other.intelligence > best.intelligence) best = other;
  }
  return best;
}

/**
 * Every rival that beats a hidden winner on a published chart is worse on the
 * axis that chart does not draw — and that is guaranteed, not observed. If any
 * of them were also no worse on the third axis it would beat the model
 * outright, and the model would not have survived the three-way test.
 *
 * So the honest figure to quote is the *smallest* penalty across all of them:
 * even the most favourable alternative that chart offers costs you this much.
 */
export function rivalSummary(rows, row, objectives, thirdKey) {
  const rivals = rows.filter((o) => o.id !== row.id && dominates(o, row, objectives));
  if (rivals.length === 0) return null;
  return {
    // The one a reader would actually be steered to: the strongest of them.
    pick: rivals.reduce((a, b) => (b.intelligence > a.intelligence ? b : a)),
    count: rivals.length,
    least: Math.min(...rivals.map((o) => o[thirdKey] / row[thirdKey])),
  };
}

/** The clearest case to walk through: both penalties large, so neither is a rounding error. */
export function pickWorkedExample({ rows, points }) {
  const { intelligence, cost, time } = OBJECTIVES;
  let best = null;
  for (const p of points) {
    if (p.state !== "hidden") continue;
    const onCost = rivalSummary(rows, p.row, [intelligence, cost], "time");
    const onTime = rivalSummary(rows, p.row, [intelligence, time], "cost");
    if (!onCost || !onTime) continue;
    const score = Math.min(onCost.least, onTime.least);
    if (
      !best ||
      score > best.score ||
      (score === best.score && p.row.intelligence > best.p.row.intelligence)
    ) {
      best = { p, onCost, onTime, score };
    }
  }
  return best;
}
