# AI model Pareto frontier — agent guide

A small public site showing that intelligence, cost and speed are one
three-dimensional trade-off rather than two flat charts, and that a set of
genuinely optimal model configurations is invisible in both published charts.

Origin: a July 2026 X thread from swyx relaying Jesse Zhang's question about
whether the three dimensions can be understood together.

## Start here

1. `docs/references/method.md` — the analytical contract: source, identity
   policy, latency definitions, dominance rules. Read before changing anything
   that affects a number on the page.
2. `web/lib/pareto.mjs` — the dominance core. Shared by the Node build and the
   browser, so `test/pareto.test.mjs` covers both.
3. `src/build-snapshot.mjs` — turns the live source into `web/data/snapshot.json`.

## Commands

```bash
npm test          # dominance unit tests
npm run snapshot  # refetch live data -> web/data/snapshot.json
npm run dev       # serve web/ on :4178
npm run build     # copy web/ -> dist/ for Cloudflare Pages
bash scripts/check-fast.sh
```

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

Uses Adi's shared design language: off-white (never warm cream), sage accent,
Newsreader for reading and Inter for UI, flat hairline surfaces. `web/tokens.css`
is a vendored copy of the canon in `~/GitHub/adi-design`; product-specific
values (the amber highlight reserved for the 3D-only winners) live at the top of
`web/styles.css`. Refresh `tokens.css` from the canon rather than editing it.

## Deployment

GitHub `main` -> Cloudflare Pages -> `pareto.adithyan.io`.
Build command `npm run build`, output `dist/`.
The data snapshot is committed, so a deploy never depends on the source being
reachable at build time.
