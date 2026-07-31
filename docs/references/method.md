# Method

The analytical contract behind every number on the page. Change this document
in the same commit as any change to how a value is derived.

## Source

Artificial Analysis, <https://artificialanalysis.ai/models>.

The page embeds a manifest `{path, key}` in its Next.js flight payload and
loads the dataset as an encrypted blob. The client derives a 12-byte AES-GCM IV
from `SHA-256(raw key bytes)` — the key bytes, not the hex string — decrypts,
gunzips, and parses JSON. `src/source.mjs` reproduces exactly that, so the
numbers are the ones the site itself plots rather than values read off chart
pixels.

Two payloads arrive: a `models` object (benchmark scores, one record per model
*configuration*) and an `endpoints` array (one record per model-on-host, with
that host's pricing and measured latency).

If the delivery shape changes, `extractManifests` throws rather than silently
producing an empty or stale snapshot.

We publish derived analysis and attribution. We do not mirror the raw dataset;
`data/raw/` is gitignored.

## What counts as a point

A point is **one model configuration on one host**.

- Reasoning-effort variants are separate points. They are separate records with
  distinct slugs in the source (`gpt-5-6-sol-low`, `gpt-5-6-sol-medium`, …) and
  they are genuinely different purchasing decisions.
- Host matters because price and latency are properties of the host, not the
  model. The same weights on two providers are two different offers.
- Where a model/host pair appears more than once, the cheapest is kept, with
  the faster one breaking a tie.
- The default view shows one representative host per model — the one minimising
  cost × time — because plotting all 415 at once buries the story. The reader
  can switch to every host, or to open-weights only.

A configuration is plotted only when it has all of intelligence, cost and at
least the default latency measure. Incomplete rows are dropped, never
zero-filled.

### Coverage, and what that excludes

On the 2026-07-31 capture the source holds 868 endpoints and 415 are plotted.
The gap is almost entirely one cause: **441 endpoints carry no
`intelligenceIndexCostPerTask`**. The field is absent, not null. Those
endpoints do publish per-token prices, but converting a per-token price into a
cost per Intelligence Index task needs the token counts that task consumed on
that endpoint, and the source does not publish them. Deriving it would mean
inventing the number, so the row is dropped instead.

The effect is not evenly spread: 205 models disappear altogether because no
endpoint of theirs is priced this way. That is a real limitation and worth
stating plainly. Two things bound it:

- The excluded models top out at 45.4 on the index against a field maximum of
  60.7, so none of them are candidates for the top of the intelligence axis.
  A cheap fast one could still have earned a place on the frontier, and we
  cannot rule that out.
- Artificial Analysis's own cost chart is subject to the identical
  restriction, because it needs the same field. So the set compared here is
  the set its published chart draws from, which is what makes the comparison
  fair. The claim is about what those charts can show, not about every model
  that exists.

A further 7 endpoints report a cost of zero or less and 4 have no intelligence
score; both are dropped. Deduplication by model+host removes the remaining
difference.

## Metrics

| Axis | Field | Direction |
| --- | --- | --- |
| Intelligence | `models[].intelligenceIndex` | higher is better |
| Cost | `endpoints[].intelligenceIndexCostPerTask.cost.total`, US dollars per Intelligence Index task | lower is better |
| Time | see below, seconds | lower is better |

Cost and time use logarithmic scales. Both span orders of magnitude, and a
linear axis crushes everything cheap or fast into the margin.

### Latency

The original question distinguished time-to-first-token from time-to-complete,
so latency is not collapsed into one number. Three measures are offered:

- **End-to-end response** (default) — `endToEndResponseTime.total`. Request sent
  to last token received. This mirrors the source's long-prompt measurement
  exactly and is present for every usable endpoint.
- **Time to first answer token** — `timeToFirstAnswerToken.total`. Includes
  reasoning time, so it is the honest "first useful word" measure. This is
  deliberately not the first *stream chunk*, which a reasoning model can emit
  long before it says anything usable.
- **End-to-end at 100K context** — `performanceByPromptType.hundredK.medianEndToEndResponseTime`.
  Long-context latency reorders the field.

**Not offered:** AA's "time per Intelligence Index task". No such field exists
in the payload and it is not derivable from what is there, so the site does not
approximate it.

## Dominance

Configuration `b` dominates `a` when `b` is at least as good as `a` on every
axis and strictly better on at least one. The Pareto front is every
configuration that nothing dominates.

- Exact dominance is the default. `paretoFront` also accepts a tolerance, where
  a rival must beat a point by more than a given fraction to count as strictly
  better, which stops sub-noise benchmark differences from manufacturing
  frontier points. The tolerance is available but not currently applied to the
  published view.
- Ties survive. Two identical configurations do not eliminate each other.
- Rows missing an axis are excluded from the comparison rather than coerced,
  since a missing value is not a good value.
- The frontier is recomputed in the browser against exactly the configurations
  currently displayed, so a filtered-away rival never greys out a visible point.

### The finding

A configuration is **hidden-optimal** when it is on the three-dimensional front
but on neither the intelligence-vs-cost nor the intelligence-vs-time front.

Each flat chart tests dominance on two axes only, so it can discard a model for
being slow using a chart that never priced it, and discard the same model for
being expensive using a chart that never timed it. Judged on all three axes at
once, nothing actually beats it.

On the 2026-07-31 capture, across all 415 measured configurations: 22 lead
intelligence-vs-cost, 13 lead intelligence-vs-time, 43 survive in three
dimensions, and **18 are hidden-optimal**.

A structural check: the 3D front is necessarily a superset of every 2D front,
since dominance on three axes is strictly harder to achieve than on two. This
is asserted in `test/pareto.test.mjs`.

**Hidden-optimal is tested against the two published charts only.** Formally
`front3d && !frontIntCost && !frontIntTime`. Cost-vs-time is computed and is
available in the snapshot, but it deliberately takes no part in this test: it
is not a chart Artificial Analysis publishes, so leading it cannot make a model
visible to a reader of the published charts. Including it would shrink the
count by rescuing models nobody can see. This is easy to get wrong — an
independent audit of these numbers made exactly that mistake before being
corrected — so the definition is asserted in `scripts/verify-snapshot.mjs`.

## Drawing the frontier

The frontier is drawn as a **staircase**, never a curve or a diagonal join.
This is not a stylistic choice. A diagonal segment between two models asserts
that intermediate models exist, and they do not; the space between two points
on a Pareto front is empty by construction.

The staircase, by contrast, asserts only something already true: the best
intelligence obtainable at a given budget stays flat until the next model
becomes affordable, at which point it steps up. Every point along it is
genuinely reachable, because raising a budget never buys less. `attainmentPath`
in `web/lib/pareto.mjs` produces it, and a test asserts every segment it emits
is axis-aligned.

The region beyond the frontier is shaded rather than outlined. Everything
inside is beaten by something on the line, which is the one claim a reader
should be able to make without hovering over anything.

## Colour

The chart palette is defined at the top of `web/styles.css` and is deliberately
product-local rather than inherited from the shared design tokens, because it
has to carry meaning rather than identity.

Two roles need to be told apart: on the frontier, `oklch(0.42 0.11 165)`, and
the winners no published chart can show, `oklch(0.55 0.19 42)`. They sit about
13 lightness points and roughly 130° of hue apart, so the pair separates on
lightness alone and survives red-green colour blindness. Shape repeats the
distinction a second time — every marked model is a diamond, everything beaten
is a small dot — so no claim on the page depends on colour being perceived at
all. The dark theme keeps the same lightness gap rather than lifting both roles
toward white, which is the easy mistake.

Both renderers read these values from CSS custom properties at paint time, so
the page listens for `prefers-color-scheme` changes and repaints; without that
the canvas keeps the old palette while the rest of the page switches.

Each flat view marks only its own frontier. Marking the three-way winners on a
flat chart was tried and removed: it places emphasis inside the region that same
chart shades as beaten, which reads as a contradiction rather than a finding.
The reveal belongs in the split view, where it is true.

## The split view, and why it is exact

The two published charts are the same scene at two camera angles: the scene is
a unit cube with cost, intelligence and time on its axes, drawn with an
**orthographic** projection. Orthographic, not perspective, is what makes that
claim literal — at azimuth 0 and elevation 0 the render is exactly a 2D scatter
of cost against intelligence, with no foreshortening, and rotating 90° in
azimuth gives intelligence-vs-time. Moving between the two published charts is
therefore a rotation of the same points rather than a cut to a new picture.

A freely rotatable 3D view was built on this and then **removed**. It was
honest and nearly unusable: under orthographic projection a reader cannot tell
which of two dots is nearer, which is precisely the judgement the third axis
demands. Colour-ramp and 2.5D alternatives were mocked up from real data and
rejected for the same reason — quantity read from colour or depth is the least
accurately judged visual channel available.

What replaced it is a **split**: the smart-vs-cheap chart drawn three times,
each panel holding only the models that meet a stated response-time deadline,
with the frontier recomputed inside each. The last panel has no deadline, and
is therefore the published chart exactly.

This is not a simplification of the three-way result. It **is** the three-way
result:

```
union over all budgets T of  paretoFront({r : r.time <= T}, [intelligence, cost])
  ===  paretoFront(all, [intelligence, cost, time])
```

Both directions follow from one argument. A leader of the budget-T panel must
be three-way optimal, because anything beating it outright would be no slower,
hence already inside panel T and beating it there. Conversely a three-way
optimal model leads the panel at T equal to its own response time, by the same
argument run backwards. Nothing is interpolated and nothing is left over.

On the 2026-07-31 capture this was checked against the live snapshot: 34 in the
union, 34 on the three-way front, zero in one and not the other. Two tests in
`test/pareto.test.mjs` assert both directions, one on a hand-built field and one
on a pseudo-random field of 120 configurations.

### Choosing the deadlines

A deadline is a decision the reader brings, not a measurement, which is what
separates it from an invented bin. Panel headings are therefore phrased as the
question ("Under 8s"), not as a bucket ("8–15s"), and the panels are nested
rather than disjoint — a model fast enough for the tightest deadline appears in
all three, which is exactly what being fast means.

The cuts themselves are derived from the field on screen, at roughly the 20th
and 50th percentiles of response time, then rounded to a value a person would
say out loud. They are not fixed constants: the site offers three different
latency definitions, and a constant good for end-to-end response would land in
an empty part of the range for time-to-first-token. `budgetCuts` in
`web/lib/budgets.mjs` also refuses a cut that would leave a panel with fewer
than eight models, since a panel too sparse to read as a chart teaches nothing.

Because the decomposition holds for *every* budget, the choice of which two to
show is a presentation decision with no bearing on what is true. Showing more
panels would surface more of the hidden-optimal set; showing these two surfaces
five of the eleven, and the count of models revealed by the panels actually on
screen is stated in the legend rather than implied to be the whole finding.

## Reproducing

```bash
npm run snapshot   # refetch; prints frontier sizes per latency measure
npm test           # dominance edge cases and the superset invariant
npm run verify     # re-derive every published number from the raw payload
```

`npm run verify` is the audit of record. It reads `data/raw/source.json`
directly, rebuilds the rows, recomputes all four Pareto fronts by brute force
without importing the dominance core, and diffs against the committed
snapshot — so a bug in `pareto.mjs` cannot validate itself. It also traces
every stored field on all 415 rows back to its origin in the payload. It runs
inside `scripts/check-fast.sh`, and skips cleanly when the gitignored raw
payload is absent.

Last full audit on the 2026-07-31 capture: 35 checks, 0 failures.

Spot-checked against the live page on 2026-07-31: Claude Opus 5 (Adaptive
Reasoning, Max Effort) on Amazon Bedrock — Intelligence Index 60.7, $2.34 per
task, 47.6s end-to-end.
