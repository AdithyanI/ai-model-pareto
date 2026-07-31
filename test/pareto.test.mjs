import test from "node:test";
import assert from "node:assert/strict";
import {
  dominates,
  paretoFront,
  frontierBreakdown,
  preferenceMap,
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
