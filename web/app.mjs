import { Scene } from "./lib/scene.mjs";
import { Panels } from "./lib/panels.mjs";
import { budgetPanels } from "./lib/budgets.mjs";
import { AXES, formatCost, formatSeconds, formatRatio } from "./lib/axes.mjs";
import { VIEWS, VIEW_ORDER, makeScale, shortestAngle, easeInOutCubic } from "./lib/projection.mjs";
import { paretoFront, dominates, OBJECTIVES } from "./lib/pareto.mjs";

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
  rows: [],
};

const isPanelView = (id = state.view) => VIEWS[id].kind === "panels";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function boot() {
  const res = await fetch("./data/snapshot.json");
  state.data = await res.json();
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
 */
function resize() {
  const wrap = $(".canvas-wrap");
  scene.resize();
  panels.resize();
  wrap.classList.toggle("is-panels", isPanelView());
  wrap.classList.toggle("is-stacked", panels.compact);
  scene.resize();
  panels.resize();
}

/** Rows currently in scope, with the active latency resolved onto `time`. */
function activeRows() {
  return state.data.rows.filter((r) => {
    if (!Number.isFinite(r.latencies[state.latency])) return false;
    if (state.scope === "representative" && !r.representative) return false;
    if (state.scope === "open" && !r.openWeights) return false;
    return true;
  });
}

function rebuild() {
  const rows = activeRows();
  for (const r of rows) r.time = r.latencies[state.latency];
  state.rows = rows;

  // Dominance is recomputed against exactly the configurations on screen, so a
  // point is never greyed out by a rival the reader has filtered away.
  const { intelligence, cost, time } = OBJECTIVES;
  const ids = (front) => new Set(front.map((r) => r.id));
  const f3d = ids(paretoFront(rows, [intelligence, cost, time]));
  const fic = ids(paretoFront(rows, [intelligence, cost]));
  const fit = ids(paretoFront(rows, [intelligence, time]));
  const fct = ids(paretoFront(rows, [cost, time]));
  state.fronts = { intelligenceCost: fic, intelligenceTime: fit, costTime: fct };

  const scales = {
    cost: makeScale(rows.map((r) => r.cost), { log: true }),
    intelligence: makeScale(rows.map((r) => r.intelligence)),
    time: makeScale(rows.map((r) => r.time), { log: true }),
  };
  state.scales = scales;

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

  scene.setPoints(points);
  panels.setPoints(points);
  state.points = points;
  // The panels are the same finding, decomposed: the union of their frontiers
  // is the three-way frontier exactly. See lib/budgets.mjs.
  state.panels = budgetPanels(rows, state.fronts);
  const revealed = new Set();
  for (const panel of state.panels) for (const id of panel.revealed) revealed.add(id);

  state.counts = {
    plotted: points.length,
    hidden: points.filter((p) => p.state === "hidden").length,
    front3d: points.filter((p) => p.onFront.three).length,
    frontIntCost: fic.size,
    frontIntTime: fit.size,
    revealedHere: revealed.size,
  };

  // Keep any selection alive across a rebuild.
  if (state.selected) {
    state.selected = points.find((p) => p.id === state.selected.id) ?? null;
    scene.selected = state.selected;
    panels.selected = state.selected;
  }

  renderFinding();
  renderDetail();
  renderWorkedExample();
  $("#view-caption").textContent = viewCaption(VIEWS[state.view]);
}

function draw() {
  if (isPanelView()) {
    panels.render({ panels: state.panels, scales: state.scales });
    return;
  }
  scene.render({
    view: state.view,
    scales: state.scales,
    fronts: state.fronts,
  });
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
  $("#view-caption").textContent = viewCaption(target);
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
 * Lead the caption with how many models win the chart on screen. The whole
 * argument is that the two published charts disagree about the answer and
 * still both miss some, which only lands if the reader sees the counts move.
 */
function viewCaption(view) {
  const c = state.counts;
  if (view.kind === "panels") {
    const list = state.panels ?? [];
    const first = list[0];
    const last = list[list.length - 1];
    // With too small a field to cut, there is only the unlimited panel and no
    // contrast to describe.
    if (list.length < 2) return view.caption;
    return `${first.leaders.size} models are worth buying under ${first.label.replace("Under ", "")}, ${last.leaders.size} with no deadline at all \u2014 and they are not the same models.`;
  }
  const n = view.id === "intelligenceCost" ? c.frontIntCost : c.frontIntTime;
  return `${n} models win this chart. ${view.caption}`;
}

function select(point) {
  state.selected = point;
  scene.selected = point;
  panels.selected = point;
  renderDetail();
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
    if (e.key === "Escape") {
      select(null);
      draw();
    }
  });

  $("#detail").addEventListener("click", (e) => {
    const el = e.target.closest("[data-pick]");
    if (!el) return;
    const point = state.points.find((p) => p.id === el.dataset.pick);
    if (point) {
      select(point);
      draw();
    }
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
  const wins = state.panels.filter((panel) => panel.leaders.has(p.id));
  if (wins.length === 0) return `<p class="tooltip-note">Beaten under every deadline shown.</p>`;
  // Echo the panel headings verbatim so the reader can find them on the chart.
  return `<p class="tooltip-note">Best value in: ${escapeHtml(
    wins.map((w) => w.label).join(" \u00b7 "),
  )}</p>`;
}

/** Where a value sits in the field, 0 worst to 1 best, on the plotted scale. */
function goodness(row, key) {
  const n = state.scales[key](row[key]);
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
    el.innerHTML = emptyDetailHtml();
    return;
  }

  const r = p.row;
  const rivals = {
    intCost: bestRival(r, [OBJECTIVES.intelligence, OBJECTIVES.cost]),
    intTime: bestRival(r, [OBJECTIVES.intelligence, OBJECTIVES.time]),
    three: bestRival(r, [OBJECTIVES.intelligence, OBJECTIVES.cost, OBJECTIVES.time]),
  };

  el.innerHTML = `
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
            : "Only the split view finds it."
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

/** The most convincing rival: the one that dominates with the most intelligence. */
function bestRival(row, objectives) {
  let best = null;
  for (const other of state.rows) {
    if (other.id === row.id) continue;
    if (!dominates(other, row, objectives)) continue;
    if (!best || other.intelligence > best.intelligence) best = other;
  }
  return best;
}

/**
 * With nothing selected, answer the question a first-time reader actually has:
 * of the models that survive on all three axes, which is the pick?
 */
function emptyDetailHtml() {
  const front = state.points.filter((p) => p.onFront.three);
  if (front.length === 0) return `<p class="detail-empty">No configurations in this filter.</p>`;

  const pick = (label, fn, key) => {
    const p = front.reduce((a, b) => (fn(b.row) > fn(a.row) ? b : a));
    return `
      <button class="pick" data-pick="${p.id}">
        <span class="pick-l">${label}</span>
        <span class="pick-n">${escapeHtml(p.row.shortName)}</span>
        <span class="pick-v">${escapeHtml(AXES[key].format(p.row[key]))}</span>
      </button>`;
  };

  return `
    <p class="detail-lead">Of the ${front.length} that survive on all three axes:</p>
    <div class="picks">
      ${pick("Smartest", (r) => r.intelligence, "intelligence")}
      ${pick("Cheapest", (r) => -r.cost, "cost")}
      ${pick("Fastest", (r) => -r.time, "time")}
    </div>
    <p class="detail-empty">Pick any point on the chart to see what beats it, and what does not.</p>`;
}

function renderFinding() {
  const c = state.counts;
  $("#finding").innerHTML = `
    <span class="figure"><b>${c.plotted}</b> models on the chart</span>
    <span class="figure figure-front"><b>${c.front3d}</b> worth considering</span>
    <span class="figure figure-hidden"><b>${c.hidden}</b> the flat charts hide</span>`;
  $("#front-note").textContent =
    `Of the ${c.plotted} configurations shown, ${c.frontIntCost} lead the smart-vs-cheap chart and ` +
    `${c.frontIntTime} lead smart-vs-fast. Judge all three axes at once and ${c.front3d} survive, ` +
    `of which ${c.hidden} appear on neither published chart.`;
  canvas.setAttribute("aria-label", altText());
}

// ------------------------------------------------------------ worked example

/**
 * Every rival that beats a hidden winner on a published chart is worse on the
 * axis that chart does not draw — and that is guaranteed, not observed. If any
 * of them were also no worse on the third axis it would beat the model
 * outright, and the model would not have survived the three-way test.
 *
 * So the honest figure to quote is the *smallest* penalty across all of them:
 * even the most favourable alternative that chart offers costs you this much.
 */
function rivalSummary(row, objectives, thirdKey) {
  const rivals = state.rows.filter((o) => o.id !== row.id && dominates(o, row, objectives));
  if (rivals.length === 0) return null;
  return {
    // The one a reader would actually be steered to: the strongest of them.
    pick: rivals.reduce((a, b) => (b.intelligence > a.intelligence ? b : a)),
    count: rivals.length,
    least: Math.min(...rivals.map((o) => o[thirdKey] / row[thirdKey])),
  };
}

/** The clearest case to walk through: both penalties large, so neither is a rounding error. */
function pickWorkedExample() {
  const { intelligence, cost, time } = OBJECTIVES;
  let best = null;
  for (const p of state.points) {
    if (p.state !== "hidden") continue;
    const onCost = rivalSummary(p.row, [intelligence, cost], "time");
    const onTime = rivalSummary(p.row, [intelligence, time], "cost");
    if (!onCost || !onTime) continue;
    const score = Math.min(onCost.least, onTime.least);
    if (!best || score > best.score || (score === best.score && p.row.intelligence > best.p.row.intelligence)) {
      best = { p, onCost, onTime, score };
    }
  }
  return best;
}

function renderWorkedExample() {
  const el = $("#worked");
  const ex = pickWorkedExample();
  if (!ex) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const r = ex.p.row;

  const card = (role, row, worseKey, note) => `
    <article class="worked-card${worseKey ? "" : " is-subject"}">
      <p class="worked-role">${role}</p>
      <h3>${escapeHtml(row.shortName)}</h3>
      <dl class="worked-stats">
        ${statRow("intelligence", row, worseKey)}
        ${statRow("cost", row, worseKey)}
        ${statRow("time", row, worseKey)}
      </dl>
      <p class="worked-note">${note}</p>
    </article>`;

  const penalty = (summary, key) => {
    const noun = key === "time" ? "slower" : "dearer";
    const ratio = formatRatio(summary.least);
    if (summary.count === 1) {
      return ratio
        ? `the only model that beats it there is <b>${escapeHtml(ratio)} ${noun}</b>`
        : `the only model that beats it there is ${noun}`;
    }
    return ratio
      ? `every one of the <b>${summary.count}</b> that beat it there is ${noun} &mdash; even the
         mildest by <b>${escapeHtml(ratio)}</b>`
      : `every one of the <b>${summary.count}</b> that beat it there is ${noun}`;
  };

  el.innerHTML = `
    <h2>One model, worked through</h2>
    <p class="worked-lead">
      <strong>${escapeHtml(r.shortName)}</strong> looks beaten on both published charts. It is not
      beaten by anything.
    </p>
    <div class="worked-grid">
      ${card(
        "The model",
        r,
        null,
        `Nothing in the field is at least as good on intelligence, price and speed together \u2014
         and yet neither published chart puts it on its frontier.`,
      )}
      ${card(
        "Smart vs cheap sends you to",
        ex.onCost.pick,
        "time",
        `Smarter and no dearer &mdash; but that chart never drew the clock, and
         ${penalty(ex.onCost, "time")}.`,
      )}
      ${card(
        "Smart vs fast sends you to",
        ex.onTime.pick,
        "cost",
        `Smarter and no slower &mdash; but that chart never drew the price, and
         ${penalty(ex.onTime, "cost")}.`,
      )}
    </div>
    <p class="worked-close">
      Two different rivals, each winning by ignoring a different axis. Put all three on the table
      and nothing in this field beats ${escapeHtml(r.shortName)} &mdash; which is why it shows up
      the moment you name a deadline, and never on a chart that assumes you have none.
    </p>`;
}

/** One line of the comparison, with the axis that chart ignored called out. */
function statRow(key, row, worseKey) {
  const meta = AXES[key];
  const worse = key === worseKey;
  return `
    <div${worse ? ' class="is-worse"' : ""}>
      <dt>${escapeHtml(meta.short)}</dt>
      <dd>${escapeHtml(meta.format(row[key]))}</dd>
    </div>`;
}

/**
 * A mark means something different in each view, so the legend is rebuilt with
 * the camera. On a flat chart a diamond is a winner of that chart; in the
 * rotated view it is a winner overall, and the second colour is the finding.
 */
function renderLegend() {
  const view = VIEWS[state.view];
  const c = state.counts;
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
  const c = state.counts;
  const v = VIEWS[state.view];
  if (v.kind === "panels") {
    const parts = (state.panels ?? [])
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
  $("#meta").innerHTML = `Data captured ${when.toISOString().slice(0, 16).replace("T", " ")} UTC from
    <a href="${d.source.url}" rel="noopener">${escapeHtml(d.source.name)}</a>.
    ${d.counts.endpointsInSource} endpoints in source, ${d.counts.plotted} with complete
    intelligence, cost and latency. Values are live and change; this page shows a snapshot.`;
}


function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

boot();
