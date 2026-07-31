/**
 * The split view: one chart repeated under three different deadlines.
 *
 * Small multiples, in the strict sense — every panel shares the same two axes
 * and the same scales, so the only thing that changes between them is which
 * models are allowed in and, as a result, which of them lead. Reading is a
 * left-to-right comparison of position, which is the visual channel people
 * judge most accurately; nothing here asks anyone to decode depth or a colour
 * ramp.
 *
 * Because the scales are shared, axis furniture is drawn once for the row
 * rather than repeated three times.
 */

import { AXES, betterEnd } from "./axes.mjs";
import { attainmentPath } from "./pareto.mjs";
import { ticks } from "./projection.mjs";
import { palette } from "./scene.mjs";

const UI = "Inter, system-ui, -apple-system, sans-serif";
const TITLE = `600 13px ${UI}`;
const HEAD = `600 13px ${UI}`;
const SUB = `500 11px ${UI}`;
const TICK = `11px ${UI}`;
const MARK = `500 10px ${UI}`;

const H_KEY = "cost";
const V_KEY = "intelligence";

export class Panels {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = [];
    this.marks = [];
    this.hovered = null;
    this.selected = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(240, rect.width);
    this.height = Math.max(240, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Below this the three panels are narrower than their own axis labels, so
    // they stack instead. The break is a measurement of the furniture, not a
    // device guess.
    this.compact = this.width < 660;
  }

  setPoints(points) {
    this.points = points;
  }

  /**
   * Three across on a wide canvas, three down on a narrow one. Stacking keeps
   * the shared horizontal scale readable; squeezing three panels into a phone
   * width would leave each about ninety pixels wide, at which point the
   * frontier is a scribble.
   */
  layout(n) {
    const c = this.compact;
    const left = c ? 38 : 44;
    const right = 12;
    const topName = 16;
    const headH = c ? 30 : 36;
    const tickH = 17;
    // Two lines of axis furniture below the last row of ticks, plus descender
    // room. Under-allocating here silently crops the axis name.
    const footH = 48;

    this.boxes = [];
    if (!c) {
      const gap = 18;
      const w = (this.width - left - right - gap * (n - 1)) / n;
      const y0 = topName + 10 + headH;
      const y1 = this.height - footH - tickH;
      for (let i = 0; i < n; i++) {
        const x0 = left + i * (w + gap);
        this.boxes.push({ x0, x1: x0 + w, y0, y1, head: y0 - headH });
      }
    } else {
      const gap = 14;
      const avail = this.height - (topName + 8) - footH - n * (headH + tickH) - (n - 1) * gap;
      const h = Math.max(60, avail / n);
      let y = topName + 8;
      for (let i = 0; i < n; i++) {
        const head = y;
        const y0 = y + headH;
        this.boxes.push({ x0: left, x1: this.width - right, y0, y1: y0 + h, head });
        y = y0 + h + tickH + gap;
      }
    }
    this.tickH = tickH;
  }

  toScreen(box, h, v) {
    return {
      x: box.x0 + ((h + 1) / 2) * (box.x1 - box.x0),
      y: box.y1 - ((v + 1) / 2) * (box.y1 - box.y0),
    };
  }

  hitTest(mx, my) {
    let best = null;
    let bestDist = 14;
    for (const m of this.marks) {
      const d = Math.hypot(m.x - mx, m.y - my) + (m.role === "beaten" ? 4 : 0);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    this.hitPanel = best ? best.panel : null;
    return best ? best.point : null;
  }

  render({ panels, scales }) {
    const { ctx } = this;
    const c = palette();
    this.panels = panels;
    this.scales = scales;
    this.layout(panels.length);
    this.marks = [];

    ctx.clearRect(0, 0, this.width, this.height);
    this.drawSharedVerticalName(c);
    this.frontierPaths = [];

    panels.forEach((panel, i) => {
      const box = this.boxes[i];
      this.drawHead(c, panel, box, i);
      this.drawGrid(c, box);
      this.drawFrontier(c, panel, box, i);
      this.drawPanelPoints(c, panel, box, i);
      this.drawSpines(c, box);
      this.drawTicks(c, box, i);
    });

    this.drawSharedHorizontalName(c);
    this.drawLabels(c);
  }

  /**
   * The panel heading is the reader's own question, not a bin label. "Answer
   * within 8s" is a decision someone actually makes; "8s\u201315s" is a bucket
   * invented by whoever drew the chart.
   */
  drawHead(c, panel, box, i) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    ctx.font = HEAD;
    ctx.fillStyle = panel.unlimited ? c.label : c.ink;
    ctx.fillText(panel.label, box.x0, box.head);

    ctx.font = SUB;
    ctx.fillStyle = c.label;
    const total = this.points.length;
    const lead = `${panel.leaders.size} lead`;
    const scope = panel.unlimited ? `all ${total} models` : `${panel.count} of ${total} models`;
    ctx.fillText(`${scope} \u00b7 ${lead}`, box.x0, box.head + 16);
    ctx.restore();
  }

  drawGrid(c, box) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    for (const t of ticks(this.scales[V_KEY], 4)) {
      const n = this.scales[V_KEY](t);
      if (n < -1.001 || n > 1.001) continue;
      const a = this.toScreen(box, -1, n);
      const b = this.toScreen(box, 1, n);
      line(ctx, a, b);
    }
    for (const t of this.hTicks()) {
      const n = this.scales[H_KEY](t);
      if (n < -1.001 || n > 1.001) continue;
      line(ctx, this.toScreen(box, n, -1), this.toScreen(box, n, 1));
    }
    ctx.restore();
  }

  /** Fewer ticks in a narrow panel, or the money labels collide into a smear. */
  hTicks() {
    const wide = this.compact ? true : (this.boxes[0].x1 - this.boxes[0].x0) > 190;
    const all = ticks(this.scales[H_KEY], wide ? 5 : 3);
    return wide ? all : all.filter((_, i) => i % 2 === 0);
  }

  drawFrontier(c, panel, box, index) {
    const { ctx } = this;
    const pts = panel.qualifying
      .filter((r) => panel.leaders.has(r.id))
      .map((r) => ({ h: this.scales[H_KEY](r[H_KEY]), v: this.scales[V_KEY](r[V_KEY]) }));
    this.frontierPaths[index] = [];
    if (pts.length < 2) return;

    const { line: path, region } = attainmentPath(pts, betterEnd(H_KEY), betterEnd(V_KEY));
    const trace = (points) => {
      ctx.beginPath();
      const s0 = this.toScreen(box, points[0].h, points[0].v);
      ctx.moveTo(s0.x, s0.y);
      for (const pt of points.slice(1)) {
        const s = this.toScreen(box, pt.h, pt.v);
        ctx.lineTo(s.x, s.y);
      }
    };
    this.frontierPaths[index] = path.map((pt) => this.toScreen(box, pt.h, pt.v));

    ctx.save();
    // Clip to the panel: the staircase runs out to the worst corner of the
    // scale, which on a shared scale can sit outside a panel's own extent.
    ctx.beginPath();
    ctx.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.clip();

    trace(region);
    ctx.closePath();
    ctx.fillStyle = c.frontier;
    ctx.globalAlpha = 0.05;
    ctx.fill();

    trace(path);
    ctx.strokeStyle = c.frontier;
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();
  }

  drawPanelPoints(c, panel, box, index) {
    const { ctx } = this;
    const active = this.hovered ?? this.selected;

    const rank = (r) => (panel.revealed.has(r.id) ? 2 : panel.leaders.has(r.id) ? 1 : 0);
    const sorted = [...panel.qualifying].sort((a, b) => rank(a) - rank(b));

    for (const row of sorted) {
      const point = this.pointFor(row.id);
      if (!point) continue;
      const s = this.toScreen(box, this.scales[H_KEY](row[H_KEY]), this.scales[V_KEY](row[V_KEY]));
      const role = panel.revealed.has(row.id) ? "reveal" : panel.leaders.has(row.id) ? "frontier" : "beaten";
      this.marks.push({ point, x: s.x, y: s.y, panel: index, role });

      const isActive = point === active;
      if (role === "beaten") {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = c.beaten;
        dot(ctx, s.x, s.y, 2.1);
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = role === "reveal" ? c.reveal : c.frontier;
        diamond(ctx, s.x, s.y, isActive ? 6.5 : 5);
        ctx.fill();
        ctx.strokeStyle = c.bg;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // The same model, ringed in every panel it survives into. Following one
      // point across the row is what shows that a deadline, not the model,
      // decided whether it looked good.
      if (isActive) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = 1.4;
        ring(ctx, s.x, s.y, 9);
      }
    }
    ctx.globalAlpha = 1;
  }

  pointFor(id) {
    if (!this.index || this.indexFor !== this.points) {
      this.index = new Map(this.points.map((p) => [p.id, p]));
      this.indexFor = this.points;
    }
    return this.index.get(id);
  }

  drawSpines(c, box) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = c.axis;
    ctx.lineWidth = 1.1;
    line(ctx, { x: box.x0, y: box.y0 }, { x: box.x0, y: box.y1 });
    line(ctx, { x: box.x0, y: box.y1 }, { x: box.x1, y: box.y1 });
    ctx.restore();
  }

  drawTicks(c, box, index) {
    const { ctx } = this;
    ctx.save();
    ctx.font = TICK;
    ctx.fillStyle = c.label;
    ctx.strokeStyle = c.axis;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of this.hTicks()) {
      const n = this.scales[H_KEY](t);
      if (n < -1.001 || n > 1.001) continue;
      const p = this.toScreen(box, n, -1);
      line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y + 4 });
      ctx.fillText(AXES[H_KEY].formatTick(t), p.x, p.y + 6);
    }

    // Shared scale, so the vertical numbers belong on the leftmost panel only
    // when the panels sit side by side. Stacked, every panel needs its own.
    if (this.compact || index === 0) {
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const t of ticks(this.scales[V_KEY], 4)) {
        const n = this.scales[V_KEY](t);
        if (n < -1.001 || n > 1.001) continue;
        const p = this.toScreen(box, -1, n);
        line(ctx, { x: p.x - 4, y: p.y }, { x: p.x, y: p.y });
        ctx.fillText(AXES[V_KEY].formatTick(t), p.x - 7, p.y);
      }
    }
    ctx.restore();
  }

  drawSharedVerticalName(c) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = TITLE;
    ctx.fillStyle = c.ink;
    const meta = AXES[V_KEY];
    ctx.fillText(`\u2191 ${meta.label}`, 0, 0);
    ctx.font = SUB;
    ctx.fillStyle = c.label;
    const w = measure(ctx, TITLE, `\u2191 ${meta.label}`);
    const tail = this.compact ? `${meta.better} is better` : `${meta.unit} \u00b7 ${meta.better} is better`;
    ctx.fillText(tail, w + 8, 2);
    ctx.restore();
  }

  drawSharedHorizontalName(c) {
    const { ctx } = this;
    const meta = AXES[H_KEY];
    const last = this.boxes[this.boxes.length - 1];
    const y = last.y1 + this.tickH + (this.compact ? 10 : 12);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = TITLE;
    ctx.fillStyle = c.ink;
    ctx.fillText(`\u2192 ${meta.label}`, this.boxes[0].x0, y);
    ctx.font = SUB;
    ctx.fillStyle = c.label;
    ctx.fillText(meta.unit, this.boxes[0].x0, y + 16);
    ctx.font = SUB;
    ctx.fillStyle = c.frontier;
    const w = measure(ctx, SUB, meta.unit);
    ctx.fillText(`\u00b7 \u2190 ${meta.better} is better`, this.boxes[0].x0 + w + 8, y + 16);
    ctx.restore();
  }

  /**
   * Only the models no published chart could show get named, plus whatever the
   * reader is pointing at. Naming every leader in three panels at once would
   * put fifty labels on the canvas.
   */
  drawLabels(c) {
    const { ctx } = this;
    ctx.save();
    ctx.font = MARK;
    const active = this.hovered ?? this.selected;
    const boxes = [];
    const perPanel = new Map();

    for (const m of this.marks) {
      if (m.role !== "reveal" || m.point === active) continue;
      const used = perPanel.get(m.panel) ?? 0;
      if (used >= (this.compact ? 2 : 3)) continue;
      const placed = this.place(ctx, m, boxes);
      if (!placed) continue;
      perPanel.set(m.panel, used + 1);
      boxes.push(placed);
      ctx.fillStyle = c.reveal;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(placed.text, placed.x, placed.y + placed.h / 2);
    }

    if (active) {
      ctx.font = `600 11px ${UI}`;
      for (const m of this.marks) {
        if (m.point !== active) continue;
        const placed = this.place(ctx, m, [], true);
        if (!placed) continue;
        ctx.globalAlpha = 0.94;
        ctx.fillStyle = c.bg;
        roundRect(ctx, placed.x - 4, placed.y - 3, placed.w + 8, placed.h + 6, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.ink;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(placed.text, placed.x, placed.y + placed.h / 2);
      }
    }
    ctx.restore();
  }

  place(ctx, mark, boxes, force = false) {
    const box = this.boxes[mark.panel];
    const text = mark.point.row.shortName;
    const w = ctx.measureText(text).width;
    const h = 11;
    const gap = 9;
    // Up and left first: beyond the frontier there are no models by
    // definition, so that quadrant of the panel is the one certain to be free.
    const candidates = [
      { x: mark.x + gap, y: mark.y - h / 2 - 5 },
      { x: mark.x - gap - w, y: mark.y - h / 2 - 5 },
      { x: mark.x - w / 2, y: mark.y - gap - h },
      { x: mark.x + gap, y: mark.y + gap },
    ];
    for (const cand of candidates) {
      const b = { ...cand, w, h, text };
      if (b.x < box.x0 - 2 || b.x + b.w > box.x1 + 2) continue;
      if (b.y < box.y0 - 2 || b.y + b.h > box.y1 + 2) continue;
      if (force) return b;
      if (boxes.some((o) => overlaps(o, b))) continue;
      if (this.coversAMark(b, mark)) continue;
      if (this.crossesFrontier(b, mark.panel)) continue;
      return b;
    }
    return force ? { ...candidates[0], w, h, text } : null;
  }

  /** A label struck through by the staircase reads as deleted text. */
  crossesFrontier(b, panel) {
    const path = this.frontierPaths?.[panel];
    if (!path || path.length < 2) return false;
    const pad = 2;
    const r = { x0: b.x - pad, y0: b.y - pad, x1: b.x + b.w + pad, y1: b.y + b.h + pad };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const z = path[i];
      // The staircase is axis-aligned, so interval overlap is an exact test.
      if (
        Math.min(a.x, z.x) <= r.x1 &&
        Math.max(a.x, z.x) >= r.x0 &&
        Math.min(a.y, z.y) <= r.y1 &&
        Math.max(a.y, z.y) >= r.y0
      ) {
        return true;
      }
    }
    return false;
  }

  coversAMark(b, self) {
    for (const m of this.marks) {
      if (m === self || m.panel !== self.panel || m.role === "beaten") continue;
      if (m.x > b.x - 5 && m.x < b.x + b.w + 5 && m.y > b.y - 5 && m.y < b.y + b.h + 5) return true;
    }
    return false;
  }
}

function measure(ctx, font, text) {
  const prev = ctx.font;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  ctx.font = prev;
  return w;
}

function overlaps(a, b) {
  return !(a.x + a.w < b.x - 3 || b.x + b.w < a.x - 3 || a.y + a.h < b.y - 2 || b.y + b.h < a.y - 2);
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
