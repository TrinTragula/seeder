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
    await page.goto(`/?seed=${seed}&version=${version}`);
    await settled(page, { seed: String(seed) });
};

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

// Wait until the map shows exactly these params and every visible tile is painted.
export const settled = async (page, want = {}) => {
    await page.waitForFunction((want) => {
        const d = window.__seederDrawer;
        if (!d || d.seed == null) return false;
        for (const [k, v] of Object.entries(want)) if (d[k] !== v) return false;
        return d.pending.size === 0 && d.tiles.has(d._tileKey(0, 0)) && d.rafId == null && !!d.queue.COLORS;
    }, want, { timeout: 60_000 });
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
