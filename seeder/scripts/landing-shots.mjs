// Captures the landing's images from the real pages:
//
//     npm run shots        # = vite build && node scripts/landing-shots.mjs
//
// It serves the production build with `vite preview` on :4173, drives headless Chromium
// (the one @playwright/test installed) and writes WebP files to public/img/landing/:
// map.webp and finder.webp (960×600, the two cards) and backdrop.webp (the hero's faint
// biome background, drawn by the engine with no map UI). The images are committed; run
// this again after a visible change to the seed page or the finder.
// Needs `cwebp` on the PATH (macOS: `brew install webp`). There is no PNG fallback:
// the landing's <img> sources name the .webp files.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const APP = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(APP, 'public', 'img', 'landing');
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const SEED = '8091867987493326313';             // the test-vector seed
const WIDTH = 960;
const HEIGHT = 600;

// Same stubs as e2e/fixtures.js: ads, analytics and donate buttons answer empty.
const THIRD_PARTY = /googlesyndication|google-analytics|googletagmanager|doubleclick|paypal|buymeacoffee/;
// The ad units are reserved empty boxes here (the ad script is stubbed): an image of
// the product should not show a hole where an ad would be.
const HIDE_ADS = '.ad { display: none !important; }';

const fail = (message) => {
    console.error(`landing-shots: ${message}`);
    process.exit(1);
};

function requireCwebp() {
    const probe = spawnSync('cwebp', ['-version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
        fail('cwebp was not found on the PATH. Install it (macOS: brew install webp) and run npm run shots again.');
    }
}

async function answers(url) {
    try {
        return (await fetch(url)).ok;
    } catch {
        return false;
    }
}

// Start `vite preview` and resolve once `/` answers. --strictPort makes it fail
// instead of drifting to another port, so a busy :4173 is reported, not screenshotted.
async function startPreview() {
    if (await answers(`${BASE}/`)) {
        fail(`something already serves ${BASE} (the e2e web server or another preview?): stop it and run again.`);
    }
    const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
        cwd: APP,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',   // its own process group, so npx and vite both go down
    });
    let log = '';
    server.stdout.on('data', (chunk) => { log += chunk; });
    server.stderr.on('data', (chunk) => { log += chunk; });
    for (let waited = 0; waited < 30_000; waited += 200) {
        if (server.exitCode != null) fail(`vite preview exited (${server.exitCode}):\n${log}`);
        if (await answers(`${BASE}/`)) return server;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    stopPreview(server);
    return fail(`vite preview did not answer on ${BASE} within 30 s:\n${log}`);
}

function stopPreview(server) {
    if (!server || server.exitCode != null) return;
    try {
        if (process.platform === 'win32') server.kill();
        else process.kill(-server.pid, 'SIGTERM');
    } catch {
        // Already gone.
    }
}

// The seed page's map is idle: this seed on screen, every visible tile painted, no
// render pending, the palette loaded (e2e's settled()), and the strongholds in, which
// the map asks for last (150 of them, about a second on 26.3).
const mapSettled = (page) => page.waitForFunction((seed) => {
    const d = window.__seederDrawer;
    return !!d && d.seed === seed && d.pending.size === 0 && d.tiles.has(d._tileKey(0, 0)) && d.rafId == null
        && !!d.queue.COLORS && d.strongholds?.length > 0;
}, SEED, { timeout: 60_000 });

async function newPage(browser, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.route(THIRD_PARTY, (route) => route.fulfill({
        status: 200,
        contentType: route.request().resourceType() === 'script' ? 'application/javascript' : 'text/plain',
        body: '',
    }));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.errors = errors;
    return page;
}

// Fonts decoded and the ads hidden, then give the last frame a moment to reach the screen.
async function ready(page) {
    await page.addStyleTag({ content: HIDE_ADS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    if (page.errors.length) fail(`${page.url()} logged errors:\n${page.errors.join('\n')}`);
}

// map: the biome map around the origin with villages shown, cropped to the canvas'
// centre so none of the pan arrows or the coordinates box are in the picture.
async function shootMap(browser, file) {
    const page = await newPage(browser, { width: 1600, height: 1000 });
    await page.goto(`${BASE}/seed/?seed=${SEED}&version=26.3`);
    await mapSettled(page);
    await page.getByLabel('Structures to show').click();
    await page.getByRole('option', { name: /Village/ }).first().click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__seederDrawer.structures[5]?.length > 0, undefined, { timeout: 30_000 });
    await mapSettled(page);
    await ready(page);
    const box = await page.getByLabel('Biome map', { exact: true }).boundingBox();
    const clip = {
        x: Math.round(box.x + (box.width - WIDTH) / 2),
        y: Math.round(box.y + (box.height - HEIGHT) / 2),
        width: WIDTH,
        height: HEIGHT,
    };
    await page.screenshot({ path: file, clip });
    await page.context().close();
}

// backdrop: the hero's background, a plain biome picture with nothing drawn on it:
// the area around the origin of a mostly-land seed, straight from the engine (the page's
// own pool) at 1 px per cell. The landing scales it up with nearest-neighbour.
const BACKDROP = { seed: '12345', widthCells: 800, heightCells: 360 };
async function shootBackdrop(browser, file) {
    const page = await newPage(browser, { width: 1280, height: 800 });
    await page.goto(`${BASE}/seed/?seed=${SEED}&version=26.3`);
    await mapSettled(page);
    const png = await page.evaluate(async ({ seed, widthCells: W, heightCells: H }) => {
        const d = window.__seederDrawer;
        const reply = await d.queue.requestArea({
            mcVersion: d.mcVersion, seed, startX: -W / 2, startY: -H / 2, widthX: W, widthY: H, dimension: 0, yHeight: 256,
        });
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(reply.rgba), W, H), 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
    }, BACKDROP);
    writeFileSync(file, Buffer.from(png, 'base64'));
    await page.context().close();
}

// finder: a finished Village search, scrolled so the stats box and the first result
// row start at the top of the screen.
async function shootFinder(browser, file) {
    const page = await newPage(browser, { width: 1280, height: 800 });
    await page.goto(`${BASE}/finder/?version=26.3&structures=5&range=300&count=10`);
    // The version probe has answered once the presets are enabled.
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const results = page.getByRole('region', { name: 'Results' });
    await results.getByRole('status').filter({ hasText: /^Found all 10/ }).waitFor({ timeout: 60_000 });
    // The first two rows are on screen: their thumbnails drawn, their badges resolved.
    const rows = page.locator('[data-testid="seed-card"]');
    for (const index of [0, 1]) await rows.nth(index).locator('canvas').waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="seed-card"]')].slice(0, 2)
        .every((row) => !row.querySelector('.badge-skeleton')), undefined, { timeout: 30_000 });
    await page.mouse.move(0, 0);
    await ready(page);
    await page.evaluate(() => {
        const status = document.querySelector('.finder__status');
        window.scrollTo(0, window.scrollY + status.getBoundingClientRect().top - 16);
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: file });
    await page.context().close();
}

function toWebp(png, name, resize) {
    const target = join(OUT, `${name}.webp`);
    const args = ['-q', '80', ...(resize ? ['-resize', String(WIDTH), String(HEIGHT)] : []), png, '-o', target];
    const run = spawnSync('cwebp', args, { encoding: 'utf8' });
    if (run.status !== 0) fail(`cwebp failed for ${name}:\n${run.stderr}`);
    return target;
}

async function main() {
    requireCwebp();
    mkdirSync(OUT, { recursive: true });
    const scratch = mkdtempSync(join(tmpdir(), 'seeder-shots-'));
    const server = await startPreview();
    let browser;
    try {
        browser = await chromium.launch();
        const shots = [
            { name: 'map', shoot: shootMap, resize: false },          // already a 960×600 clip
            { name: 'finder', shoot: shootFinder, resize: true },    // 1280×800 → 960×600
            { name: 'backdrop', shoot: shootBackdrop, resize: false, size: '800×360' },
        ];
        for (const { name, shoot, resize, size = `${WIDTH}×${HEIGHT}` } of shots) {
            const png = join(scratch, `${name}.png`);
            await shoot(browser, png);
            const webp = toWebp(png, name, resize);
            console.log(`${webp}  ${size}  ${(statSync(webp).size / 1024).toFixed(1)} kB`);
        }
    } finally {
        await browser?.close();
        stopPreview(server);
        rmSync(scratch, { recursive: true, force: true });
    }
}

main().catch((error) => fail(error.stack ?? String(error)));
