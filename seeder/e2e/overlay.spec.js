// The map overlays: the slime chunks, switched on from Find near me,
// drawn over the biome tiles, aligned to the chunk grid, and panning with them stays alive;
// and the chunk grid lines from the controls.
// Desktop only: it measures canvas pixels (the phone layout is covered by the dashboard
// spec and the visual check). Which chunks are slime chunks comes from the engine itself.
import { test, expect, engine, gotoSeed, pixelAt } from './fixtures.js';

const SEED = '8091867987493326313';
const whereSection = (page) => page.getByRole('region', { name: 'Find near me' });
const slimeToggle = (page) => whereSection(page).getByRole('checkbox', { name: 'Show slime chunks on the map' });

// The same order-sensitive pixel hash as seed.spec.js.
const checksum = (page) => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    return h;
});
// The map at rest with everything it will draw by itself: tiles, spawn, strongholds, icons.
const atRest = (page) => page.waitForFunction(() => {
    const d = window.__seederDrawer;
    return d.rafId == null && d.glideRaf == null && d.pending.size === 0 && d.spawnX != null && d.strongholds != null
        && d.spawnIcon.complete && d.eyeIcon.complete;
}, undefined, { timeout: 30_000 });
// ...and the slime grid has every block it needs (its requests are not tiles: settled() cannot see them).
const overlayReady = (page) => page.waitForFunction(() => {
    const d = window.__seederDrawer;
    return d.overlays.slime && d.overlays.slime.pending.size === 0 && d.rafId == null && d.glideRaf == null && d.pending.size === 0;
}, undefined, { timeout: 30_000 });
const view = (page) => page.evaluate(() => {
    const d = window.__seederDrawer;
    return { panX: d.panX, panZ: d.panZ, pixDim: d.pixDim };
});

// The engine's slime chunks around the origin, north of it (z < 0): the spawn icon and its
// label sit south of the origin for this seed and would cover the pixels.
async function chunksNearOrigin() {
    const { cells } = (await engine()).slimeChunks({ seed: SEED, cx0: -8, cz0: -8, w: 16, h: 16 });
    const isSlime = (cx, cz) => cells[(cz + 8) * 16 + (cx + 8)] === 1;
    const slime = [];
    const plain = [];
    const isolated = [];
    for (let cz = -7; cz <= -1; cz++) {
        for (let cx = -7; cx <= 6; cx++) {
            if (!isSlime(cx, cz)) { plain.push([cx, cz]); continue; }
            slime.push([cx, cz]);
            if (!isSlime(cx - 1, cz) && !isSlime(cx + 1, cz) && !isSlime(cx, cz - 1) && !isSlime(cx, cz + 1)) isolated.push([cx, cz]);
        }
    }
    expect(slime.length, 'slime chunks near the origin').toBeGreaterThan(0);
    expect(isolated.length, 'a slime chunk with no slime neighbour').toBeGreaterThan(0);
    return { slime, plain, isolated };
}

// Locate (0, 0) in Find near me and tick the overlay's checkbox.
async function switchOn(page) {
    await page.getByRole('tab', { name: 'Find near me' }).click();
    await whereSection(page).getByLabel('X coordinate').fill('0');
    await whereSection(page).getByLabel('Z coordinate').fill('0');
    await whereSection(page).getByRole('button', { name: 'Locate' }).click();
    await slimeToggle(page).check();
    await overlayReady(page);
}

// Screen pixel at the centre of chunk (cx, cz).
const chunkCentre = ({ panX, panZ, pixDim }, [cx, cz]) => [panX + (cx * 4 + 2) * pixDim, panZ + (cz * 4 + 2) * pixDim];

test('ticking the checkbox tints the slime chunks and only them; unticking restores the map exactly', async ({ page }) => {
    const { slime, plain } = await chunksNearOrigin();
    await gotoSeed(page, SEED, '26.3');
    await atRest(page);
    const v = await view(page);
    expect(v.pixDim).toBe(1);
    const before = await checksum(page);
    const [sx, sz] = chunkCentre(v, slime[0]);
    const [px, pz] = chunkCentre(v, plain[0]);
    const slimeBefore = await pixelAt(page, sx, sz);
    const plainBefore = await pixelAt(page, px, pz);

    await switchOn(page);
    expect(await view(page)).toEqual(v);                                  // the map did not move
    expect(await pixelAt(page, sx, sz), `slime chunk ${slime[0]}`).not.toEqual(slimeBefore);
    expect(await pixelAt(page, px, pz), `plain chunk ${plain[0]}`).toEqual(plainBefore);
    const on = await checksum(page);
    expect(on).not.toBe(before);

    await slimeToggle(page).uncheck();
    await page.waitForFunction(() => !window.__seederDrawer.overlays.slime && window.__seederDrawer.rafId == null);
    expect(await checksum(page)).toBe(before);
});

test('at zoom 5 a slime chunk\'s tint ends exactly on its chunk borders', async ({ page }) => {
    const { isolated } = await chunksNearOrigin();
    await gotoSeed(page, SEED, '26.3');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom +' }).click();
    await atRest(page);
    const v = await view(page);
    expect(v.pixDim).toBe(5);
    // The chunk's screen rect, snapped the way the renderer snaps it (20 px per chunk).
    const [cx, cz] = isolated[0];
    const chunkPx = 4 * v.pixDim;
    const dx = Math.round(cx * chunkPx + v.panX);
    const dy = Math.round(cz * chunkPx + v.panZ);
    const dw = Math.round((cx + 1) * chunkPx + v.panX) - dx;
    const dh = Math.round((cz + 1) * chunkPx + v.panZ) - dy;
    const midX = dx + Math.floor(dw / 2);
    const midY = dy + Math.floor(dh / 2);
    // The outermost pixels of the rect, and their neighbours just past the chunk border.
    const inside = [[dx, midY], [dx + dw - 1, midY], [midX, dy], [midX, dy + dh - 1]];
    const outside = [[dx - 1, midY], [dx + dw, midY], [midX, dy - 1], [midX, dy + dh]];
    const sample = (points) => Promise.all(points.map(([x, y]) => pixelAt(page, x, y)));
    const insideBefore = await sample(inside);
    const outsideBefore = await sample(outside);

    await switchOn(page);
    expect(await view(page)).toEqual(v);
    const insideAfter = await sample(inside);
    const outsideAfter = await sample(outside);
    for (let i = 0; i < 4; i++) {
        expect(insideAfter[i], `1 px inside ${['left', 'right', 'top', 'bottom'][i]}`).not.toEqual(insideBefore[i]);
        expect(outsideAfter[i], `1 px outside ${['left', 'right', 'top', 'bottom'][i]}`).toEqual(outsideBefore[i]);
    }
});

test('with the overlay on, dragging the map keeps repainting without errors', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await switchOn(page);
    const box = await page.locator('canvas').boundingBox();
    const renders = await page.evaluate(() => window.__seederDrawer.stats.renders);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 300, y - 200, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__seederDrawer.stats.renders)).toBeGreaterThan(renders);
    // The new area gets its slime data too.
    await overlayReady(page);
    expect(await page.evaluate(() => window.__seederDrawer.overlays.slime.cache.size)).toBeGreaterThan(0);
});

test('chunk grid lines: none at zoom 2, a line on every chunk border from zoom 3, off again when unticked', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const box = page.getByRole('checkbox', { name: 'Show chunk grid lines' });
    const gridDone = () => page.waitForFunction(() => {
        const d = window.__seederDrawer;
        return d.rafId == null && d.glideRaf == null && d.pending.size === 0;
    });
    await page.getByRole('button', { name: 'Zoom +' }).click();
    await atRest(page);
    const at2 = await checksum(page);
    await box.check();
    await page.waitForFunction(() => window.__seederDrawer.overlays.chunkGrid && window.__seederDrawer.rafId == null);
    expect(await checksum(page), 'nothing drawn at zoom 2').toBe(at2);

    await box.uncheck();
    await page.getByRole('button', { name: 'Zoom +' }).click();
    await atRest(page);
    const v = await view(page);
    expect(v.pixDim).toBe(3);
    // Chunk (1, 1): its first pixel column (the border) and a pixel in its middle, away from the spawn icon.
    const chunkPx = 4 * v.pixDim;
    const border = [Math.round(1 * chunkPx + v.panX), Math.round(-5 * chunkPx + v.panZ) + 5];
    const middle = [border[0] + chunkPx / 2, border[1]];
    const before = [await pixelAt(page, ...border), await pixelAt(page, ...middle)];
    const off = await checksum(page);
    await box.check();
    await gridDone();
    expect(await pixelAt(page, ...border), 'the chunk border is lined').not.toEqual(before[0]);
    expect(await pixelAt(page, ...middle), 'inside the chunk nothing changes').toEqual(before[1]);
    await box.uncheck();
    await page.waitForFunction(() => !window.__seederDrawer.overlays.chunkGrid && window.__seederDrawer.rafId == null);
    expect(await checksum(page)).toBe(off);
});
