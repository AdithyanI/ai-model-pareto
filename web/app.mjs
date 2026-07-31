import { Scene } from "./lib/scene.mjs";
import { Panels } from "./lib/panels.mjs";
import { AXES, formatCost, formatSeconds, formatRatio } from "./lib/axes.mjs";
import { VIEWS, VIEW_ORDER } from "./lib/projection.mjs";
import { shortestAngle, easeInOutCubic } from "./lib/projection.mjs";
import { OBJECTIVES } from "./lib/pareto.mjs";
import { loadSnapshot, filterRows, analyse, bestRival } from "./lib/analysis.mjs";
import { escapeHtml } from "./lib/html.mjs";

const $ = (sel) => document.querySelector(sel);
const canvas = $("#plot");
const scene = new Scene(canvas);
const panels = new Panels(canvas);

const state = {
  data: null,
  latency: "endToEnd",
  view: "intelligenceCost",
  scope: "representative",
  selected: null,
  animation: null,
  model: null,
};

const isPanelView = (id = state.view) => VIEWS[id].kind === "panels";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function boot() {
  state.data = await loadSnapshot();
  buildControls();
  rebuild();
  renderLegend();
  wireInteraction();
  renderMeta();
  resize();
  draw();
  window.addEventListener("resize", () => {
    resize();
    draw();
  });
  // Both renderers read their colours from CSS custom properties at paint
  // time, so a theme change leaves the canvas holding the old palette until
  // something else happens to trigger a repaint.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
}

/**
 * Measure, then let the stacked layout claim the height it needs, then measure
 * again. Changing the height cannot change the width, so `compact` is settled
 * on the first pass and this converges immediately.
 *
 * The chart fills the viewport, so the one case that cannot is three panels
 * stacked on a phone: `chart-stacked` on the body releases the page to scroll
 * rather than squeezing three charts into a third of a screen each.
 */
function resize() {
  const wrap = $(".canvas-wrap");
  scene.resize();
  panels.resize();
  wrap.classList.toggle("is-panels", isPanelView());
  wrap.classList.toggle("is-stacked", panels.compact);
  document.body.classList.toggle("chart-stacked", isPanelView() && panels.compact);
  scene.resize();
  panels.resize();
}

function rebuild() {
  const rows = filterRows(state.data, { latency: state.latency, scope: state.scope });
  state.model = analyse(rows);

  scene.setPoints(state.model.points);
  panels.setPoints(state.model.points);

  // Keep any selection alive across a rebuild.
  if (state.selected) {
    state.selected = state.model.points.find((p) => p.id === state.selected.id) ?? null;
    scene.selected = state.selected;
    panels.selected = state.selected;
  }

  renderDetail();
  $("#view-caption").innerHTML = viewCaption(VIEWS[state.view]);
  canvas.setAttribute("aria-label", altText());
}

function draw() {
  const { scales, fronts, panels: budgets } = state.model;
  if (isPanelView()) {
    panels.render({ panels: budgets, scales });
    return;
  }
  scene.render({ view: state.view, scales, fronts });
}

/**
 * Move to a view. Between the two published charts that is a rotation of the
 * same points, because they really are one scene at two camera angles and
 * seeing the dots travel is the cheapest way to say so. The split view is a
 * different kind of picture, so it simply appears.
 */
function goToView(id) {
  const target = VIEWS[id];
  const wasPanels = isPanelView();
  state.view = id;
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === id));
  });
  $("#view-caption").innerHTML = viewCaption(target);
  renderLegend();
  canvas.setAttribute("aria-label", altText());
  if (state.animation) cancelAnimationFrame(state.animation);

  if (isPanelView() || wasPanels) {
    // Canvas box changes shape between the two modes, so re-measure first.
    resize();
    if (!isPanelView()) scene.camera = { azimuth: target.azimuth, elevation: target.elevation };
    draw();
    return;
  }

  const from = { ...scene.camera };
  const to = {
    azimuth: shortestAngle(from.azimuth, target.azimuth),
    elevation: target.elevation,
  };

  if (reduceMotion) {
    scene.camera = { azimuth: target.azimuth, elevation: target.elevation };
    draw();
    return;
  }

  const duration = 950;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = easeInOutCubic(t);
    scene.camera = {
      azimuth: from.azimuth + (to.azimuth - from.azimuth) * e,
      elevation: from.elevation + (to.elevation - from.elevation) * e,
    };
    draw();
    state.animation = t < 1 ? requestAnimationFrame(step) : null;
  };
  state.animation = requestAnimationFrame(step);
}

function buildControls() {
  const views = $("#views");
  views.innerHTML = "";
  for (const id of VIEW_ORDER) {
    const b = document.createElement("button");
    b.className = VIEWS[id].kind === "panels" ? "chip chip-reveal" : "chip";
    b.dataset.view = id;
    b.textContent = VIEWS[id].label;
    b.setAttribute("aria-pressed", String(id === state.view));
    b.addEventListener("click", () => goToView(id));
    views.append(b);
  }

  const latency = $("#latency");
  for (const [key, def] of Object.entries(state.data.latencyDefinitions)) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = def.label;
    latency.append(o);
  }
  latency.value = state.latency;
  latency.addEventListener("change", () => {
    state.latency = latency.value;
    rebuild();
    draw();
  });

  const scope = $("#scope");
  scope.value = state.scope;
  scope.addEventListener("change", () => {
    state.scope = scope.value;
    select(null);
    rebuild();
    draw();
  });
}

/**
 * The chart has to introduce itself, because it is the whole page. Lead with
 * how many models win what is on screen: the argument is that the two
 * published charts disagree about the answer and still both miss some, which
 * only lands if the reader sees the count move as they switch.
 */
function viewCaption(view) {
  const c = state.model.counts;
  if (view.kind === "panels") {
    const list = state.model.panels;
    const first = list[0];
    const last = list[list.length - 1];
    // With too small a field to cut, there is only the unlimited panel and no
    // contrast to describe.
    if (list.length < 2) return escapeHtml(view.caption);
    return (
      `<b>${first.leaders.size} models</b> are the best buy under ` +
      `${escapeHtml(first.label.replace("Under ", ""))}, <b>${last.leaders.size}</b> if you will ` +
      `wait as long as it takes \u2014 and they are not the same models.`
    );
  }
  const n = view.id === "intelligenceCost" ? c.frontIntCost : c.frontIntTime;
  return `<b>${n} models</b> win this chart. ${escapeHtml(view.caption)}`;
}

function select(point) {
  state.selected = point;
  scene.selected = point;
  panels.selected = point;
  renderDetail();
  // The panel takes width from the chart rather than covering it, so the plot
  // has to be re-measured whenever it opens or closes.
  resize();
}

function setHovered(point) {
  scene.hovered = point;
  panels.hovered = point;
}

function wireInteraction() {
  const tooltip = $("#tooltip");
  const active = () => (isPanelView() ? panels : scene);

  const pointerPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = pointerPos(e);
    const hit = active().hitTest(x, y);
    if (hit !== active().hovered) {
      setHovered(hit);
      draw();
    }
    if (hit) {
      tooltip.hidden = false;
      tooltip.innerHTML = tooltipHtml(hit);
      const rect = canvas.getBoundingClientRect();
      let tx = x + 16;
      let ty = y + 16;
      if (tx + tooltip.offsetWidth > rect.width) tx = x - tooltip.offsetWidth - 16;
      if (ty + tooltip.offsetHeight > rect.height) ty = y - tooltip.offsetHeight - 16;
      tooltip.style.transform = `translate(${Math.max(4, tx)}px, ${Math.max(4, ty)}px)`;
      canvas.style.cursor = "pointer";
    } else {
      tooltip.hidden = true;
      canvas.style.cursor = "default";
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = pointerPos(e);
    select(active().hitTest(x, y));
    draw();
  });

  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    if (active().hovered) {
      setHovered(null);
      draw();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    const idx = VIEW_ORDER.indexOf(state.view);
    const n = VIEW_ORDER.length;
    if (e.key === "ArrowRight") goToView(VIEW_ORDER[(idx + 1) % n]);
    if (e.key === "ArrowLeft") goToView(VIEW_ORDER[(idx + n - 1) % n]);
    if (e.key === "Escape" && state.selected) {
      select(null);
      draw();
    }
  });

  $("#detail").addEventListener("click", (e) => {
    if (!e.target.closest("[data-close]")) return;
    select(null);
    draw();
  });
}

// ------------------------------------------------------------------ rendering

function tooltipHtml(p) {
  const r = p.row;
  const verdict =
    p.state === "hidden"
      ? `<span class="tag tag-hidden">Best \u2014 but on neither flat chart</span>`
      : p.onFront.three
        ? `<span class="tag tag-front">Nothing beats it</span>`
        : `<span class="tag tag-dominated">Something beats it</span>`;
  return `
    <strong>${escapeHtml(r.shortName)}</strong>
    <div class="tooltip-host">${escapeHtml(r.host ?? "unknown host")}</div>
    ${verdict}
    <dl>
      <div><dt>Intelligence</dt><dd>${r.intelligence.toFixed(1)}</dd></div>
      <div><dt>Cost</dt><dd>${formatCost(r.cost)}</dd></div>
      <div><dt>Time</dt><dd>${formatSeconds(r.time)}</dd></div>
    </dl>
    ${isPanelView() ? budgetLine(p) : ""}`;
}

/** In the split view the useful extra fact is which deadlines it wins under. */
function budgetLine(p) {
  const wins = state.model.panels.filter((panel) => panel.leaders.has(p.id));
  if (wins.length === 0) return `<p class="tooltip-note">Beaten under every deadline shown.</p>`;
  // Echo the panel headings verbatim so the reader can find them on the chart.
  return `<p class="tooltip-note">Best value in: ${escapeHtml(
    wins.map((w) => w.label).join(" \u00b7 "),
  )}</p>`;
}

/** Where a value sits in the field, 0 worst to 1 best, on the plotted scale. */
function goodness(row, key) {
  const n = state.model.scales[key](row[key]);
  return AXES[key].dir > 0 ? (n + 1) / 2 : 1 - (n + 1) / 2;
}

function metricBar(key, row) {
  const pct = Math.round(goodness(row, key) * 100);
  const value = AXES[key].format(row[key]);
  return `
    <div class="metric">
      <span class="metric-k">${escapeHtml(AXES[key].short)}</span>
      <span class="metric-bar"><i style="width:${pct}%"></i></span>
      <span class="metric-v">${escapeHtml(value)}</span>
    </div>`;
}

function renderDetail() {
  const el = $("#detail");
  const p = state.selected;
  if (!p) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  const r = p.row;
  const rows = state.model.rows;
  const rivals = {
    intCost: bestRival(rows, r, [OBJECTIVES.intelligence, OBJECTIVES.cost]),
    intTime: bestRival(rows, r, [OBJECTIVES.intelligence, OBJECTIVES.time]),
    three: bestRival(rows, r, [OBJECTIVES.intelligence, OBJECTIVES.cost, OBJECTIVES.time]),
  };

  el.hidden = false;
  el.innerHTML = `
    <button class="detail-close" data-close type="button" aria-label="Close">&times;</button>
    <div class="detail-head">
      <div>
        <h3>${escapeHtml(r.shortName)}</h3>
        <p class="detail-host">${escapeHtml(r.host ?? "unknown host")}${
          r.openWeights ? " \u00b7 open weights" : ""
        }${r.creator ? ` \u00b7 ${escapeHtml(r.creator)}` : ""}</p>
      </div>
      ${
        p.state === "hidden"
          ? `<span class="tag tag-hidden">Hidden winner</span>`
          : p.onFront.three
            ? `<span class="tag tag-front">Nothing beats it</span>`
            : `<span class="tag tag-dominated">Beaten</span>`
      }
    </div>
    <div class="metrics">
      ${metricBar("intelligence", r)}
      ${metricBar("cost", r)}
      ${metricBar("time", r)}
    </div>
    ${verdictHtml(p, rivals)}`;
}

/**
 * For a hidden winner, name the rival that knocks it off each published chart
 * and say what that rival gives up. That is the whole argument, per point.
 */
function verdictHtml(p, rivals) {
  const r = p.row;

  if (p.state === "hidden") {
    const lines = [
      rivalLine("On the smart-vs-cheap chart", rivals.intCost, r, "time"),
      rivalLine("On the smart-vs-fast chart", rivals.intTime, r, "cost"),
    ].filter(Boolean);
    return `
      <div class="verdict verdict-hidden">
        <p class="verdict-lead">Both published charts throw this one away. Neither is right.</p>
        <ul>${lines.join("")}</ul>
        <p class="verdict-close">Each rival wins only by ignoring an axis. Judge all three at
        once and nothing here beats it.</p>
      </div>`;
  }

  if (p.onFront.three) {
    const shows = [
      p.onFront.intCost ? "smart vs cheap" : null,
      p.onFront.intTime ? "smart vs fast" : null,
    ].filter(Boolean);
    return `
      <div class="verdict">
        <p class="verdict-lead">Nothing in this field is at least as good on intelligence,
        cost and speed together.</p>
        <p class="verdict-note">${
          shows.length
            ? `Visible on the ${escapeHtml(shows.join(" and "))} chart${shows.length > 1 ? "s" : ""}.`
            : "Only the split chart finds it."
        }</p>
      </div>`;
  }

  const beaten = rivals.three;
  return `
    <div class="verdict">
      <p class="verdict-lead">Beaten outright.</p>
      ${
        beaten
          ? `<p class="verdict-note"><strong>${escapeHtml(beaten.shortName)}</strong> on
             ${escapeHtml(beaten.host ?? "another host")} is smarter or equal, no dearer and no
             slower \u2014 ${escapeHtml(compareWords(beaten, r))}.</p>`
          : ""
      }
    </div>`;
}

function rivalLine(where, rival, row, givesUp) {
  if (!rival) return "";
  const ratio = formatRatio(rival[givesUp] / row[givesUp]);
  const cost = ratio
    ? `${ratio} ${givesUp === "cost" ? "the price" : "the wait"}`
    : `worse on ${AXES[givesUp].short.toLowerCase()}`;
  return `<li><span class="rival-where">${escapeHtml(where)}</span>
    <strong>${escapeHtml(rival.shortName)}</strong> looks better \u2014 but it is
    ${escapeHtml(cost)}.</li>`;
}

function compareWords(better, row) {
  const parts = [];
  if (better.intelligence > row.intelligence) {
    parts.push(`+${(better.intelligence - row.intelligence).toFixed(1)} intelligence`);
  }
  const cheaper = formatRatio(row.cost / better.cost);
  if (cheaper) parts.push(`${cheaper} cheaper`);
  const faster = formatRatio(row.time / better.time);
  if (faster) parts.push(`${faster} faster`);
  return parts.length ? parts.join(", ") : "equal or better on every axis";
}

/**
 * A mark means something different in each view, so the legend is rebuilt with
 * the camera. On a flat chart a diamond is a winner of that chart; in the
 * split view it is a winner under that deadline, and the second colour is the
 * finding.
 */
function renderLegend() {
  const view = VIEWS[state.view];
  const c = state.model.counts;
  if (view.kind === "panels") {
    $("#legend").innerHTML = `
      <span class="key"><i class="swatch swatch-front"></i>Best value inside this deadline</span>
      <span class="key"><i class="swatch swatch-hidden"></i>Best value here, <b>on neither published chart</b> (${c.revealedHere})</span>
      <span class="key"><i class="swatch swatch-dom"></i>Something in the same panel beats it</span>`;
    return;
  }
  // Naming the two axes teaches the test the chart is applying, which a bare
  // word like "optimal" never does.
  const both = `${AXES[view.axes.vertical].better} and ${AXES[view.axes.horizontal].better}`;
  $("#legend").innerHTML = `
    <span class="key"><i class="swatch swatch-front"></i>Nothing here is both <b>${escapeHtml(both)}</b></span>
    <span class="key"><i class="swatch swatch-dom"></i>Something on this chart is both</span>
    <span class="key"><i class="swatch swatch-line"></i>The frontier; everything shaded is beaten</span>`;
}

function altText() {
  const c = state.model.counts;
  const v = VIEWS[state.view];
  if (v.kind === "panels") {
    const parts = state.model.panels
      .map((p) => `${p.label.toLowerCase()}: ${p.count} models qualify and ${p.leaders.size} lead`)
      .join("; ");
    return (
      `The same intelligence-versus-cost chart drawn three times under three response-time ` +
      `deadlines \u2014 ${parts}. The set of leaders changes with the deadline, and ` +
      `${c.revealedHere} of the leaders shown appear on neither published two-axis chart.`
    );
  }
  return (
    `${v.label}. Scatter plot of ${c.plotted} AI model configurations by intelligence, cost per ` +
    `task and response time. A frontier line marks the best available at each price; ${c.front3d} ` +
    `configurations are not beaten on all three measures at once, and ${c.hidden} of those appear ` +
    `on neither of the two published two-axis charts.`
  );
}

function renderMeta() {
  const d = state.data;
  const when = new Date(d.capturedAt);
  $("#meta").innerHTML = `${when.toISOString().slice(0, 10)} snapshot of
    <a href="${d.source.url}" rel="noopener">${escapeHtml(d.source.name)}</a>. Values are live and change.`;
}

boot();
