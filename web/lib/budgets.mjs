/**
 * Splitting the field by a response-time budget.
 *
 * The two published charts each drop an axis, which is why a model can be
 * genuinely optimal and appear on neither. Rather than asking a reader to
 * recover the third axis from a rotating box, this splits the smart-vs-cheap
 * chart into a few panels, each holding only the models fast enough to meet a
 * stated deadline, and recomputes the frontier inside each one.
 *
 * That is not an approximation of the three-way frontier. It is exactly it:
 *
 *   union over all budgets T of  paretoFront({r : r.time <= T}, [int, cost])
 *     ===  paretoFront(all, [int, cost, time])
 *
 * Both directions hold, and neither needs anything to be interpolated:
 *
 *  - A leader of the budget-T panel is three-way optimal. Anything dominating
 *    it in 3D would be no slower, hence inside the same panel, and would
 *    dominate it there too.
 *  - A three-way optimal model leads the panel at T = its own response time,
 *    by the same argument run backwards.
 *
 * `test/pareto.test.mjs` asserts this against the live snapshot, so the claim
 * cannot quietly stop being true.
 */

import { paretoFront, OBJECTIVES } from "./pareto.mjs";
import { formatSeconds } from "./axes.mjs";

/**
 * Budgets a person would actually say out loud. A deadline is a decision the
 * reader brings, not a measurement, so it should read as "under ten seconds"
 * rather than "under 9.4 seconds" — but it still has to be *derived* from the
 * field on screen, or switching the latency measure would leave the cuts
 * stranded in a part of the range where no models live.
 */
const SAYABLE = [0.5, 1, 1.5, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300];

export function niceSeconds(v) {
  return SAYABLE.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

/**
 * Two cuts through the field, at the given quantiles of response time. The
 * defaults put roughly the fastest fifth in the first panel and the faster
 * half in the second, which keeps every panel populated enough to read as a
 * chart rather than a handful of stray dots.
 */
export function budgetCuts(rows, quantiles = [0.2, 0.5]) {
  const times = rows.map((r) => r.time).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length === 0) return [];
  const cuts = [];
  for (const q of quantiles) {
    const cut = niceSeconds(quantile(times, q));
    // Distinct, populated, and never so tight that the panel is nearly empty.
    if (cuts.includes(cut)) continue;
    if (times.filter((t) => t <= cut).length < 8) continue;
    cuts.push(cut);
  }
  return cuts.sort((a, b) => a - b);
}

/**
 * The panels of the split view: two deadlines, then no deadline at all.
 *
 * The final panel is the published smart-vs-cheap chart exactly — every model,
 * no constraint — which is the point of putting it last. The frontier a reader
 * has seen published is the special case where waiting is free.
 */
export function budgetPanels(rows, published, quantiles) {
  const { intelligence, cost } = OBJECTIVES;
  const limits = [...budgetCuts(rows, quantiles), Infinity];

  return limits.map((limit) => {
    const qualifying = rows.filter((r) => r.time <= limit);
    const leaders = new Set(paretoFront(qualifying, [intelligence, cost]).map((r) => r.id));
    // A leader here that leads neither published chart is a model the reader
    // could not have found from anything Artificial Analysis puts on screen.
    const revealed = qualifying.filter(
      (r) => leaders.has(r.id) && !published.intelligenceCost.has(r.id) && !published.intelligenceTime.has(r.id),
    );

    return {
      limit,
      unlimited: limit === Infinity,
      label: limit === Infinity ? "Any speed" : `Under ${formatSeconds(limit)}`,
      question:
        limit === Infinity
          ? "No deadline \u2014 the published chart"
          : `Answer within ${formatSeconds(limit)}`,
      qualifying,
      leaders,
      revealed: new Set(revealed.map((r) => r.id)),
      count: qualifying.length,
    };
  });
}
