# Three-Dimensional AI Model Pareto Frontier

## Goal
Show accurately and intuitively that intelligence, cost and latency are one
three-dimensional trade-off, then use that to prepare a useful reply to swyx's
31 July 2026 X post.

## Why / Impact
Artificial Analysis publishes two pairwise charts. Jesse Zhang's underlying
question, relayed by swyx, is whether the three dimensions can be understood
together. The answer turned out to be concrete and checkable rather than
rhetorical: **the two published charts are two camera angles on one 3D object,
and a set of genuinely optimal configurations is invisible in both.** That
finding is the reason this project exists and the thing the reply must carry.

## Where this lives
- Repository: this repo, `github.com/AdithyanI/ai-model-pareto`.
- Live site: <https://pareto.adithyan.io>.
- Analytical contract: `docs/references/method.md`.
- Agent router and non-negotiables: `AGENTS.md`.
- Moved here from `~/GitHub/adi/projects/ai-model-pareto-frontier-2026/` on
  2026-07-31 once the work outgrew the memory workspace. The memory workspace
  keeps only a pointer; this tracker is the single source of truth.

## Scope / Non-Goals
### In Scope
- Reproducibly capture the relevant current data from Artificial Analysis.
- Justify the latency definition and the model/configuration identity policy.
- Compute the 3D Pareto set: maximise intelligence, minimise cost and latency.
- Make the result readable on desktop, mobile, and as a static X image.
- Prepare a concise visual and reply draft for the source X conversation.

### Out of Scope
- Replying or publishing before Adi explicitly approves wording and visual.
- Redistributing Artificial Analysis's raw dataset.
- Treating the space between discrete models as if models existed there.
- Reproducing AA's time-per-task chart, whose input is not in the payload.

## Context / Constraints
- Date started: 2026-07-31.
- Source conversation: [swyx on X](https://x.com/swyx/status/2083050607154532439?s=20).
- Canonical data source: [Artificial Analysis](https://artificialanalysis.ai/models),
  read from the page's own structured client payload rather than OCR of chart
  pixels. Retrieval and decryption are implemented in `src/source.mjs` and
  documented in `docs/references/method.md`.
- Values are live and change. Every published artifact needs a captured-at
  timestamp, a source link, and retained provenance.
- Publish derived analysis with attribution, never a raw mirror.
- Do not post, reply or act as Adi externally without explicit confirmation
  each time.

## Findings
Snapshot captured 2026-07-31. 590 model records and 868 endpoints in source;
415 model-host configurations have complete intelligence, cost and latency;
133 distinct models after choosing one representative host each.

| Scope | Configs | 3D optimal | Optimal in int-vs-cost | Optimal in int-vs-time | Hidden |
| --- | --- | --- | --- | --- | --- |
| Best host per model (default view) | 133 | 34 | 17 | 11 | **11** |
| All model-host configurations | 415 | 43 | 22 | 13 | **18** |

"Hidden" means 3D-optimal while dominated in *both* published charts — a real
choice that neither AA chart can show. Examples: GPT-5.6 Sol (medium),
GPT-5.6 Terra (high), MiniMax-M3 on CoreWeave.

The finding is not an artifact of one latency choice. Across all three latency
definitions and both scopes the hidden set stays non-empty (6–19 configs), so
the claim survives the metric argument a reader is most likely to raise.

Correction to the original plan: the source payload has **no**
`intelligenceIndexTimePerTask` field, so AA's time-per-task chart cannot be
reproduced from it. The tracker previously assumed otherwise. The site uses
measured latency instead and does not approximate the missing metric.

## Done When
- [x] A timestamped, reproducible source-data snapshot contains the exact
      fields used in the visual.
- [x] The latency metric and configuration selection policy are explicitly
      justified — `docs/references/method.md`.
- [x] The 3D Pareto set is computed and independently sanity-checked.
- [x] A treatment is understandable without explanatory gymnastics — the
      default view opens on the familiar published chart, and the third view
      splits it by response-time deadline rather than asking for rotation.
- [x] A lightweight interactive prototype demonstrates the linked views.
- [ ] Adi has approved an execution-ready reply and visual; posting to X stays
      a separate explicit-confirmation action.

## Milestones
- [x] Milestone 1 — Freeze the analytical contract. Provenance, inclusion
      rules, metric definitions and dominance rules written in
      `docs/references/method.md`. Validated by reproducing live chart points
      exactly (Claude Opus 5 Adaptive Reasoning Max Effort on Amazon Bedrock:
      II 60.7, $2.34, 47.6 s).
- [x] Milestone 2 — Produce and verify the Pareto dataset. Every plotted row
      carries intelligence, cost, latency, identity, provider, timestamp and
      dominance status. Validated by `npm test` (13 tests), including the
      invariant that the 3D front is a superset of every 2D front.
- [x] Milestone 3 — Compare visual directions. Resolved twice. First as one
      orthographic scene at different camera angles, so the 2D charts are
      literally the 3D object seen down an axis. Then, after the rotatable view
      proved unreadable in use, replaced with a split by response-time deadline
      that reproduces the three-way frontier exactly. Verified in-browser at
      desktop and 390px, light and dark, across all nine filter combinations.
- [ ] Milestone 4 — Prepare the reply package. Acceptance: final static image,
      accessible alt text, concise reply copy, methodology note, and a fresh
      data recheck, all ready for Adi's approval.

## Execution Rules
- Read `AGENTS.md` non-negotiables before changing anything that moves a number.
- Keep work scoped to the current milestone unless this tracker expands scope.
- Run `bash scripts/check-fast.sh` after changes; `scripts/check-full.sh` before
  publishing anything externally.
- Update this tracker whenever the plan or a material decision changes.
- Use `Current Batch` as the resume point.
- Do not post as Adi without explicit confirmation.
- When `Done When` is satisfied, archive this directory to
  `docs/projects/archive/`.

## Decisions
- Artificial Analysis's structured payload, not screenshot OCR, is canonical.
- **The rotatable 3D view is gone; the split view replaces it.** The cube was
  honest and nearly unusable — under orthographic projection nobody can tell
  which of two dots is nearer, which is exactly the judgement the third axis
  demands, and Adi said so directly ("it's not at all intuitive to me"). Five
  directions were mocked up from real data (colour-mapped scatter, a quiet
  two-ramp variant, small multiples, a coloured-axis 3D, and a worked example)
  and small multiples won.
- **The split view is exact, not a simplification.** The union over all
  response-time budgets of the within-budget smart-vs-cheap frontiers is
  *identically* the three-way frontier — 34 = 34 on the current snapshot, with
  nothing in one and not the other. Proof sketch and both directions are in
  `web/lib/budgets.mjs`; two tests assert it. This is what makes the panels
  legitimate rather than a per-bin frontier that would fail to reconcile with
  the headline count.
- **Deadlines are derived from the field, not hard-coded.** Cuts sit at roughly
  the 20th and 50th percentile of response time, rounded to a sayable number,
  and a cut that would leave a panel under eight models is dropped. A fixed 8s
  is a good cut for end-to-end response and a nonsense one for
  time-to-first-token, and the latency measure is reader-selectable.
- **Panels are headed with the reader's question, not a bucket.** "Under 8s" is
  a decision someone makes; "8–15s" is a bin invented by whoever drew the
  chart. The panels are nested rather than disjoint, because that is what being
  fast enough actually means.
- **Every view is the same scene at a different camera angle**, rendered
  orthographically. This is load-bearing: with no perspective foreshortening,
  the flat views are exact 2D scatters, which makes "the published charts are
  camera angles" literal rather than a metaphor. It now shows up as the
  rotation *between* the two published charts rather than as a destination view.
  Do not switch to perspective.
- Default latency is `endToEnd` (request sent to last token received, long
  prompt). It has full coverage and answers "when do I have the whole answer?".
  `firstAnswerToken` and `longContext` are selectable.
- Default scope shows one representative host per model, because host sprawl
  buries the story. All 415 configurations remain available as a toggle.
- Dominance is recomputed client-side against what is currently on screen. A
  point is never greyed out by a rival the reader has filtered away.
- No connecting surface across the frontier; the gaps contain no models.
- **Each view marks only its own winners.** Marking the three-way optimal set on
  a flat chart was built, shown to Adi, and removed: it places emphasis inside
  the region that same chart shades as beaten, which reads as a contradiction.
  The reveal now happens only in the split view, where it is true.
- **The frontier is drawn as a staircase**, never a curve. A diagonal join
  would assert intermediate models that do not exist; the staircase asserts
  only that a bigger budget never buys less.
- **The chart palette is product-local, not the shared design language.** Adi
  released the design constraint for the plot specifically. Plot colour has to
  separate three roles across a hundred overlapping marks, which needs more
  chroma and a wider lightness gap than calm UI accents give. Page chrome still
  follows the shared tokens.
- **Hidden-optimal is tested against the two published charts only.** Leading
  cost-vs-time does not rescue a model, because that chart is not published and
  so cannot make anything visible to a reader.
- Deliverable is both a static image for the reply and this live companion site.
- Hosting is self-hosted on the Mac mini behind the shared Cloudflare tunnel,
  matching the blog. Cloudflare Pages was considered and rejected.

## Open Questions / Blockers
- Which single frame best carries the finding as a static X image: the familiar
  int-vs-cost chart with the hidden winners ringed, or the three-panel split
  that shows tightening the deadline changing who wins? The split is now the
  stronger candidate — it carries the argument without needing interaction —
  but it has to survive being shrunk to feed size.
- ~~Does the highlight survive colour-vision deficiency?~~ Resolved for the
  live site: the two roles sit ~13 lightness points and ~130 degrees of hue
  apart in light mode and ~15 apart in dark, and shape (diamond versus dot)
  repeats the distinction, so no claim depends on colour alone. Still to be
  re-checked on the static export.
- Should `preferenceMap` (43 frontier points collapse to ~15 reachable winners
  under a weight-simplex sweep) be surfaced in the UI, or is it a second post?

## Current Batch
| Status | Work Item | Role | Resource |
| --- | --- | --- | --- |
| todo | Build the static X-image export path from the live scene | agent | `web/lib/scene.mjs`, `web/lib/panels.mjs` |
| todo | Draft reply copy and alt text with attribution, for Adi's review | agent | This tracker |
| todo | Recheck live data immediately before export | agent | `npm run snapshot` |
| blocked | Post the reply | Adi | Needs explicit confirmation |

## Backlog / Remaining Work
- [ ] Static export at X feed dimensions, legible on mobile.
- [ ] Alt text describing the finding, not just the chart type.
- [x] Colour-accessibility check of the highlight against the frontier colour.
- [x] Mobile visual pass on the live site (390x844, all three views).
- [ ] Decide whether to surface `preferenceMap`.
- [ ] Recheck source values immediately before final export.
- [ ] Adi's explicit approval before posting.
- [ ] Archive this project directory once the package ships.

## Validation / Test Plan
- `npm test` — dominance edge cases: ties, missing values, directionality, and
  the 3D-superset-of-2D invariant.
- `bash scripts/check-fast.sh` — syntax, tests, snapshot integrity, and the
  guard that no raw source data is committed.
- `npm run verify` — the audit of record. Re-derives every published number
  from the raw payload by brute force without importing the dominance core, so
  a bug in `pareto.mjs` cannot validate itself. Runs inside `check-fast.sh`.
- `bash scripts/check-full.sh` — adds a live source probe and a build.
- Reconcile sampled values against live AA tooltips after each data refresh.
- Review the static export at feed size on mobile and desktop before approval.
- Verify labels, units, timestamp, attribution and alt text before approval.

## Progress Log
- 2026-07-31: [DONE] Confirmed accurate extraction from the official page is
  feasible; recorded available fields and a live spot check.
- 2026-07-31: [DONE] Cracked the payload delivery: AES-256-GCM with the IV
  derived from the SHA-256 of the raw key bytes, then gzip, then JSON. Values
  reproduce the live chart exactly.
- 2026-07-31: [DONE] Found the payload carries 868 endpoints with per-host
  price and latency, richer than the original 590-record assumption, and that
  `intelligenceIndexTimePerTask` does not exist.
- 2026-07-31: [DONE] Computed the 3D frontier and identified the hidden-optimal
  set. This became the project's headline finding.
- 2026-07-31: [DONE] Settled the visual concept: one orthographic scene, four
  camera angles, opening on the familiar published chart.
- 2026-07-31: [DONE] Built the site in this repo — data pipeline, shared
  dominance core with tests, canvas scene engine, design-token styling.
- 2026-07-31: [DONE] Fixed four defects found in browser verification: a
  wasted-canvas scale bug, frontier computed against filtered-away rivals, an
  uninitialised detail panel, and 3D depth ambiguity (added drop lines).
- 2026-07-31: [DONE] Deployed to <https://pareto.adithyan.io> on the Mac mini
  behind the shared tunnel; registered in the shared service inventory.
- 2026-07-31: [DONE] Moved this tracker out of the memory workspace into the
  repo that owns the work. Milestones 1–3 closed; Milestone 4 is the remaining
  work.
- 2026-07-31: [DONE] Redesigned the page around the chart. Chart is now the
  hero, controls cut to three, and the argument runs as three beats: the cost
  chart's 17 winners, the speed chart's visibly different 11, then all three
  axes where 34 survive and 11 of those appeared on neither. Axes rebuilt to
  mathematical convention — spine and arrowhead at the increasing end, ticks
  outside the frame, horizontal y-title, and every axis carrying name, unit and
  a direction cue. The cost-vs-time view was dropped from the UI at Adi's
  request; its front is still computed because dominance needs it.
- 2026-07-31: [DONE] Independently audited every published number. Wrote
  `scripts/verify-snapshot.mjs`, which re-reads the raw payload, rebuilds the
  rows, recomputes all four Pareto fronts by brute force without importing the
  dominance core, and traces all 415 rows field-by-field back to their origin.
  35 checks, 0 failures. Wired into `check-fast.sh`.
- 2026-07-31: [NOTE] The audit surfaced a coverage limitation worth stating:
  441 of 868 endpoints carry no `intelligenceIndexCostPerTask` at all, so 205
  models never appear. They cannot be recovered without inventing the token
  counts the field encodes. AA's own cost chart has the identical restriction,
  which is what keeps the comparison fair. Documented in `method.md`.
- 2026-07-31: [FIXED] Dark mode had the frontier and reveal colours only 2
  lightness points apart, silently breaking the colour-blindness guarantee that
  holds in light mode. Now ~15 apart.
- 2026-07-31: [DONE] Mocked five visual directions from the real snapshot after
  Adi said the 3D view was "not at all intuitive": a colour-mapped scatter, a
  quieter two-ramp variant, small multiples by deadline, a coloured-axis 3D,
  and a single worked example. Small multiples won — position is the one visual
  channel a reader judges accurately, and it is the only option that keeps all
  three dimensions without asking anyone to decode a legend.
- 2026-07-31: [FOUND] The split is exact, not a compromise. The union over all
  response-time budgets of the within-budget smart-vs-cheap frontiers equals
  the three-way frontier identically — 34 = 34 on the live snapshot, nothing in
  one and not the other, provable in both directions. This is stronger than the
  8-of-11 figure quoted to Adi from round-number budgets alone, and it is what
  makes the panel counts reconcile with the headline. Locked in two tests.
- 2026-07-31: [DONE] Replaced the rotatable 3D view with a three-panel split
  (`web/lib/budgets.mjs`, `web/lib/panels.mjs`) and added a standing worked
  example under the chart naming a real model, what the cost chart sends you to
  instead, and what the speed chart does. Deadlines are derived from field
  quantiles rather than hard-coded, so they follow the latency control. Drag
  interaction removed with the cube. 21 tests pass.
- 2026-07-31: [FIXED] Four defects from browser verification: a clipped x-axis
  name block in the panels, reveal labels struck through by the frontier
  staircase, awkward singular grammar in the worked example, and a pre-existing
  bug where the canvas never repainted on an OS colour-scheme change, leaving
  the light palette painted on the dark page.
- 2026-07-31: [FIXED] A deploy could go live and stay invisible. Assets were
  served with `max-age=3600` and no content hashing, so a deploy shipped fresh
  HTML pointing at asset URLs Cloudflare was still caching — caught only
  because the worked example rendered completely unstyled on the public site
  while being correct locally. `src/build-site.mjs` now stamps every asset
  reference with a hash of the build and refuses to emit an unstamped one, and
  `src/static-server.mjs` grants a long `max-age` only to stamped URLs. The
  guard uses deliberately broader detection than the stamper, so it catches a
  reference shape the stamper would miss rather than agreeing with itself.
- 2026-07-31: [DONE] Docs brought back in line with the build: `method.md` lost
  the camera-angles-as-destination section and gained the deadline
  decomposition with both directions of the argument, and `AGENTS.md` records
  the cache-stamping requirement.
