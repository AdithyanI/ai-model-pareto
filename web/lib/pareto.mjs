/**
 * Pareto dominance over an arbitrary set of objectives.
 *
 * An objective is `{ key, dir }` where dir = 1 means larger is better and
 * dir = -1 means smaller is better. `b` dominates `a` when b is at least as
 * good on every objective and strictly better on at least one.
 *
 * `tolerance` (fraction, e.g. 0.01) makes dominance tolerance-aware: b only
 * counts as strictly better on an objective when it beats a by more than the
 * tolerance, which stops trivial benchmark noise from manufacturing frontier
 * points. Ties therefore both survive rather than both being eliminated.
 */

export const OBJECTIVES = {
  intelligence: { key: "intelligence", dir: 1 },
  cost: { key: "cost", dir: -1 },
  time: { key: "time", dir: -1 },
};

function atLeastAsGood(b, a, { key, dir }, tol) {
  const bv = b[key];
  const av = a[key];
  const slack = Math.abs(av) * tol;
  return dir > 0 ? bv >= av - slack : bv <= av + slack;
}

function strictlyBetter(b, a, { key, dir }, tol) {
  const bv = b[key];
  const av = a[key];
  const slack = Math.abs(av) * tol;
  return dir > 0 ? bv > av + slack : bv < av - slack;
}

export function dominates(b, a, objectives, tolerance = 0) {
  let strict = false;
  for (const obj of objectives) {
    if (!atLeastAsGood(b, a, obj, tolerance)) return false;
    if (strictlyBetter(b, a, obj, tolerance)) strict = true;
  }
  return strict;
}

/** Rows missing any objective value are excluded rather than silently coerced. */
export function isComparable(row, objectives) {
  return objectives.every((o) => Number.isFinite(row[o.key]));
}

export function paretoFront(rows, objectives, tolerance = 0) {
  const usable = rows.filter((r) => isComparable(r, objectives));
  return usable.filter((a) => !usable.some((b) => b !== a && dominates(b, a, objectives, tolerance)));
}

/**
 * The central finding: points that survive in 3D but look dominated in each of
 * the 2D projections that Artificial Analysis publishes.
 */
export function frontierBreakdown(rows, tolerance = 0) {
  const { intelligence, cost, time } = OBJECTIVES;
  const three = new Set(paretoFront(rows, [intelligence, cost, time], tolerance));
  const intCost = new Set(paretoFront(rows, [intelligence, cost], tolerance));
  const intTime = new Set(paretoFront(rows, [intelligence, time], tolerance));
  const costTime = new Set(paretoFront(rows, [cost, time], tolerance));

  for (const row of rows) {
    row.front3d = three.has(row);
    row.frontIntCost = intCost.has(row);
    row.frontIntTime = intTime.has(row);
    row.frontCostTime = costTime.has(row);
    // Optimal in three dimensions, invisible in both published charts.
    row.hiddenOptimal = row.front3d && !row.frontIntCost && !row.frontIntTime;
  }

  return {
    total: rows.length,
    front3d: three.size,
    frontIntCost: intCost.size,
    frontIntTime: intTime.size,
    frontCostTime: costTime.size,
    hiddenOptimal: rows.filter((r) => r.hiddenOptimal).length,
  };
}

/**
 * Sweep the simplex of preference weights over the three (normalised)
 * objectives and record which frontier point wins each weighting. This answers
 * "which of these could I ever rationally pick?" and collapses a large
 * frontier into a small set of genuinely reachable choices.
 */
export function preferenceMap(front, steps = 60) {
  if (front.length === 0) return [];
  const scale = (vals) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return (v) => (max === min ? 0.5 : (v - min) / (max - min));
  };
  const si = scale(front.map((r) => r.intelligence));
  const sc = scale(front.map((r) => Math.log10(r.cost)));
  const st = scale(front.map((r) => Math.log10(r.time)));
  const scored = front.map((r) => ({
    row: r,
    i: si(r.intelligence),
    c: 1 - sc(Math.log10(r.cost)),
    t: 1 - st(Math.log10(r.time)),
  }));

  const wins = new Map();
  let cells = 0;
  for (let x = 0; x <= steps; x++) {
    for (let y = 0; y <= steps - x; y++) {
      const wi = x / steps;
      const wc = y / steps;
      const wt = 1 - wi - wc;
      let best = scored[0];
      let bestValue = -Infinity;
      for (const s of scored) {
        const v = wi * s.i + wc * s.c + wt * s.t;
        if (v > bestValue) {
          bestValue = v;
          best = s;
        }
      }
      wins.set(best.row.id, (wins.get(best.row.id) ?? 0) + 1);
      cells++;
    }
  }

  return [...wins.entries()]
    .map(([id, n]) => ({ id, share: n / cells }))
    .sort((a, b) => b.share - a.share);
}
