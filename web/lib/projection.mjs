/**
 * Orthographic projection of a unit cube.
 *
 * Orthographic (not perspective) is a deliberate choice: it means that at
 * azimuth 0 / elevation 0 the rendered scene is *exactly* a 2D scatter plot of
 * x against y, with no foreshortening. That is what lets the published 2D
 * charts and the 3D view be the same scene at different camera angles rather
 * than separate visualisations.
 *
 * Axis convention in cube space, each normalised to [-1, 1]:
 *   x -> cost        (right is more expensive)
 *   y -> intelligence(up is smarter)
 *   z -> time        (toward the viewer is slower)
 */

export function rotate(p, azimuth, elevation) {
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);

  const x1 = p.x * ca + p.z * sa;
  const z1 = -p.x * sa + p.z * ca;
  const y2 = p.y * ce - z1 * se;
  const z2 = p.y * se + z1 * ce;

  return { x: x1, y: y2, depth: z2 };
}

/** Camera angles whose projections reproduce each familiar chart exactly. */
export const VIEWS = {
  intelligenceCost: {
    id: "intelligenceCost",
    label: "Intelligence vs Cost",
    caption: "The first chart in the thread. Time is hidden: it points straight at you.",
    azimuth: 0,
    elevation: 0,
    axes: { horizontal: "cost", vertical: "intelligence", collapsed: "time" },
  },
  intelligenceTime: {
    id: "intelligenceTime",
    label: "Intelligence vs Time",
    caption: "The second chart. Now cost is the hidden axis.",
    azimuth: Math.PI / 2,
    elevation: 0,
    axes: { horizontal: "time", vertical: "intelligence", collapsed: "cost" },
  },
  costTime: {
    id: "costTime",
    label: "Cost vs Time",
    caption: "Looking down from above. Intelligence is now the hidden axis.",
    azimuth: 0,
    elevation: Math.PI / 2,
    axes: { horizontal: "cost", vertical: "time", collapsed: "intelligence" },
  },
  three: {
    id: "three",
    label: "All three",
    caption: "The object the charts were flat views of. Nothing is hidden.",
    azimuth: -0.62,
    elevation: 0.42,
    axes: { horizontal: null, vertical: null, collapsed: null },
  },
};

export const VIEW_ORDER = ["intelligenceCost", "intelligenceTime", "costTime", "three"];

/** Shortest angular path, so a camera move never spins the long way round. */
export function shortestAngle(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta;
}

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Linear scale into [-1, 1], with log support for the heavily skewed axes. */
export function makeScale(values, { log = false } = {}) {
  const mapped = log ? values.map((v) => Math.log10(v)) : values;
  const min = Math.min(...mapped);
  const max = Math.max(...mapped);
  const span = max === min ? 1 : max - min;
  const scale = (v) => {
    const m = log ? Math.log10(v) : v;
    return ((m - min) / span) * 2 - 1;
  };
  scale.invert = (n) => {
    const m = ((n + 1) / 2) * span + min;
    return log ? Math.pow(10, m) : m;
  };
  scale.domain = [log ? Math.pow(10, min) : min, log ? Math.pow(10, max) : max];
  scale.log = log;
  return scale;
}

/** Nice round tick values across a domain, in data space. */
export function ticks(scale, count = 5) {
  const [lo, hi] = scale.domain;
  if (scale.log) {
    const out = [];
    const start = Math.floor(Math.log10(lo));
    const end = Math.ceil(Math.log10(hi));
    for (let e = start; e <= end; e++) {
      for (const m of [1, 3]) {
        const v = m * Math.pow(10, e);
        if (v >= lo * 0.95 && v <= hi * 1.05) out.push(v);
      }
    }
    return out.length > 2 ? out : [lo, Math.sqrt(lo * hi), hi];
  }
  const step = niceStep((hi - lo) / count);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function niceStep(raw) {
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  const nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * base;
}
