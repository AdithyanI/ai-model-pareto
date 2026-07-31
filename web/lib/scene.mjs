import { rotate, ticks } from "./projection.mjs";

const AXIS_META = {
  cost: { label: "Cost per Intelligence Index task", short: "Cost", format: (v) => `$${fmtNum(v)}` },
  intelligence: { label: "Intelligence Index", short: "Intelligence", format: (v) => v.toFixed(0) },
  time: { label: "Response time", short: "Time", format: (v) => `${fmtNum(v)}s` },
};

export function fmtNum(v) {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function palette() {
  return {
    bg: css("--bg", "#f7f8f6"),
    fg: css("--fg", "#1b1f1c"),
    muted: css("--muted", "#6b736c"),
    border: css("--border", "#dfe3df"),
    accent: css("--accent", "#6f9a7d"),
    accentInk: css("--accent-ink", "#4c7359"),
    accentLine: css("--accent-line", "#a9c6b3"),
    highlight: css("--highlight", "#c98a26"),
    highlightSoft: css("--highlight-soft", "#f2e2c4"),
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
    const diff = (a.x !== b.x) + (a.y !== b.y) + (a.z !== b.z);
    if (diff === 1) EDGES.push([i, j]);
  }
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = [];
    this.camera = { azimuth: 0, elevation: 0 };
    this.hovered = null;
    this.selected = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Room for axis tick labels on the left and below in the flat views.
    this.padX = Math.min(70, this.width * 0.09);
    this.padY = Math.min(56, this.height * 0.1);
    this.cx = this.width / 2 + this.padX * 0.32;
    this.cy = this.height / 2 - this.padY * 0.18;
  }

  /**
   * Scale the cube to fill the frame at the current camera angle. A flat view
   * then fills the canvas like an ordinary chart, while a rotated view zooms
   * out just enough to keep its corners inside.
   */
  fitScale() {
    let ex = 0;
    let ey = 0;
    for (const corner of CORNERS) {
      const r = rotate(corner, this.camera.azimuth, this.camera.elevation);
      ex = Math.max(ex, Math.abs(r.x));
      ey = Math.max(ey, Math.abs(r.y));
    }
    const halfW = Math.max(20, this.width / 2 - this.padX);
    const halfH = Math.max(20, this.height / 2 - this.padY);
    return Math.min(halfW / (ex || 1), halfH / (ey || 1));
  }

  /** points: [{ id, cube:{x,y,z}, state, row }] */
  setPoints(points) {
    this.points = points;
  }

  toScreen(cube) {
    const r = rotate(cube, this.camera.azimuth, this.camera.elevation);
    const k = this.scale ?? this.fitScale();
    return { x: this.cx + r.x * k, y: this.cy - r.y * k, depth: r.depth };
  }

  project() {
    for (const p of this.points) {
      const s = this.toScreen(p.cube);
      p.sx = s.x;
      p.sy = s.y;
      p.depth = s.depth;
    }
    return this.points;
  }

  hitTest(mx, my) {
    let best = null;
    let bestDist = 16;
    for (const p of this.points) {
      if (p.hidden) continue;
      const d = Math.hypot(p.sx - mx, p.sy - my);
      const bias = p.state === "dominated" ? 2 : 0;
      if (d + bias < bestDist) {
        bestDist = d + bias;
        best = p;
      }
    }
    return best;
  }

  render(opts) {
    const { ctx } = this;
    const c = palette();
    ctx.clearRect(0, 0, this.width, this.height);

    // Recomputed once per frame so every projection in the frame agrees.
    this.scale = this.fitScale();
    this.project();
    this.drawFrame(c, opts);
    this.drawPoints(c, opts);
  }

  drawFrame(c, { view, scales }) {
    const { ctx } = this;
    const flat = Math.abs(Math.sin(this.camera.elevation)) < 0.02 && isAxisAligned(this.camera.azimuth);

    // Cube edges: prominent in 3D, nearly gone when the camera is flat, since a
    // flat view should read as an ordinary 2D chart.
    const edgeAlpha = flat ? 0.1 : 0.4;
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 1;
    ctx.globalAlpha = edgeAlpha;
    for (const [i, j] of EDGES) {
      const a = this.toScreen(CORNERS[i]);
      const b = this.toScreen(CORNERS[j]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (view.axes.horizontal) this.drawFlatAxes(c, view, scales);
    else this.drawCubeAxisLabels(c, scales);
  }

  /** In a flat view, draw real chart axes with ticks along the cube's edge. */
  drawFlatAxes(c, view, scales) {
    const { ctx } = this;
    const hKey = view.axes.horizontal;
    const vKey = view.axes.vertical;
    const hScale = scales[hKey];
    const vScale = scales[vKey];

    ctx.save();
    ctx.font = "11px var(--font-ui, Inter), system-ui, sans-serif";
    ctx.fillStyle = c.muted;
    ctx.strokeStyle = c.border;

    const corner = this.toScreen(cubeFor(view, -1, -1));
    const hEnd = this.toScreen(cubeFor(view, 1, -1));
    const vEnd = this.toScreen(cubeFor(view, -1, 1));

    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    line(ctx, corner, hEnd);
    line(ctx, corner, vEnd);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of ticks(hScale, 5)) {
      const n = hScale(t);
      if (n < -1.001 || n > 1.001) continue;
      const p = this.toScreen(cubeFor(view, n, -1));
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + 4);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillText(AXIS_META[hKey].format(t), p.x, p.y + 7);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of ticks(vScale, 5)) {
      const n = vScale(t);
      if (n < -1.001 || n > 1.001) continue;
      const p = this.toScreen(cubeFor(view, -1, n));
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 4, p.y);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillText(AXIS_META[vKey].format(t), p.x - 7, p.y);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = c.fg;
    ctx.font = "600 12px var(--font-ui, Inter), system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const hLabel = hScale.log ? `${AXIS_META[hKey].label} (log)` : AXIS_META[hKey].label;
    ctx.fillText(hLabel, (corner.x + hEnd.x) / 2, corner.y + 26);

    ctx.save();
    ctx.translate(corner.x - 46, (corner.y + vEnd.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "bottom";
    const vLabel = vScale.log ? `${AXIS_META[vKey].label} (log)` : AXIS_META[vKey].label;
    ctx.fillText(vLabel, 0, 0);
    ctx.restore();
    ctx.restore();
  }

  /** In the 3D view, label each cube axis at its far end. */
  drawCubeAxisLabels(c, scales) {
    const { ctx } = this;
    ctx.save();
    ctx.font = "600 12px var(--font-ui, Inter), system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const specs = [
      { key: "cost", at: { x: 1.28, y: -1, z: -1 } },
      { key: "intelligence", at: { x: -1, y: 1.24, z: -1 } },
      { key: "time", at: { x: -1, y: -1, z: 1.28 } },
    ];
    for (const s of specs) {
      const p = this.toScreen(s.at);
      const arrow = s.key === "intelligence" ? "higher \u2191" : "higher \u2192";
      ctx.fillStyle = c.fg;
      ctx.fillText(AXIS_META[s.key].short, p.x, p.y);
      ctx.fillStyle = c.muted;
      ctx.font = "10px var(--font-ui, Inter), system-ui, sans-serif";
      ctx.fillText(scales[s.key].log ? `${arrow} (log)` : arrow, p.x, p.y + 13);
      ctx.font = "600 12px var(--font-ui, Inter), system-ui, sans-serif";
    }
    ctx.restore();
  }

  drawPoints(c, { emphasiseHidden, dimDominated }) {
    const { ctx } = this;
    const order = { dominated: 0, front2d: 1, front3d: 2, hidden: 3 };
    const visible = this.points.filter((p) => !p.hidden);
    visible.sort((a, b) => order[a.state] - order[b.state] || a.depth - b.depth);

    const flat =
      Math.abs(Math.sin(this.camera.elevation)) < 0.02 && isAxisAligned(this.camera.azimuth);

    // Depth is ambiguous in an orthographic 3D view, so anchor the points that
    // matter to the floor. Dominated points are left out to avoid a thicket.
    if (!flat) {
      ctx.save();
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 1;
      for (const p of visible) {
        if (p.state === "dominated") continue;
        const floor = this.toScreen({ x: p.cube.x, y: -1, z: p.cube.z });
        ctx.globalAlpha = p.state === "hidden" ? 0.3 : 0.16;
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy);
        ctx.lineTo(floor.x, floor.y);
        ctx.stroke();
        ctx.globalAlpha = p.state === "hidden" ? 0.28 : 0.14;
        ctx.fillStyle = c.muted;
        dot(ctx, floor.x, floor.y, 1.6);
      }
      ctx.restore();
    }

    for (const p of visible) {
      const depthCue = 0.82 + 0.18 * ((p.depth + 1.8) / 3.6);
      const isActive = p === this.hovered || p === this.selected;

      if (p.state === "dominated") {
        ctx.globalAlpha = (dimDominated ? 0.24 : 0.42) * depthCue;
        ctx.fillStyle = c.muted;
        dot(ctx, p.sx, p.sy, 2.4);
      } else if (p.state === "front2d" || p.state === "front3d") {
        ctx.globalAlpha = 0.95 * depthCue;
        ctx.fillStyle = c.accent;
        dot(ctx, p.sx, p.sy, 4);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = c.accentInk;
        ctx.lineWidth = 1;
        ring(ctx, p.sx, p.sy, 6);
      } else if (p.state === "hidden") {
        if (emphasiseHidden) {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = c.highlight;
          dot(ctx, p.sx, p.sy, 13);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.highlight;
        dot(ctx, p.sx, p.sy, 5);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = c.bg;
        ctx.lineWidth = 1.5;
        ring(ctx, p.sx, p.sy, 5);
      }

      if (isActive) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c.fg;
        ctx.lineWidth = 1.5;
        ring(ctx, p.sx, p.sy, 10);
      }
    }
    ctx.globalAlpha = 1;
  }
}

function isAxisAligned(azimuth) {
  const a = Math.abs(((azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI / 2));
  return a < 0.02 || Math.PI / 2 - a < 0.02;
}

/** Map flat-view (horizontal, vertical) coordinates back into cube space. */
function cubeFor(view, h, v) {
  const axis = { cost: 0, intelligence: 0, time: 0 };
  axis[view.axes.horizontal] = h;
  axis[view.axes.vertical] = v;
  axis[view.axes.collapsed] = -1;
  return { x: axis.cost, y: axis.intelligence, z: axis.time };
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

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export { AXIS_META };
