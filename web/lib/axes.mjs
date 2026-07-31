/**
 * Axis semantics, in one place.
 *
 * `dir` is the objective direction: +1 means larger is better. Everything the
 * chart says about which way is good — the arrows under an axis, the corner
 * marked "better", the direction the frontier staircase climbs — is derived
 * from this rather than hand-written per view, so a new view cannot disagree
 * with the dominance rules.
 */

export const AXES = {
  cost: {
    key: "cost",
    dir: -1,
    label: "Cost per task",
    short: "Cost",
    unit: "US$ to run one task \u00b7 log scale",
    better: "cheaper",
    worse: "pricier",
    log: true,
    format: (v) => formatCost(v),
    formatTick: (v) => formatCostTick(v),
  },
  intelligence: {
    key: "intelligence",
    dir: 1,
    label: "Intelligence",
    short: "Intelligence",
    unit: "Artificial Analysis index, 0\u2013100",
    better: "smarter",
    worse: "weaker",
    log: false,
    format: (v) => v.toFixed(1),
    formatTick: (v) => v.toFixed(0),
  },
  time: {
    key: "time",
    dir: -1,
    label: "Response time",
    short: "Time",
    unit: "seconds to finish one task \u00b7 log scale",
    better: "faster",
    worse: "slower",
    log: true,
    format: (v) => formatSeconds(v),
    formatTick: (v) => formatSeconds(v),
  },
};

export function formatCost(v) {
  if (v >= 10) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${trimZeros(v.toFixed(2))}`;
  if (v >= 0.01) return `$${trimZeros(v.toFixed(3))}`;
  return `$${trimZeros(v.toFixed(4))}`;
}

/** Ticks read as money, so they keep the cents column even when it is zero. */
export function formatCostTick(v) {
  if (v >= 1) return `$${v.toFixed(0)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}

export function formatSeconds(v) {
  if (v >= 90) return `${Math.round(v / 60)} min`;
  if (v >= 10) return `${v.toFixed(0)}s`;
  if (v >= 1) return `${trimZeros(v.toFixed(1))}s`;
  return `${trimZeros(v.toFixed(2))}s`;
}

/** Multiples read faster than raw ratios when explaining why a rival loses. */
export function formatRatio(v) {
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 10) return `${v.toFixed(0)}\u00d7`;
  if (v >= 1.1) return `${trimZeros(v.toFixed(1))}\u00d7`;
  return null;
}

function trimZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Which end of a cube axis is the good end, in normalised [-1, 1] space.
 * Cube space always runs low value at -1, so a "lower is better" axis is good
 * at -1 and a "higher is better" axis is good at +1.
 */
export function betterEnd(key) {
  return AXES[key].dir > 0 ? 1 : -1;
}
