# Map rendering benchmark

A small headless-browser benchmark for the interactive biome map. Use it to
check whether an edit to the rendering pipeline (`src/library/draw.js`,
`src/library/queue.js`, `public/workers/*`) made things faster or slower -
before/after, apples to apples.

## What it measures

| Metric | Meaning | Good |
|---|---|---|
| `coldFirstPaintMs` | from navigation until the first biome pixels appear (worker + WASM cold start) | lower (≈ instant) |
| `coldLoadMs` | from navigation until the whole map settles | lower |
| `seedChange.avgMs` | wall-clock from pressing Enter on a new seed until the map stops changing | lower |
| `seedChange.avgGenerated` | tiles generated per seed change (≈ tiles on screen) | ~viewport tile count |
| `pan.p50ms` / `pan.p95ms` | frame interval percentiles during a continuous drag | ≤ ~16.7ms |
| `pan.longFrames` | frames > 20ms during the drag (visible hitches) | ~0 |
| `pan.blankFracMax` | peak fraction of the canvas showing background (`#333`) mid-drag | ~0 |
| `cacheReturn.generatedReturn` | tiles regenerated when panning away and back to an explored area | **0** |

`cacheReturn.generatedReturn > 0` means the tile LRU (`MAX_TILES` in
`draw.js`) is too small for the amount of panning - explored areas are being
evicted and regenerated.

**`coldFirstPaintMs` depends heavily on the environment.** The dev server
(`npm run dev`) is unminified and never caches the WASM, so it is roughly ~2×
slower than a production build. To measure what users actually get, benchmark a
production build:

```sh
npm run build
npm run preview                             # serves build/ on :4173 (directory index per section + wasm MIME)
SEEDER_BENCH_URL=http://localhost:4173 node bench.mjs prod
```

## How it works

- Drives a real browser (Brave/Chrome/Chromium) via `puppeteer-core`.
- Reads lightweight counters exposed on `window.__seederDrawer.getStats()`
  (defined in `src/library/draw.js`) for tile/render counts, and a black-box
  canvas checksum for timing - so the timings don't depend on the counters and
  stay valid even if you rip the instrumentation out.
- Blocks ad/analytics requests so the dev error overlay never appears and the
  main thread stays quiet.

## Running

```sh
# 1. Start the app (from seeder/)
npm run dev

# 2. One-time: install the driver (not an app dependency)
cd bench && npm install puppeteer-core

# 3. Benchmark, with a label
node bench.mjs baseline
```

Compare an edit:

```sh
node bench.mjs before > /tmp/before.json
# …make your change; wait for the dev server to recompile…
node bench.mjs after  > /tmp/after.json
diff <(jq . /tmp/before.json) <(jq . /tmp/after.json)
```

### Env overrides

- `SEEDER_BENCH_URL` - app URL (default `http://localhost:3000`)
- `SEEDER_BENCH_BROWSER` - path to a Chrome/Brave/Chromium binary (auto-detected
  on macOS/Linux otherwise)

## Notes

- The map is the `/seed/` page (`/seed/?version=26.3&seed=…`); `/` is the
  landing and never starts the worker pool. The seed box is located by its
  accessible name, `input[aria-label="Seed"]`, never by a CSS class - the same
  rule the e2e tests follow, so a restyle of the panel cannot break the bench.
- `window.__seederDrawer` is opt-in: `DrawSeed` only sets it when constructed with
  `{ exposeGlobal: true }`, which `MapCanvas` passes for the seed page's main map and
  for the finder's preview map (an opened result row). The finder's thumbnails are not
  `DrawSeed`s and never take the hook; the bench only visits `/seed/`.
- Numbers are machine- and load-dependent; only compare runs from the same
  machine in the same sitting.
- `coldLoadMs` includes one-time Web Worker + WASM initialization; use
  `seedChange.avgMs` (warm) to judge draw performance.
