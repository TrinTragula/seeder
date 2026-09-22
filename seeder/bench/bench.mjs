// Seeder map-rendering benchmark.
//
// Drives a headless Chromium/Brave against a running dev server and measures the
// three things that matter for the interactive map:
//   1. seed-change  — wall-clock until the map is fully drawn (canvas stops changing)
//   2. pan          — frame health + blank (#333) fraction while dragging
//   3. cacheReturn  — tiles regenerated when returning to an already-explored area
//
// It reads lightweight in-app counters exposed on `window.__seederDrawer.getStats()`
// (see src/library/draw.js) plus a black-box canvas checksum, so timings do not
// depend on internal instrumentation and stay comparable across edits.
//
// Usage:
//   1. Start the app:            npm start           (from seeder/)
//   2. Install the driver once:  cd bench && npm i puppeteer-core
//   3. Run:                      node bench.mjs [label]
//
// Env overrides:
//   SEEDER_BENCH_URL      default http://localhost:3000
//   SEEDER_BENCH_BROWSER  path to Chrome/Brave/Chromium (auto-detected otherwise)
//
// Compare edits by running with a label before and after a change:
//   node bench.mjs before   > /tmp/before.json
//   ...make an edit, let the dev server recompile...
//   node bench.mjs after    > /tmp/after.json

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.env.SEEDER_BENCH_URL || 'http://localhost:3000';
const LABEL = process.argv[2] || 'run';
const SEEDS = ['777111', '8091867987493326313', '246810', '13571113'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (process.env.SEEDER_BENCH_BROWSER) return process.env.SEEDER_BENCH_BROWSER;
  const candidates = [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error('No browser found. Set SEEDER_BENCH_BROWSER to a Chrome/Brave/Chromium binary.');
  return hit;
}

const withSeed = (seed) => `${URL_BASE}/?version=26.3&seed=${seed}`;

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
// Block ads/analytics: keeps the dev error overlay away and the main thread quiet.
await page.setRequestInterception(true);
page.on('request', (r) => {
  const u = r.url();
  (/googlesyndication|google-analytics|googletagmanager|doubleclick/.test(u)) ? r.abort() : r.continue();
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const stats = () => page.evaluate(() => window.__seederDrawer?.getStats?.() ?? null);
const checksum = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4 * 97) h = (h * 33 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) >>> 0;
  return h;
});

// Wait until the visible map stops changing (canvas checksum stable for `quiet`
// ms); return ms from `since` to the last change. This black-box signal tracks
// what the user actually sees, and matches perceived "time to draw the map".
async function timeToStable(since, quiet = 400, timeout = 12000) {
  const start = Date.now();
  let last = null, lastChange = Date.now();
  while (Date.now() - start < timeout) {
    const h = await checksum();
    if (h !== last) { last = h; lastChange = Date.now(); }
    else if (last != null && Date.now() - lastChange > quiet) break;
    await sleep(40);
  }
  return lastChange - since;
}

// --- cold load: time to FIRST biome pixels + full paint (worker+WASM init) --
// firstPaint is the perceptual "map appeared" moment and the number to optimize.
await page.evaluateOnNewDocument(() => {
  window.__nav = performance.now(); window.__firstPaint = null;
  const poll = () => {
    const c = document.querySelector('canvas');
    if (c && c.width) {
      try {
        const d = c.getContext('2d').getImageData(0, c.height >> 1, c.width, 8).data;
        let nonBg = 0;
        for (let i = 0; i < d.length; i += 20) if (d[i + 3] !== 0 && !(d[i] === 51 && d[i + 1] === 51 && d[i + 2] === 51)) nonBg++;
        if (nonBg > 20 && window.__firstPaint == null) window.__firstPaint = Math.round(performance.now() - window.__nav);
      } catch (e) {}
    }
    if (window.__firstPaint == null) setTimeout(poll, 15);
  };
  poll();
});
const coldStart = Date.now();
await page.goto(withSeed('12345'), { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForSelector('.panel-container input', { timeout: 20000 });
await page.waitForFunction(() => !!window.__seederDrawer, { timeout: 20000 }).catch(() => {});
await timeToStable(coldStart, 500);
const coldLoadMs = Date.now() - coldStart;
const coldFirstPaintMs = await page.evaluate(() => window.__firstPaint);

const box = await page.$eval('canvas', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;

// --- 1. seed-change draw time (warm) ----------------------------------------
const seedRuns = [];
for (const seed of SEEDS) {
  const before = await stats();
  const input = await page.$('.panel-container input');
  await input.click({ clickCount: 3 });
  await input.type(seed);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  const ms = await timeToStable(t0);
  const after = await stats();
  seedRuns.push({ ms, generated: after ? after.tilesGenerated - before.tilesGenerated : null });
  await sleep(500);
}
const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

// --- 2. pan: frame health + blank fraction during a continuous drag ---------
await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('2d');
  window.__frames = []; window.__blank = []; window.__rec = true; let n = 0;
  const rec = () => {
    if (!window.__rec) return;
    window.__frames.push(performance.now());
    // Cheap blank proxy: read a 2px-tall strip across the middle (not the whole
    // canvas) every 3rd frame, so the readback barely perturbs frame timing.
    if ((n++ % 3) === 0) {
      const d = ctx.getImageData(0, (c.height >> 1), c.width, 2).data;
      let blank = 0, tot = 0;
      for (let i = 0; i < d.length; i += 4 * 7) { tot++; if (d[i] === 51 && d[i + 1] === 51 && d[i + 2] === 51) blank++; }
      window.__blank.push(blank / tot);
    }
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
});
const panBefore = await stats();
await page.mouse.move(cx, cy);
await page.mouse.down();
const dist = box.w * 2.5;
for (let i = 1; i <= 120; i++) { const p = i / 120; await page.mouse.move(cx - dist * p, cy - dist * 0.4 * p); await sleep(9); }
await page.mouse.up();
await sleep(300);
const panAfter = await stats();
const pan = await page.evaluate(() => {
  window.__rec = false;
  const f = window.__frames, iv = [];
  for (let i = 1; i < f.length; i++) iv.push(f[i] - f[i - 1]);
  iv.sort((a, b) => a - b);
  const pct = (p) => iv.length ? +iv[Math.floor(iv.length * p)].toFixed(1) : 0;
  const b = window.__blank;
  return {
    frames: iv.length, p50ms: pct(0.5), p95ms: pct(0.95), maxms: iv.length ? +iv[iv.length - 1].toFixed(1) : 0,
    longFrames: iv.filter((x) => x > 20).length,
    blankFracAvg: b.length ? +(b.reduce((a, c) => a + c, 0) / b.length).toFixed(3) : 0,
    blankFracMax: b.length ? +Math.max(...b).toFixed(3) : 0,
  };
});
if (panBefore && panAfter) {
  pan.avgRenderMs = +((panAfter.renderMsTotal - panBefore.renderMsTotal) / Math.max(1, panAfter.renders - panBefore.renders)).toFixed(2);
  pan.tilesGenerated = panAfter.tilesGenerated - panBefore.tilesGenerated;
}

// --- 3. cache return: pan away, come back, count regenerated tiles ----------
// Clear the tile cache first, then pan DETERMINISTICALLY by writing panX (real
// drags would be confounded by inertia and never land exactly back on origin).
// A healthy cache (MAX_TILES >> tiles seen) regenerates ~0 on return.
await page.evaluate(() => { const d = window.__seederDrawer; if (d) { d.tiles?.clear?.(); d.clear(); d.setSeed('55555'); d.draw(); } });
await timeToStable(Date.now(), 200);
const hasPan = await page.evaluate(() => window.__seederDrawer && typeof window.__seederDrawer.panX === 'number');
let cacheReturn = 'unavailable (no window.__seederDrawer stats)';
if (hasPan) {
  // Wait until every requested tile has actually been generated (pending 0), so
  // late tiles aren't mis-attributed to the wrong phase.
  const waitPending0 = async () => { for (let i = 0; i < 300; i++) { const s = await stats(); if (s && s.pending === 0) return; await sleep(20); } };
  const origin = await page.evaluate(() => ({ x: window.__seederDrawer.panX, z: window.__seederDrawer.panZ }));
  await waitPending0();
  const cacheBefore = await stats();
  const WANDER = 2; // screen-widths each way
  for (let k = 1; k <= WANDER; k++) {
    await page.evaluate((px) => { const d = window.__seederDrawer; d._stopGlide?.(); d.panX = px; d._markDirty(); }, origin.x + k * box.w);
    await waitPending0();
  }
  const afterWander = await stats();
  await page.evaluate((x, z) => { const d = window.__seederDrawer; d._stopGlide?.(); d.panX = x; d.panZ = z; d._markDirty(); }, origin.x, origin.z);
  await waitPending0();
  const afterReturn = await stats();
  cacheReturn = {
    generatedWander: afterWander.queueAreaRequests - cacheBefore.queueAreaRequests,
    generatedReturn: afterReturn.queueAreaRequests - afterWander.queueAreaRequests,
    tilesCached: afterReturn.tilesCached,
  };
}

console.log(JSON.stringify({
  label: LABEL,
  viewport: `${Math.round(box.w)}x${Math.round(box.h)}`,
  coldFirstPaintMs,
  coldLoadMs,
  seedChange: { avgMs: avg(seedRuns.map((r) => r.ms)), avgGenerated: seedRuns[0].generated != null ? avg(seedRuns.map((r) => r.generated)) : null, runs: seedRuns },
  pan,
  cacheReturn,
  errors,
}, null, 2));

await browser.close();
