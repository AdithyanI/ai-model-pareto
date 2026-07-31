import test from "node:test";
import assert from "node:assert/strict";
import {
  dominates,
  paretoFront,
  frontierBreakdown,
  preferenceMap,
  attainmentPath,
  isComparable,
  OBJECTIVES,
} from "../web/lib/pareto.mjs";

const { intelligence, cost, time } = OBJECTIVES;
const THREE = [intelligence, cost, time];
const row = (id, i, c, t) => ({ id, intelligence: i, cost: c, time: t });

test("directionality: higher intelligence, lower cost and time win", () => {
  const good = row("good", 50, 1, 10);
  const bad = row("bad", 40, 2, 20);
  assert.equal(dominates(good, bad, THREE), true);
  assert.equal(dominates(bad, good, THREE), false);
});

test("a point never dominates itself", () => {
  const a = row("a", 50, 1, 10);
  assert.equal(dominates(a, a, THREE), false);
});

test("equal on all objectives is not domination, so ties both survive", () => {
  const a = row("a", 50, 1, 10);
  const b = row("b", 50, 1, 10);
  assert.equal(dominates(a, b, THREE), false);
  assert.equal(paretoFront([a, b], THREE).length, 2);
});

test("better on one objective and worse on another is not domination", () => {
  const cheap = row("cheap", 40, 1, 10);
  const smart = row("smart", 60, 5, 10);
  assert.equal(dominates(cheap, smart, THREE), false);
  assert.equal(dominates(smart, cheap, THREE), false);
  assert.equal(paretoFront([cheap, smart], THREE).length, 2);
});

test("equal on two objectives and strictly better on one is domination", () => {
  const a = row("a", 50, 1, 10);
  const faster = row("faster", 50, 1, 5);
  assert.equal(dominates(faster, a, THREE), true);
  assert.deepEqual(
    paretoFront([a, faster], THREE).map((r) => r.id),
    ["faster"],
  );
});

test("rows missing an objective are excluded rather than coerced", () => {
  const ok = row("ok", 50, 1, 10);
  const missing = { id: "missing", intelligence: 99, cost: 0.1 };
  const nan = row("nan", 60, Number.NaN, 1);
  assert.equal(isComparable(missing, THREE), false);
  assert.equal(isComparable(nan, THREE), false);
  assert.deepEqual(
    paretoFront([ok, missing, nan], THREE).map((r) => r.id),
    ["ok"],
  );
});

test("dominance in fewer dimensions can disappear in more dimensions", () => {
  // `slow` beats `mid` on intelligence and cost, but is far slower.
  const slow = row("slow", 60, 1, 100);
  const mid = row("mid", 50, 2, 5);
  assert.equal(dominates(slow, mid, [intelligence, cost]), true);
  assert.equal(dominates(slow, mid, THREE), false);
});

test("frontierBreakdown finds points optimal in 3D but hidden in both 2D charts", () => {
  const rows = [
    row("smart", 60, 10, 50), // wins on intelligence
    row("cheap", 20, 0.1, 50), // wins on cost
    row("fast", 20, 10, 1), // wins on time
    // Middling on every pair, but the only balanced option: dominated in
    // intelligence-vs-cost and intelligence-vs-time, alive in 3D.
    row("balanced", 40, 1, 10),
    row("dud", 10, 20, 80), // dominated everywhere
  ];
  const stats = frontierBreakdown(rows);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  assert.equal(byId.balanced.front3d, true);
  assert.equal(byId.balanced.hiddenOptimal, false, "balanced is on a 2D front here");
  assert.equal(byId.dud.front3d, false);
  assert.equal(stats.total, rows.length);
  assert.ok(stats.front3d >= stats.frontIntCost);
  assert.ok(stats.front3d >= stats.frontIntTime);
});

test("the 3D front is always a superset of each 2D front", () => {
  const rows = Array.from({ length: 60 }, (_, n) =>
    row(`r${n}`, (n * 37) % 60, ((n * 17) % 40) / 4 + 0.1, ((n * 29) % 50) + 1),
  );
  const three = new Set(paretoFront(rows, THREE).map((r) => r.id));
  for (const pair of [
    [intelligence, cost],
    [intelligence, time],
    [cost, time],
  ]) {
    for (const r of paretoFront(rows, pair)) {
      assert.ok(three.has(r.id), `${r.id} on a 2D front must survive in 3D`);
    }
  }
});

test("tolerance keeps near-ties alive instead of eliminating on noise", () => {
  const a = row("a", 50, 1, 10);
  const noise = row("noise", 50.01, 1, 10); // 0.02% better on intelligence
  assert.equal(dominates(noise, a, THREE, 0), true);
  assert.equal(dominates(noise, a, THREE, 0.01), false);
  assert.equal(paretoFront([a, noise], THREE, 0.01).length, 2);
});

test("preferenceMap returns shares summing to one and only frontier ids", () => {
  const rows = [row("smart", 60, 10, 50), row("cheap", 20, 0.1, 50), row("fast", 20, 10, 1)];
  const front = paretoFront(rows, THREE);
  const map = preferenceMap(front, 20);
  const ids = new Set(front.map((r) => r.id));
  assert.ok(map.length > 0);
  for (const entry of map) assert.ok(ids.has(entry.id));
  const total = map.reduce((sum, e) => sum + e.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares summed to ${total}`);
  assert.deepEqual([...map].sort((x, y) => y.share - x.share), map, "sorted by share");
});

test("preferenceMap handles a single frontier point", () => {
  const only = [row("only", 50, 1, 10)];
  const map = preferenceMap(only, 10);
  assert.deepEqual(map, [{ id: "only", share: 1 }]);
});

test("preferenceMap on an empty front returns empty", () => {
  assert.deepEqual(preferenceMap([], 10), []);
});

// --- the frontier drawn as a boundary -------------------------------------

test("attainmentPath steps rather than interpolating between models", () => {
  // Cost on h (good at -1), intelligence on v (good at +1).
  const pts = [
    { h: -1, v: -0.5 },
    { h: 0, v: 0.2 },
    { h: 1, v: 1 },
  ];
  const { line } = attainmentPath(pts, -1, 1);

  // Every segment is axis-aligned: a diagonal would assert a model that the
  // dataset does not contain.
  for (let i = 1; i < line.length; i++) {
    const dh = Math.abs(line[i].h - line[i - 1].h);
    const dv = Math.abs(line[i].v - line[i - 1].v);
    assert.ok(dh < 1e-9 || dv < 1e-9, `segment ${i} is diagonal`);
  }

  // Every input point lies on the boundary.
  for (const p of pts) {
    assert.ok(
      line.some((q) => Math.abs(q.h - p.h) < 1e-9 && Math.abs(q.v - p.v) < 1e-9),
      `frontier point (${p.h}, ${p.v}) is not on the drawn boundary`,
    );
  }
});

test("attainmentPath is monotone toward the good end of the vertical axis", () => {
  const pts = [
    { h: -0.8, v: -1 },
    { h: 0.1, v: 0 },
    { h: 0.9, v: 0.7 },
  ];
  const { line } = attainmentPath(pts, -1, 1);
  for (let i = 1; i < line.length; i++) {
    assert.ok(line[i].v >= line[i - 1].v - 1e-9, "v must never fall as h worsens");
    assert.ok(line[i].h >= line[i - 1].h - 1e-9, "h must advance toward the bad end");
  }
  assert.equal(line[line.length - 1].h, 1, "boundary runs out to the far edge");
});

test("attainmentPath respects an axis whose good end is the low one", () => {
  // Cost on h and time on v: both are better when smaller, so the staircase
  // descends as cost rises and the dominated region is up and to the right.
  const pts = [
    { h: -1, v: 0.9 },
    { h: 0, v: 0.1 },
    { h: 0.8, v: -0.6 },
  ];
  const { line, region } = attainmentPath(pts, -1, -1);
  for (let i = 1; i < line.length; i++) {
    assert.ok(line[i].v <= line[i - 1].v + 1e-9, "v must improve downward");
  }
  assert.deepEqual(region[region.length - 1], { h: 1, v: 1 }, "region closes at the worst corner");
});

test("attainmentPath keeps only the best point where two share a position", () => {
  const pts = [
    { h: -0.5, v: 0.1 },
    { h: -0.5, v: 0.6 },
    { h: 0.5, v: 0.9 },
  ];
  const { line } = attainmentPath(pts, -1, 1);
  assert.ok(
    !line.some((q) => Math.abs(q.h + 0.5) < 1e-9 && Math.abs(q.v - 0.1) < 1e-9),
    "the worse of two points at the same h must not appear on the boundary",
  );
});

test("attainmentPath tolerates degenerate input", () => {
  assert.deepEqual(attainmentPath([], -1, 1), { line: [], region: [] });
  const single = attainmentPath([{ h: 0, v: 0 }], -1, 1);
  assert.equal(single.line.length, 3, "one point still yields a drawable boundary");
});

test("the drawn boundary uses exactly the computed 2D front", () => {
  // Guards the join between dominance and drawing: anything the front excludes
  // must not end up as a corner of the staircase.
  const rows = [
    row("a", 60, 4, 9),
    row("b", 50, 1, 9),
    row("c", 30, 0.2, 9),
    row("dominated", 40, 3, 9),
  ];
  const front = paretoFront(rows, [intelligence, cost]);
  assert.equal(front.length, 3);
  const pts = front.map((r) => ({ h: Math.log10(r.cost) / 2, v: r.intelligence / 60 }));
  const { line } = attainmentPath(pts, -1, 1);
  const beaten = { h: Math.log10(3) / 2, v: 40 / 60 };
  assert.ok(
    !line.some((q) => Math.abs(q.h - beaten.h) < 1e-9 && Math.abs(q.v - beaten.v) < 1e-9),
    "a dominated model must not appear as a corner of the frontier",
  );
});
