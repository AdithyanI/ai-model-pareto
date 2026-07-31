/**
 * Orthographic projection of a unit cube.
 *
 * Orthographic (not perspective) is a deliberate choice: it means that at
 * azimuth 0 / elevation 0 the rendered scene is *exactly* a 2D scatter plot of
 * x against y, with no foreshortening. The two published charts are therefore
 * literally one scene at two camera angles, and moving between them can be a
 * rotation of the same points rather than a cut to a different picture.
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
    label: "Smart vs cheap",
    caption: "Speed is the axis it cannot show.",
    azimuth: 0,
    elevation: 0,
    axes: { horizontal: "cost", vertical: "intelligence", collapsed: "time" },
  },
  intelligenceTime: {
    id: "intelligenceTime",
    label: "Smart vs fast",
    caption: "Turn ninety degrees and a different set wins. Price is the missing axis now.",
    azimuth: Math.PI / 2,
    elevation: 0,
    axes: { horizontal: "time", vertical: "intelligence", collapsed: "cost" },
  },
  /**
   * Not a camera angle: the same smart-vs-cheap chart, drawn three times under
   * three different deadlines. Rendered by `panels.mjs` rather than the scene.
   *
   * This replaced a rotatable 3D cube. The cube was honest but nearly unusable
   * — under orthographic projection a reader cannot tell which of two dots is
   * nearer, which is exactly the judgement the third axis demands. Splitting
   * the chart asks only for a left-to-right comparison of position, and loses
   * nothing: the union of the panel frontiers is provably the whole three-way
   * frontier. See `budgets.mjs`.
   */
  budget: {
    id: "budget",
    label: "All three",
    kind: "panels",
    caption: "Name a deadline and the winners change. The published chart is the last panel.",
    axes: { horizontal: "cost", vertical: "intelligence", collapsed: "time" },
  },
};

/**
 * The views offered in the UI. The cost-versus-time front stays computed,
 * because dominance in that plane is part of deciding what counts as hidden —
 * but it is not a chart anyone publishes, so putting it on screen would cost a
 * reader more than it tells them.
 */
export const VIEW_ORDER = ["intelligenceCost", "intelligenceTime", "budget"];

/**
 * How axis-aligned the camera currently is: 1 at a flat view, 0 once it has
 * rotated meaningfully away. Drives the blend between "fill the frame like an
 * ordinary chart" and "keep the cube square so rotation reads as rotation".
 */
export function flatness(camera) {
  const quarter = Math.PI / 2;
  const off = Math.hypot(angleTo(camera.azimuth, quarter), angleTo(camera.elevation, quarter));
  const tolerance = 0.25;
  return Math.max(0, 1 - off / tolerance);
}

function angleTo(angle, step) {
  const m = ((angle % step) + step) % step;
  return Math.min(m, step - m);
}

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

/**
 * Nice round tick values across a domain, in data space. A log axis gets one
 * tick per decade, plus a mid-decade tick when the span is short enough that
 * decade-only ticks would read as a nearly bare axis.
 */
export function ticks(scale, count = 5) {
  const [lo, hi] = scale.domain;
  if (scale.log) {
    const decades = Math.log10(hi) - Math.log10(lo);
    const mults = decades > 3.2 ? [1] : [1, 3];
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const m of mults) {
        const v = m * Math.pow(10, e);
        if (v >= lo * 0.98 && v <= hi * 1.02) out.push(v);
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
