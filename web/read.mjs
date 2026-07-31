/**
 * The reading page. Same data, same dominance, no canvas — every number here
 * is derived at load time rather than typed into the prose, so it cannot drift
 * away from the chart.
 */
import { AXES, formatRatio } from "./lib/axes.mjs";
import { loadSnapshot, filterRows, analyse, pickWorkedExample } from "./lib/analysis.mjs";
import { escapeHtml } from "./lib/html.mjs";

const $ = (sel) => document.querySelector(sel);

// The chart's own defaults, so the reading page describes what a reader saw.
const LATENCY = "endToEnd";
const SCOPE = "representative";

async function boot() {
  const data = await loadSnapshot();
  const model = analyse(filterRows(data, { latency: LATENCY, scope: SCOPE }));

  renderFigures(model.counts);
  $("#front-note").textContent =
    `Of the ${model.counts.plotted} configurations shown, ${model.counts.frontIntCost} lead the ` +
    `smart-vs-cheap chart and ${model.counts.frontIntTime} lead smart-vs-fast. Judge all three ` +
    `axes at once and ${model.counts.front3d} survive, of which ${model.counts.hidden} appear on ` +
    `neither published chart.`;
  renderWorkedExample(model);
  renderMeta(data);
}

function renderFigures(c) {
  $("#figures").innerHTML = `
    <div class="figure"><b>${c.plotted}</b><span>models charted</span></div>
    <div class="figure figure-front"><b>${c.front3d}</b><span>nothing beats them</span></div>
    <div class="figure figure-hidden"><b>${c.hidden}</b><span>on neither published chart</span></div>`;
}

function renderWorkedExample(model) {
  const el = $("#worked");
  const ex = pickWorkedExample(model);
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

function renderMeta(d) {
  const when = new Date(d.capturedAt);
  $("#meta").innerHTML = `Data captured ${when.toISOString().slice(0, 16).replace("T", " ")} UTC from
    <a href="${d.source.url}" rel="noopener">${escapeHtml(d.source.name)}</a>.
    ${d.counts.endpointsInSource} endpoints in source, ${d.counts.plotted} with complete
    intelligence, cost and latency. Values are live and change; this page shows a snapshot.`;
}

boot();
