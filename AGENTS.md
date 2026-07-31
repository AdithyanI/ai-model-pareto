# AI model Pareto frontier — agent guide

A small public site showing that intelligence, cost and speed are one
three-dimensional trade-off rather than two flat charts, and that a set of
genuinely optimal model configurations is invisible in both published charts.

Origin: a July 2026 X thread from swyx relaying Jesse Zhang's question about
whether the three dimensions can be understood together.

## Start here

1. `docs/projects/ai-model-pareto-frontier-2026/tasks.md` — the project tracker:
   why this exists, what is decided, what is left. **Resume point.**
2. `docs/references/method.md` — the analytical contract: source, identity
   policy, latency definitions, dominance rules. Read before changing anything
   that affects a number on the page.
3. `web/lib/pareto.mjs` — the dominance core. Shared by the Node build and the
   browser, so `test/pareto.test.mjs` covers both.
4. `web/lib/analysis.mjs` — filtering, fronts, counts and the worked example.
   Both pages import it, so they cannot quote different numbers.
5. `web/lib/budgets.mjs` — the split view's decomposition, and the proof sketch
   for why it reproduces the three-way frontier exactly.
6. `src/build-snapshot.mjs` — turns the live source into `web/data/snapshot.json`.

## Shape of the site

Two pages, and the split is deliberate.

| Page | Carries |
| --- | --- |
| `web/index.html` + `app.mjs` | The chart, at the size of the window. Nothing to read. |
| `web/read.html` + `read.mjs` | Every word of explanation, plus the worked example. |

The landing page is the chart: a compact top bar, the plot filling the
viewport, a legend and the attribution. A reader who wants prose follows one
link. Adding explanatory copy back to the landing page defeats the point —
put it in `read.html`.

## Commands

```bash
npm test          # dominance unit tests
npm run snapshot  # refetch live data -> web/data/snapshot.json
npm run dev       # serve web/ on :4178 (no build step, edits are live)
npm run build     # copy web/ -> dist/
bash scripts/check-fast.sh
./scripts/deploy-local.sh --apply [--refresh-data]
```

No dependencies. Plain Node and plain browser modules, so `npm install` is
never needed and there is no lockfile to keep current.

## Non-negotiables

- **Never invent a metric.** If a field is absent from the source payload, the
  page does not show it. The source has no `intelligenceIndexTimePerTask`, so
  AA's time-per-task chart is not reproduced rather than approximated.
- **No interpolation.** The space between points contains no models. Do not
  draw a connecting surface across the frontier; it would imply models that do
  not exist.
- **Dominance is computed against what is on screen.** When a filter changes,
  the frontier is recomputed. Never grey out a point using a rival the reader
  has filtered away.
- **Attribution and timestamp stay on the page.** Values are live; the site
  shows a dated snapshot and links to Artificial Analysis.
- **Derived analysis only.** Do not publish or commit a raw mirror of the
  source dataset. `data/raw/` is gitignored.
- **Do not post as Adi.** Preparing reply copy is in scope; publishing to X or
  anywhere else needs his explicit confirmation each time.

## Design

Uses Adi's shared design language for the page chrome: off-white (never warm
cream), Newsreader for reading and Inter for UI, flat hairline surfaces.
`web/tokens.css` is a vendored copy of the canon in `~/GitHub/adi-design`;
refresh it from there rather than editing it. The **chart** palette is
deliberately product-local and lives at the top of `web/styles.css` — a scatter
has to separate roles across a hundred overlapping marks, which needs more
chroma and a wider lightness gap than calm UI accents give. See the Colour
section of `docs/references/method.md` before changing it.

## Deployment

Self-hosted on the Mac mini behind the shared Cloudflare tunnel, the same way
the blog and the design showroom are served. There is no Cloudflare Pages
project and no external build.

```text
dist/ -> node scripts/serve-static.mjs -> 127.0.0.1:8799 -> shared tunnel -> pareto.adithyan.io
```

| Surface | Owner |
| --- | --- |
| Static build and local server | this repo, `src/build-site.mjs`, `scripts/serve-static.mjs` |
| LaunchAgent `com.<user>.ai-model-pareto` | this repo, `scripts/install-launchd-ai-model-pareto.sh` |
| Deploy and smoke | this repo, `scripts/deploy-local.sh` |
| Tunnel ingress, DNS, inventory | `~/GitHub/scripts`, see `docs/references/mac-mini-cloudflare-tunnel.md` |

Public site, so no Cloudflare Access policy. Logs land in
`~/.local/state/ai-model-pareto/log/`.

```bash
./scripts/install-launchd-ai-model-pareto.sh --status
./scripts/install-launchd-ai-model-pareto.sh --logs 60
```

The data snapshot is committed, so a restart never depends on Artificial
Analysis being reachable. Refresh it deliberately with
`./scripts/deploy-local.sh --apply --refresh-data`.

`src/build-site.mjs` stamps every asset reference with a `?v=` hash of the
build, and `src/static-server.mjs` gives a long `max-age` only to stamped URLs.
Without this a deploy ships fresh HTML pointing at asset URLs the edge is still
caching, so the site goes live and stays invisible for hours — it happened
once. The build refuses to emit an unstamped reference, so do not add an asset
link in a shape the stamper does not recognise without extending it.
