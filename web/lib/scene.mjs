import { rotate, ticks, flatness, VIEWS } from "./projection.mjs";
import { AXES, betterEnd } from "./axes.mjs";
import { attainmentPath } from "./pareto.mjs";

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Chart colour is decided here rather than by the page's design language.
 * A scatter plot has to hold three roles apart across a hundred overlapping
 * marks a few pixels wide, which needs more chroma and a wider lightness gap
 * than calm UI accents give. Values live in the chart block of styles.css.
 */
export function palette() {
  return {
    bg: css("--surface", "#ffffff"),
    ink: css("--chart-ink", "#22272a"),
    label: css("--chart-label", "#5b6560"),
    grid: css("--chart-grid", "#eceeec"),
    axis: css("--chart-axis", "#4a534e"),
    beaten: css("--chart-beaten", "#c3c8c5"),
    frontier: css("--chart-frontier", "#116b4e"),
    frontierSoft: css("--chart-frontier-soft", "#cfe6da"),
    reveal: css("--chart-reveal", "#c2410c"),
    revealSoft: css("--chart-reveal-soft", "#fbdcc4"),
  };
}

/** The 12 edges of the unit cube, as index pairs into the 8 corners. */
const CORNERS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push({ x, y, z });
const EDGES = [];
for (let i = 0; i < CORNERS.length; i++) {
  for (let j = i + 1; j < CORNERS.length; j++) {
    const a = CORNERS[i];
    const b = CORNERS[j];
    if ((a.x !== b.x) + (a.y !== b.y) + (a.z !== b.z) === 1) EDGES.push([i, j]);
  }
}

/** Where each axis name hangs in the rotated view, just past its far corner. */
const LABEL_ANCHORS = [
  { key: "cost", x: 1.3, y: -1, z: -1 },
  { key: "intelligence", x: -1, y: 1.24, z: -1 },
  { key: "time", x: -1, y: -1, z: 1.3 },
];

// Canvas font strings are not CSS: `var(--font-sans)` there is invalid and the
// assignment is silently dropped, so the stack has to be literal.
const UI = "Inter, system-ui, -apple-system, sans-serif";
const TITLE = `600 13px ${UI}`;
const SUB = `500 11px ${UI}`;
const TICK = `11px ${UI}`;
const MARK = `500 11px ${UI}`;

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = [];
    this.camera = { azimuth: 0, elevation: 0 };
    this.hovered = null;
    this.selected = null;
    this.roles = new Map();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(240, rect.width);
    this.height = Math.max(240, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.compact = this.width < 580;
  }

  /**
   * A flat view spends its margins on axis furniture; a rotated one has none
   * to draw and can use nearly the whole canvas.
   */
  layout(isFlat) {
    const c = this.compact;
    // Flat views carry a three-line axis block below the plot (name, unit,
    // direction), which needs the same room whatever the viewport, because the
    // type does not shrink. Only the side margins compress.
    this.pad = isFlat
      ? { left: c ? 40 : 52, right: c ? 18 : 34, top: c ? 58 : 52, bottom: c ? 70 : 66 }
      : { left: 12, right: 12, top: 18, bottom: 18 };
    this.plot = {
      x0: this.pad.left,
      y0: this.pad.top,
      x1: this.width - this.pad.right,
      y1: this.height - this.pad.bottom,
    };
    this.cx = (this.plot.x0 + this.plot.x1) / 2;
    this.cy = (this.plot.y0 + this.plot.y1) / 2;
  }

  /**
   * A flat view should fill its frame like an ordinary chart, which means
   * stretching the two screen axes independently. A rotated view must not, or
   * the box would shear as it turns, so the stretch is capped there and then
   * blended by how far the camera has left an axis-aligned pose.
   *
   * Fitting uses the real bounding box rather than a symmetric extent: a
   * rotated cube plus its axis names is lopsided, and assuming symmetry leaves
   * a dead band down one side of the canvas.
   */
  fit(f) {
    const bounds = (pts) => {
      const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      for (const p of pts) {
        const r = rotate(p, this.camera.azimuth, this.camera.elevation);
        b.x0 = Math.min(b.x0, r.x);
        b.x1 = Math.max(b.x1, r.x);
        b.y0 = Math.min(b.y0, r.y);
        b.y1 = Math.max(b.y1, r.y);
      }
      return b;
    };

    // Rotated views must leave room for the axis names hanging outside the box.
    const box = bounds(CORNERS);
    const withLabels = bounds([...CORNERS, ...LABEL_ANCHORS]);
    const b = {
      x0: lerp(withLabels.x0, box.x0, f),
      x1: lerp(withLabels.x1, box.x1, f),
      y0: lerp(withLabels.y0, box.y0, f),
      y1: lerp(withLabels.y1, box.y1, f),
    };

    const availW = Math.max(40, this.plot.x1 - this.plot.x0);
    const availH = Math.max(40, this.plot.y1 - this.plot.y0);
    const sx = availW / Math.max(1e-6, b.x1 - b.x0);
    const sy = availH / Math.max(1e-6, b.y1 - b.y0);
    const uniform = Math.min(sx, sy);
    const cap = 1.8;

    return {
      kx: lerp(Math.min(sx, uniform * cap), sx, f),
      ky: lerp(Math.min(sy, uniform * cap), sy, f),
      ox: (b.x0 + b.x1) / 2,
      oy: (b.y0 + b.y1) / 2,
      flat: f,
    };
  }

  /** points: [{ id, cube:{x,y,z}, state, onFront, row }] */
  setPoints(points) {
    this.points = points;
  }

  toScreen(cube) {
    const r = rotate(cube, this.camera.azimuth, this.camera.elevation);
    const k = this.k;
    return { x: this.cx + (r.x - k.ox) * k.kx, y: this.cy - (r.y - k.oy) * k.ky, depth: r.depth };
  }

  hitTest(mx, my) {
    let best = null;
    let bestDist = 15;
    for (const p of this.points) {
      const d = Math.hypot(p.sx - mx, p.sy - my);
      const bias = this.roles.get(p.id) === "beaten" ? 4 : 0;
      if (d + bias < bestDist) {
        bestDist = d + bias;
        best = p;
      }
    }
    return best;
  }

  /**
   * What each mark means *in the view being shown*.
   *
   * A flat chart highlights its own winners and nothing else. Marking the
   * three-dimensional winners here would put emphasis inside the region this
   * same chart shades as beaten, which is a contradiction on the face of the
   * plot. The rotated view is where the extra winners appear, and there the
   * ones no flat chart could show are called out separately.
   */
  roleMap(view) {
    const roles = new Map();
    if (view.axes.horizontal) {
      const ids = this.fronts?.[view.id];
      for (const p of this.points) roles.set(p.id, ids?.has(p.id) ? "frontier" : "beaten");
    } else {
      for (const p of this.points) {
        roles.set(p.id, p.state === "hidden" ? "reveal" : p.onFront.three ? "frontier" : "beaten");
      }
    }
    return roles;
  }

  render(opts) {
    const { ctx } = this;
    const c = palette();
    const view = VIEWS[opts.view];
    const f = flatness(this.camera);
    const isFlat = Boolean(view.axes.horizontal) && f > 0.985;

    this.fronts = opts.fronts;
    this.viewId = opts.view;
    this.roles = this.roleMap(view);
    this.layout(isFlat);
    this.k = this.fit(f);

    for (const p of this.points) {
      const s = this.toScreen(p.cube);
      p.sx = s.x;
      p.sy = s.y;
      p.depth = s.depth;
    }

    ctx.clearRect(0, 0, this.width, this.height);

    if (isFlat) {
      this.frame = this.flatFrame(view);
      this.drawGrid(c, view, opts.scales);
      this.drawFrontier(c, view);
      this.drawPoints(c, false);
      this.drawFlatAxes(c, view, opts.scales);
    } else {
      this.frontierScreen = null;
      this.drawCube(c);
      this.drawDropLines(c);
      this.drawPoints(c, true);
      this.drawCubeAxisLabels(c);
    }

    this.drawLabels(c, isFlat);
  }

  // ---------------------------------------------------------------- flat view

  /**
   * Which end of each axis lands at screen left and screen bottom. The camera
   * decides this, not the cube: at some angles the low end of an axis projects
   * to the right, and furniture drawn at a hard-coded corner would then float
   * across the middle of the chart.
   */
  flatFrame(view) {
    const at = (h, v) => this.toScreen(cubeFor(view, h, v));
    const o = at(-1, -1);
    return { hNear: at(1, -1).x < o.x ? 1 : -1, vNear: at(-1, 1).y > o.y ? 1 : -1 };
  }

  drawGrid(c, view, scales) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    for (const key of ["horizontal", "vertical"]) {
      const scale = scales[view.axes[key]];
      for (const t of ticks(scale, 5)) {
        const n = scale(t);
        if (n < -1.001 || n > 1.001) continue;
        const ends = key === "horizontal" ? [[n, -1], [n, 1]] : [[-1, n], [1, n]];
        line(ctx, this.toScreen(cubeFor(view, ...ends[0])), this.toScreen(cubeFor(view, ...ends[1])));
      }
    }
    ctx.restore();
  }

  /**
   * The dominance boundary, drawn. Shading everything the frontier beats turns
   * "which of these is better?" into something read at a glance rather than
   * deduced from the colour of a four-pixel dot.
   */
  drawFrontier(c, view) {
    const hKey = view.axes.horizontal;
    const vKey = view.axes.vertical;
    const ids = this.fronts?.[view.id];
    if (!hKey || !ids) return;

    const ax = { cost: "x", intelligence: "y", time: "z" };
    const pts = this.points
      .filter((p) => ids.has(p.id))
      .map((p) => ({ h: p.cube[ax[hKey]], v: p.cube[ax[vKey]] }));
    if (pts.length < 2) return;

    const { line: path, region } = attainmentPath(pts, betterEnd(hKey), betterEnd(vKey));
    const { ctx } = this;
    const screen = (pt) => this.toScreen(cubeFor(view, pt.h, pt.v));
    const trace = (points) => {
      ctx.beginPath();
      const s0 = screen(points[0]);
      ctx.moveTo(s0.x, s0.y);
      for (const pt of points.slice(1)) {
        const s = screen(pt);
        ctx.lineTo(s.x, s.y);
      }
    };

    ctx.save();
    trace(region);
    ctx.closePath();
    ctx.fillStyle = c.frontier;
    ctx.globalAlpha = 0.05;
    ctx.fill();

    trace(path);
    ctx.strokeStyle = c.frontier;
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();

    this.frontierScreen = path.map(screen);
  }

  /**
   * Axes in the convention mathematical and economic charts use: a spine that
   * ends in an arrowhead pointing the way the quantity grows, ticks outside
   * the frame, and the name of the axis set beside that arrowhead rather than
   * floating. Each name carries its unit, its scale, and which direction is
   * the good one, because a reader should never have to infer any of the three.
   */
  drawFlatAxes(c, view, scales) {
    const { ctx } = this;
    const hKey = view.axes.horizontal;
    const vKey = view.axes.vertical;
    const hMeta = AXES[hKey];
    const vMeta = AXES[vKey];
    const { hNear, vNear } = this.frame;

    const origin = this.toScreen(cubeFor(view, hNear, vNear));
    const hFar = this.toScreen(cubeFor(view, -hNear, vNear));
    const vFar = this.toScreen(cubeFor(view, hNear, -vNear));

    ctx.save();
    ctx.strokeStyle = c.axis;
    ctx.fillStyle = c.axis;
    ctx.lineWidth = 1.2;
    line(ctx, origin, hFar);
    line(ctx, origin, vFar);

    // The arrowhead marks increasing value, so it sits at the cube's +1 end,
    // whichever side of the screen the camera has put that end on. `hNear` is
    // the end at screen left, so when that is already +1 the arrow belongs at
    // the origin and points the other way.
    arrowHead(ctx, hNear === 1 ? origin : hFar, hNear === 1 ? -1 : 1, 0);
    arrowHead(ctx, vNear === 1 ? origin : vFar, 0, vNear === 1 ? -1 : 1);

    ctx.font = TICK;
    ctx.fillStyle = c.label;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of ticks(scales[hKey], 5)) {
      const n = scales[hKey](t);
      if (n < -1.001 || n > 1.001) continue;
      const p = this.toScreen(cubeFor(view, n, vNear));
      ctx.strokeStyle = c.axis;
      line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y + 4 });
      ctx.fillText(hMeta.formatTick(t), p.x, p.y + 8);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of ticks(scales[vKey], 5)) {
      const n = scales[vKey](t);
      if (n < -1.001 || n > 1.001) continue;
      const p = this.toScreen(cubeFor(view, hNear, n));
      ctx.strokeStyle = c.axis;
      line(ctx, { x: p.x - 4, y: p.y }, { x: p.x, y: p.y });
      ctx.fillText(vMeta.formatTick(t), p.x - 8, p.y);
    }

    // Horizontal axis: name and unit on one line, direction beneath, centred
    // under the ticks where the eye already is after reading them.
    const midX = (origin.x + hFar.x) / 2;
    const baseY = origin.y + (this.compact ? 24 : 27);
    this.axisTitle(c, midX, baseY, "center", hMeta, hNear === betterEnd(hKey) ? "\u2190" : "\u2192");

    // Vertical axis: set horizontally above the top of the axis. Rotated text
    // is measurably slower to read, and there is free space up there anyway.
    // The block is three lines deep, so it has to clear the topmost tick
    // label rather than merely clear the plot edge.
    const topY = Math.min(origin.y, vFar.y);
    this.axisTitle(
      c,
      this.compact ? 2 : 6,
      topY - (this.compact ? 52 : 46),
      "left",
      vMeta,
      -vNear === betterEnd(vKey) ? "\u2191" : "\u2193",
    );
    ctx.restore();

  }

  axisTitle(c, x, y, align, meta, arrow) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = "top";

    ctx.font = TITLE;
    ctx.fillStyle = c.ink;
    ctx.fillText(meta.label, x, y);

    ctx.font = TICK;
    ctx.fillStyle = c.label;
    ctx.fillText(meta.unit, x, y + 16);

    ctx.font = SUB;
    ctx.fillStyle = c.frontier;
    ctx.fillText(`${arrow} ${meta.better} is better`, x, y + 30);
    ctx.restore();
  }

  // ------------------------------------------------------------------ 3D view

  drawCube(c) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    for (const [i, j] of EDGES) line(ctx, this.toScreen(CORNERS[i]), this.toScreen(CORNERS[j]));
    ctx.restore();
  }

  /** Depth is ambiguous under orthographic projection, so anchor what matters. */
  drawDropLines(c) {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 1;
    for (const p of this.points) {
      const role = this.roles.get(p.id);
      if (role === "beaten") continue;
      const reveal = role === "reveal";
      const floor = this.toScreen({ x: p.cube.x, y: -1, z: p.cube.z });
      ctx.strokeStyle = reveal ? c.reveal : c.frontier;
      ctx.globalAlpha = reveal ? 0.3 : 0.14;
      line(ctx, { x: p.sx, y: p.sy }, floor);
    }
    ctx.restore();
  }

  /**
   * Each axis is named at its far corner and told which end that corner is.
   * The word follows the axis direction rather than being fixed: the top of
   * the intelligence axis is its good end, while the far end of cost and of
   * time is the bad one.
   */
  drawCubeAxisLabels(c) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const anchor of LABEL_ANCHORS) {
      const p = this.toScreen(anchor);
      const meta = AXES[anchor.key];
      const good = meta.dir > 0;
      const name = this.compact ? meta.short : meta.label;
      const cue = good ? meta.better : meta.worse;

      // The anchor sits outside the cube, so on a narrow canvas the text can
      // run off the edge. Clamp by measured width rather than assuming the fit
      // left room: the camera decides where these land.
      ctx.font = TITLE;
      const wName = ctx.measureText(name).width;
      ctx.font = SUB;
      const wCue = ctx.measureText(cue).width;
      const half = Math.max(wName, wCue) / 2 + 4;
      const x = Math.min(Math.max(p.x, half), this.width - half);
      const y = Math.min(Math.max(p.y, 10), this.height - 16);

      ctx.font = TITLE;
      ctx.fillStyle = c.ink;
      ctx.fillText(name, x, y);
      // No arrow here: each name sits at the far end of its own axis, so the
      // position is the direction. An arrow would have to be redrawn per
      // camera angle to point along the axis, and points wrongly if it is not.
      ctx.font = SUB;
      ctx.fillStyle = good ? c.frontier : c.label;
      ctx.fillText(cue, x, y + 15);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------- points

  drawPoints(c, is3d) {
    const { ctx } = this;
    const rank = { beaten: 0, frontier: 1, reveal: 2 };
    const sorted = [...this.points].sort(
      (a, b) => rank[this.roles.get(a.id)] - rank[this.roles.get(b.id)] || a.depth - b.depth,
    );

    for (const p of sorted) {
      const role = this.roles.get(p.id);
      const fade = is3d ? 0.72 + 0.28 * ((p.depth + 1.8) / 3.6) : 1;
      const active = p === this.hovered || p === this.selected;

      if (role === "beaten") {
        ctx.globalAlpha = 0.6 * fade;
        ctx.fillStyle = c.beaten;
        dot(ctx, p.sx, p.sy, 2.4);
      } else {
        // Shape as well as colour, so a frontier survives both a colour-blind
        // reader and a compressed screenshot.
        const reveal = role === "reveal";
        ctx.globalAlpha = fade;
        ctx.fillStyle = reveal ? c.reveal : c.frontier;
        diamond(ctx, p.sx, p.sy, active ? 8 : 6.5);
        ctx.fill();
        ctx.strokeStyle = c.bg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (active) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = 1.5;
        ring(ctx, p.sx, p.sy, 11);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------- labels

  /**
   * Name the marks directly rather than making the reader hover. On a flat
   * chart that means the winners of that chart, walked along the frontier so
   * collision rejection thins them evenly instead of clustering at one end.
   */
  drawLabels(c, isFlat) {
    const { ctx } = this;
    const boxes = [];
    const drawn = [];

    const wanted = this.points.filter((p) => {
      const role = this.roles.get(p.id);
      return isFlat ? role === "frontier" : role === "reveal";
    });
    wanted.sort((a, b) => b.row.intelligence - a.row.intelligence);

    ctx.save();
    ctx.font = MARK;
    const dir = isFlat ? this.goodDirection() : { x: 1, y: -1 };
    for (const p of wanted) {
      // A narrow canvas cannot carry as many names before they collide into
      // noise, so the cap tightens with the viewport rather than being fixed.
      const cap = this.compact ? (isFlat ? 6 : 3) : isFlat ? 14 : 7;
      if (drawn.length >= cap) break;
      if (p === this.hovered || p === this.selected) continue;
      const box = this.placeLabel(p, boxes, ctx, false, dir);
      if (!box) continue;
      boxes.push(box);
      drawn.push({ p, box });
    }

    for (const { p, box } of drawn) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.roles.get(p.id) === "reveal" ? c.reveal : c.frontier;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(box.text, box.x, box.y + box.h / 2);
    }

    // The active point is labelled last and unconditionally, on a plate so it
    // stays legible wherever it lands.
    const active = this.hovered ?? this.selected;
    if (active) {
      ctx.font = `600 11px ${UI}`;
      const box = this.placeLabel(active, [], ctx, true);
      if (box) {
        ctx.globalAlpha = 0.94;
        ctx.fillStyle = c.bg;
        roundRect(ctx, box.x - 5, box.y - 3, box.w + 10, box.h + 6, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.ink;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(box.text, box.x, box.y + box.h / 2);
      }
    }
    ctx.restore();
  }

  /**
   * Which way the good corner lies, in screen pixels. Labels are pushed that
   * way because the region beyond the frontier holds no models by definition,
   * so it is the one part of the plot guaranteed to be free.
   */
  goodDirection() {
    const view = VIEWS[this.viewId];
    const { hNear, vNear } = this.frame;
    return {
      x: betterEnd(view.axes.horizontal) === hNear ? -1 : 1,
      y: betterEnd(view.axes.vertical) === vNear ? 1 : -1,
    };
  }

  placeLabel(p, boxes, ctx, force = false, dir = { x: 1, y: -1 }) {
    const text = p.row.shortName;
    const w = ctx.measureText(text).width;
    const h = 12;
    const gap = 11;
    // Ordered best-first: straight along the good direction, then the two
    // pure axes of it, then the fallbacks that point back into the field.
    const left = { x: p.sx - gap - w, y: p.sy - h / 2 };
    const right = { x: p.sx + gap, y: p.sy - h / 2 };
    const up = { x: p.sx - w / 2, y: p.sy - gap - h };
    const down = { x: p.sx - w / 2, y: p.sy + gap };
    const near = dir.x < 0 ? left : right;
    const far = dir.x < 0 ? right : left;
    const vNearC = dir.y < 0 ? up : down;
    const vFarC = dir.y < 0 ? down : up;
    const candidates = [
      { x: near.x, y: p.sy + dir.y * (gap * 0.7) - h / 2 },
      near,
      vNearC,
      { x: far.x, y: p.sy + dir.y * (gap * 0.7) - h / 2 },
      far,
      vFarC,
    ];

    for (const cand of candidates) {
      const box = { ...cand, w, h, text };
      if (
        box.x < this.plot.x0 - 6 ||
        box.x + box.w > this.plot.x1 + 6 ||
        box.y < this.plot.y0 - 2 ||
        box.y + box.h > this.plot.y1 + 2
      ) {
        continue;
      }
      if (force) return box;
      if (boxes.some((b) => overlaps(b, box))) continue;
      if (this.coversAMark(box, p)) continue;
      if (this.crossesFrontier(box)) continue;
      return box;
    }
    return force ? { ...candidates[0], w, h, text } : null;
  }

  /** A label struck through by the frontier line reads as deleted text. */
  crossesFrontier(box) {
    const path = this.frontierScreen;
    if (!path) return false;
    const pad = 3;
    const r = { x0: box.x - pad, y0: box.y - pad, x1: box.x + box.w + pad, y1: box.y + box.h + pad };
    for (let i = 1; i < path.length; i++) {
      if (segmentHitsRect(path[i - 1], path[i], r)) return true;
    }
    return false;
  }

  coversAMark(box, self) {
    for (const p of this.points) {
      if (p === self || this.roles.get(p.id) === "beaten") continue;
      if (p.sx > box.x - 6 && p.sx < box.x + box.w + 6 && p.sy > box.y - 6 && p.sy < box.y + box.h + 6) {
        return true;
      }
    }
    return false;
  }
}

/** Map flat-view (horizontal, vertical) coordinates back into cube space. */
function cubeFor(view, h, v) {
  const axis = { cost: 0, intelligence: 0, time: 0 };
  axis[view.axes.horizontal] = h;
  axis[view.axes.vertical] = v;
  axis[view.axes.collapsed] = -1;
  return { x: axis.cost, y: axis.intelligence, z: axis.time };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function overlaps(a, b) {
  return !(a.x + a.w < b.x - 4 || b.x + b.w < a.x - 4 || a.y + a.h < b.y - 3 || b.y + b.h < a.y - 3);
}

/**
 * Segment against rectangle. The frontier is a staircase, so every segment is
 * axis-aligned and an interval overlap on each axis is an exact test.
 */
function segmentHitsRect(a, b, r) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 <= r.x1 && x1 >= r.x0 && y0 <= r.y1 && y1 >= r.y0;
}

function arrowHead(ctx, at, dx, dy) {
  const len = 7;
  const wide = 3.4;
  ctx.beginPath();
  ctx.moveTo(at.x + dx * len, at.y - dy * len);
  ctx.lineTo(at.x - dy * wide, at.y - dx * wide);
  ctx.lineTo(at.x + dy * wide, at.y + dx * wide);
  ctx.closePath();
  ctx.fill();
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export { AXES };
