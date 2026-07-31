import { Scene, fmtNum, AXIS_META } from "./lib/scene.mjs";
import { VIEWS, VIEW_ORDER, makeScale, shortestAngle, easeInOutCubic } from "./lib/projection.mjs";
import { paretoFront, OBJECTIVES } from "./lib/pareto.mjs";

const $ = (sel) => document.querySelector(sel);
const canvas = $("#plot");
const scene = new Scene(canvas);

const state = {
  data: null,
  latency: "endToEnd",
  view: "intelligenceCost",
  scope: "representative",
  emphasiseHidden: true,
  dimDominated: true,
  selected: null,
  animation: null,
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function boot() {
  const res = await fetch("./data/snapshot.json");
  state.data = await res.json();
  buildControls();
  rebuild();
  window.addEventListener("resize", () => {
    scene.resize();
    draw();
  });
  wireInteraction();
  renderMeta();
  scene.resize();
  draw();
}

/** Rows currently in scope, with the active latency resolved onto `time`. */
function activeRows() {
  const { data } = state;
  return data.rows.filter((r) => {
    if (!Number.isFinite(r.latencies[state.latency])) return false;
    if (state.scope === "representative" && !r.representative) return false;
    if (state.scope === "open" && !r.openWeights) return false;
    return true;
  });
}

function rebuild() {
  const rows = activeRows();
  for (const r of rows) r.time = r.latencies[state.latency];

  // Dominance is recomputed against exactly the configurations on screen, so a
  // point is never greyed out by a rival the reader has filtered away.
  const { intelligence, cost, time } = OBJECTIVES;
  const ids = (front) => new Set(front.map((r) => r.id));
  const f3d = ids(paretoFront(rows, [intelligence, cost, time]));
  const fic = ids(paretoFront(rows, [intelligence, cost]));
  const fit = ids(paretoFront(rows, [intelligence, time]));
  const fct = ids(paretoFront(rows, [cost, time]));

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
  state.counts = {
    plotted: points.length,
    hidden: points.filter((p) => p.state === "hidden").length,
    front3d: points.filter((p) => p.onFront.three).length,
    frontIntCost: fic.size,
    frontIntTime: fit.size,
  };

  // Keep any selection alive across a rebuild.
  if (state.selected) {
    const again = points.find((p) => p.id === state.selected.id);
    state.selected = again ?? null;
    scene.selected = state.selected;
  }

  renderStats();
  renderLegend();
  renderDetail();
}

function draw() {
  scene.render({
    view: VIEWS[state.view],
    scales: state.scales,
    emphasiseHidden: state.emphasiseHidden,
    dimDominated: state.dimDominated,
  });
}

/** Animate the camera to a view. Every view change is a camera move. */
function goToView(id) {
  const target = VIEWS[id];
  state.view = id;
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === id));
  });
  $("#view-caption").textContent = target.caption;

  const from = { ...scene.camera };
  const to = {
    azimuth: shortestAngle(from.azimuth, target.azimuth),
    elevation: target.elevation,
  };

  if (state.animation) cancelAnimationFrame(state.animation);
  if (reduceMotion) {
    scene.camera = { azimuth: target.azimuth, elevation: target.elevation };
    draw();
    return;
  }

  const duration = 900;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = easeInOutCubic(t);
    scene.camera = {
      azimuth: from.azimuth + (to.azimuth - from.azimuth) * e,
      elevation: from.elevation + (to.elevation - from.elevation) * e,
    };
    draw();
    if (t < 1) state.animation = requestAnimationFrame(step);
    else state.animation = null;
  };
  state.animation = requestAnimationFrame(step);
}

function buildControls() {
  const views = $("#views");
  views.innerHTML = "";
  for (const id of VIEW_ORDER) {
    const v = VIEWS[id];
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.view = id;
    b.textContent = v.label;
    b.setAttribute("aria-pressed", String(id === state.view));
    b.addEventListener("click", () => goToView(id));
    views.append(b);
  }

  const latency = $("#latency");
  latency.innerHTML = "";
  for (const [key, def] of Object.entries(state.data.latencyDefinitions)) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = def.label;
    latency.append(o);
  }
  latency.value = state.latency;
  latency.addEventListener("change", () => {
    state.latency = latency.value;
    $("#latency-hint").textContent = state.data.latencyDefinitions[state.latency].hint;
    rebuild();
    draw();
  });
  $("#latency-hint").textContent = state.data.latencyDefinitions[state.latency].hint;

  const scope = $("#scope");
  scope.value = state.scope;
  scope.addEventListener("change", () => {
    state.scope = scope.value;
    state.selected = null;
    scene.selected = null;
    rebuild();
    draw();
    renderDetail();
  });

  $("#toggle-hidden").addEventListener("change", (e) => {
    state.emphasiseHidden = e.target.checked;
    draw();
  });
  $("#toggle-dim").addEventListener("change", (e) => {
    state.dimDominated = e.target.checked;
    draw();
  });

  $("#view-caption").textContent = VIEWS[state.view].caption;
}

function wireInteraction() {
  const tooltip = $("#tooltip");
  let dragging = null;

  const pointerPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = pointerPos(e);

    if (dragging) {
      // Free rotation puts the reader in control of the object.
      const dx = e.clientX - dragging.x;
      const dy = e.clientY - dragging.y;
      scene.camera.azimuth = dragging.azimuth - dx * 0.008;
      scene.camera.elevation = clamp(dragging.elevation + dy * 0.008, -Math.PI / 2, Math.PI / 2);
      dragging.moved = dragging.moved || Math.hypot(dx, dy) > 3;
      if (dragging.moved) markFreeCamera();
      draw();
      return;
    }

    const hit = scene.hitTest(x, y);
    if (hit !== scene.hovered) {
      scene.hovered = hit;
      draw();
    }
    if (hit) {
      tooltip.hidden = false;
      tooltip.innerHTML = tooltipHtml(hit);
      const rect = canvas.getBoundingClientRect();
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      let tx = x + 14;
      let ty = y + 14;
      if (tx + tw > rect.width) tx = x - tw - 14;
      if (ty + th > rect.height) ty = y - th - 14;
      tooltip.style.transform = `translate(${Math.max(4, tx)}px, ${Math.max(4, ty)}px)`;
      canvas.style.cursor = "pointer";
    } else {
      tooltip.hidden = true;
      canvas.style.cursor = "grab";
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = pointerPos(e);
    const hit = scene.hitTest(x, y);
    if (hit) {
      state.selected = hit;
      scene.selected = hit;
      renderDetail();
      draw();
      return;
    }
    dragging = {
      x: e.clientX,
      y: e.clientY,
      azimuth: scene.camera.azimuth,
      elevation: scene.camera.elevation,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  });

  const endDrag = (e) => {
    if (dragging && !dragging.moved) {
      state.selected = null;
      scene.selected = null;
      renderDetail();
      draw();
    }
    dragging = null;
    canvas.style.cursor = "grab";
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    if (scene.hovered) {
      scene.hovered = null;
      draw();
    }
  });

  document.addEventListener("keydown", (e) => {
    const idx = VIEW_ORDER.indexOf(state.view);
    if (e.key === "ArrowRight") goToView(VIEW_ORDER[(idx + 1) % VIEW_ORDER.length]);
    if (e.key === "ArrowLeft") goToView(VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]);
    if (e.key === "Escape") {
      state.selected = null;
      scene.selected = null;
      renderDetail();
      draw();
    }
  });
}

function markFreeCamera() {
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  $("#view-caption").textContent = "Free camera. Pick a view to snap back to a familiar angle.";
}

function tooltipHtml(p) {
  const r = p.row;
  const badge =
    p.state === "hidden"
      ? `<span class="tag tag-hidden">Hidden from both flat charts</span>`
      : p.onFront.three
        ? `<span class="tag tag-front">On the 3D frontier</span>`
        : `<span class="tag tag-dominated">Dominated</span>`;
  return `
    <strong>${escapeHtml(r.model)}</strong>
    <div class="tooltip-host">${escapeHtml(r.host ?? "unknown host")}</div>
    ${badge}
    <dl>
      <div><dt>Intelligence</dt><dd>${r.intelligence.toFixed(1)}</dd></div>
      <div><dt>Cost / task</dt><dd>$${fmtNum(r.cost)}</dd></div>
      <div><dt>${escapeHtml(AXIS_META.time.short)}</dt><dd>${fmtNum(r.latencies[state.latency])}s</dd></div>
    </dl>`;
}

function renderDetail() {
  const el = $("#detail");
  const p = state.selected;
  if (!p) {
    el.innerHTML = `<p class="detail-empty">Select any point to see why it sits where it does, and what beats it.</p>`;
    return;
  }
  const r = p.row;
  const rows = activeRows();
  const dominators = rows.filter(
    (o) =>
      o.id !== r.id &&
      o.intelligence >= r.intelligence &&
      o.cost <= r.cost &&
      o.latencies[state.latency] <= r.latencies[state.latency],
  );

  const onCharts = [
    p.onFront.intCost ? "Intelligence vs Cost" : null,
    p.onFront.intTime ? "Intelligence vs Time" : null,
    p.onFront.costTime ? "Cost vs Time" : null,
  ].filter(Boolean);

  el.innerHTML = `
    <h3>${escapeHtml(r.model)}</h3>
    <p class="detail-host">${escapeHtml(r.host ?? "unknown host")}${
      r.openWeights ? " &middot; open weights" : ""
    }</p>
    <dl class="detail-metrics">
      <div><dt>Intelligence Index</dt><dd>${r.intelligence.toFixed(1)}${r.estimated ? " (est.)" : ""}</dd></div>
      <div><dt>Cost per task</dt><dd>$${fmtNum(r.cost)}</dd></div>
      <div><dt>${escapeHtml(state.data.latencyDefinitions[state.latency].label)}</dt><dd>${fmtNum(
        r.latencies[state.latency],
      )}s</dd></div>
    </dl>
    <p class="detail-line"><strong>Status.</strong> ${
      p.onFront.three
        ? "Nothing in this field is at least as good on all three axes."
        : `${dominators.length} configuration${dominators.length === 1 ? "" : "s"} beat${
            dominators.length === 1 ? "s" : ""
          } it on all three axes.`
    }</p>
    <p class="detail-line"><strong>Visible on.</strong> ${
      onCharts.length ? escapeHtml(onCharts.join(", ")) : "None of the flat charts."
    }</p>
    ${
      p.state === "hidden"
        ? `<p class="detail-callout">This is one of the configurations the two published charts cannot show. Each flat view finds something that beats it, but no single configuration beats it on all three axes at once.</p>`
        : ""
    }
    ${
      dominators.length
        ? `<p class="detail-line"><strong>Beaten by.</strong> ${escapeHtml(
            dominators
              .slice(0, 3)
              .map((d) => `${d.model} @ ${d.host}`)
              .join("; "),
          )}${dominators.length > 3 ? ` and ${dominators.length - 3} more` : ""}.</p>`
        : ""
    }`;
}

function renderStats() {
  const c = state.counts;
  $("#stats").innerHTML = `
    <div class="stat"><span class="stat-n">${c.plotted}</span><span class="stat-l">configurations plotted</span></div>
    <div class="stat"><span class="stat-n">${c.front3d}</span><span class="stat-l">survive in three dimensions</span></div>
    <div class="stat stat-key"><span class="stat-n">${c.hidden}</span><span class="stat-l">optimal, yet invisible on both flat charts</span></div>`;
  $("#front-note").textContent =
    `Of the ${c.plotted} configurations shown, ${c.frontIntCost} lead the intelligence-vs-cost chart and ` +
    `${c.frontIntTime} lead intelligence-vs-time. Judge all three axes at once and ${c.front3d} survive, ` +
    `of which ${c.hidden} appear on neither flat chart.`;
}

function renderLegend() {
  $("#legend").innerHTML = `
    <span class="key"><i class="swatch swatch-hidden"></i>Optimal only in 3D</span>
    <span class="key"><i class="swatch swatch-front"></i>Leads a flat chart</span>
    <span class="key"><i class="swatch swatch-dom"></i>Dominated</span>`;
}

function renderMeta() {
  const d = state.data;
  const when = new Date(d.capturedAt);
  $("#meta").innerHTML = `Data captured ${when.toISOString().slice(0, 16).replace("T", " ")} UTC from
    <a href="${d.source.url}" rel="noopener">${escapeHtml(d.source.name)}</a>.
    ${d.counts.endpointsInSource} endpoints in source, ${d.counts.plotted} with complete intelligence, cost and latency.
    Values are live and change; this page shows a snapshot.`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

boot();
