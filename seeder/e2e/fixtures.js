// Shared Playwright fixtures and helpers.
//
// Expected values are computed in the test process with the same WASM the browser
// runs (test/engine/harness.js), so the browser pipeline is checked against the
// engine itself rather than against numbers someone typed in.
import { test as base, expect } from '@playwright/test';
import { loadSeeder } from '../test/engine/harness.js';

let seederPromise;
// The engine, for computing expectations (one instance per test process).
export const engine = () => (seederPromise ??= loadSeeder());

export const test = base.extend({
    page: async ({ page }, use) => {
        // Third-party scripts (ads, analytics, donation buttons) are irrelevant here and
        // would only add noise and network flakiness: answer them with empty 200s.
        await page.route(/googlesyndication|google-analytics|googletagmanager|doubleclick|paypal|buymeacoffee/, (route) =>
            route.fulfill({ status: 200, contentType: route.request().resourceType() === 'script' ? 'application/javascript' : 'text/plain', body: '' }));
        const errors = [];
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
        await use(page);
        expect(errors, 'the page must not log errors').toEqual([]);
    },
});
export { expect };

// ---- page helpers ----------------------------------------------------------

export const gotoSeed = async (page, seed, version) => {
    await page.goto(`/seed/?seed=${seed}&version=${version}`);
    await settled(page, { seed: String(seed) });
};

// Wait until the map has painted at least one tile: the cheapest "the seed page is
// alive" signal, for tests that care about arriving on the page rather than about pixels.
export const firstPaint = (page) => page.waitForFunction(
    () => window.__seederDrawer?.getStats?.().tilesStored > 0, undefined, { timeout: 60_000 });

// Snapshot of the renderer's state (window.__seederDrawer is set by DrawSeed).
export const drawer = (page) => page.evaluate(() => {
    const d = window.__seederDrawer;
    return {
        seed: d.seed, mcVersion: d.mcVersion, dimension: d.dimension, yHeight: d.yHeight,
        panX: d.panX, panZ: d.panZ, pixDim: d.pixDim,
        spawnX: d.spawnX, spawnZ: d.spawnZ, strongholds: d.strongholds,
        structures: Object.fromEntries(Object.entries(d.structures).map(([k, v]) => [k, v.map((c) => Array.from(c))])),
        tiles: d.tiles.size, pending: d.pending.size,
        canvasWidth: d.canvas.width, canvasHeight: d.canvas.height,
        colors: d.queue.COLORS,
    };
});

// The canvas must be drawn at the size it is shown at. Every pixel assertion below
// samples the canvas in its own coordinates, so a canvas the browser then stretches
// or squashes would pass them while showing the user a distorted map (that happened
// once, when the page measured its container before the app layout had constrained
// it). Tolerance 1px: MapCanvas sizes the bitmap from the container's clientWidth /
// clientHeight (integers) while the shown rect may be fractional.
export const expectCanvasUndistorted = async (page) => {
    const size = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        return { width: canvas.width, height: canvas.height, shownWidth: rect.width, shownHeight: rect.height };
    });
    expect(Math.abs(size.shownHeight - size.height), `canvas height ${size.height} shown as ${size.shownHeight}`).toBeLessThanOrEqual(1);
    expect(Math.abs(size.shownWidth - size.width), `canvas width ${size.width} shown as ${size.shownWidth}`).toBeLessThanOrEqual(1);
};

// Wait until the map shows exactly these params and every visible tile is painted,
// and check that what is painted is what the user sees (see above).
export const settled = async (page, want = {}) => {
    await page.waitForFunction((want) => {
        const d = window.__seederDrawer;
        if (!d || d.seed == null) return false;
        for (const [k, v] of Object.entries(want)) if (d[k] !== v) return false;
        return d.pending.size === 0 && d.tiles.has(d._tileKey(0, 0)) && d.rafId == null && !!d.queue.COLORS;
    }, want, { timeout: 60_000 });
    await expectCanvasUndistorted(page);
};

// RGBA of one canvas pixel.
export const pixelAt = (page, x, y) => page.evaluate(([x, y]) => {
    const c = document.querySelector('canvas');
    return Array.from(c.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
}, [x, y]);

// The biome label the UI uses for an id (from the renderer's own lookup table).
export const biomeLabel = (page, id) => page.evaluate((id) => window.__seederDrawer.biomeIdToLabel.get(id), id);

// react-select: open the control with this accessible name and pick an option.
// `text` is matched exactly against string labels; pass a RegExp for options whose
// label is markup (Dimension, structures) since the icon's alt text joins the name.
export const pick = async (page, label, text) => {
    await page.getByLabel(label).click();
    const option = typeof text === 'string'
        ? page.getByRole('option', { name: text, exact: true })
        : page.getByRole('option', { name: text });
    await option.first().click();
};

// Expected biome id at a cell for the parameters the page currently shows.
export const expectedBiome = async (page, cx, cz) => {
    const [seeder, d] = await Promise.all([engine(), drawer(page)]);
    return seeder.getArea(d.mcVersion, d.seed, cx, cz, 1, 1, d.dimension, d.yHeight).ids[0];
};

// Assert the pixel showing world cell (cx, cz) has the colour of the engine's biome there.
export const expectCellPainted = async (page, cx, cz) => {
    const d = await drawer(page);
    const id = await expectedBiome(page, cx, cz);
    const px = await pixelAt(page, d.panX + cx * d.pixDim, d.panZ + cz * d.pixDim);
    expect(px, `cell (${cx}, ${cz}) should be biome ${id}`).toEqual(d.colors[id]);
    return id;
};

// ---- bottom sheet (phone layout) ----------------------------------------------

// The sheet's current snap: 'collapsed' | 'half' | 'full'.
export const sheetSnap = (page) => page.locator('.sheet').getAttribute('data-snap');

// Drag the sheet's grip with the mouse to half (the middle of the map area) or full
// (its top), the way a finger would, and wait for it to settle there. The finger
// rests at the target before lifting: page.mouse moves take a few ms, so releasing at
// once is a flick, and a flick goes on to the next snap (by design).
export const openSheet = async (page, snap = 'half') => {
    const area = await page.locator('.sheet').boundingBox();
    const grip = await page.locator('.sheet__grip').boundingBox();
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, area.y + area.height * (snap === 'full' ? 0.02 : 0.5), { steps: 8 });
    await page.waitForTimeout(150);   // longer than the sheet's 80 ms velocity window
    await page.mouse.up();
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', snap);
};

// A real finger swipe from `from` to `to` ({ x, y } in CSS px) through the browser's
// touch pipeline (CDP Input.dispatchTouchEvent), so touch-action, native scrolling and
// pointercancel behave as on a phone; page.mouse and page.touchscreen.tap cannot swipe.
// The finger rests `holdMs` at the end before lifting, so the release is not a flick.
export const touchSwipe = async (page, from, to, { steps = 12, holdMs = 150 } = {}) => {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= steps; i++) {
        await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        await page.waitForTimeout(16);
    }
    if (holdMs) await page.waitForTimeout(holdMs);
    await touch('touchEnd');
    await cdp.detach();
};
