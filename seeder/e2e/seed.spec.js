// The seed page (/seed/) end to end: the production build in a real browser, with the
// real worker pool and WASM: map painting and sizing, the controls, the arrow buttons,
// the URL contract and the finder CTA.
// Expected values come from the same WASM (fixtures.js `engine()`), never from numbers
// someone typed in.
import { test, expect, engine, gotoSeed, drawer, settled, pick, expectCellPainted, biomeLabel, firstPaint, expectCanvasUndistorted } from './fixtures.js';

const SEED = '8091867987493326313';
// Nothing else on the page may carry an accessible name containing "Seed" (Playwright
// matches labels by substring); exact keeps this locator strict either way.
const seedInput = (page) => page.getByLabel('Seed', { exact: true });

// Order-sensitive hash of every canvas pixel: two renders of the same scene agree,
// anything drawn differently does not.
const checksum = (page) => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    return h;
});
// Until the renderer has nothing left to paint (no frame queued, no glide).
const painted = (page) => page.waitForFunction(() => {
    const d = window.__seederDrawer;
    return d.rafId == null && d.glideRaf == null && d.pending.size === 0;
});

// ---- painting ----------------------------------------------------------------

test('paints the seed with the engine\'s biomes at the right places', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const d = await drawer(page);
    expect(d.tiles).toBeGreaterThan(0);
    expect(d.pixDim).toBe(1);
    expect(d.panX).toBe(d.canvasWidth / 2);
    expect(d.panZ).toBe(d.canvasHeight / 2);
    const ids = new Set();
    for (const [cx, cz] of [[0, 0], [10, -7], [-33, 21], [60, 40]]) ids.add(await expectCellPainted(page, cx, cz));
    expect(ids.size, 'the sampled cells should not all be the same biome').toBeGreaterThan(1);
});

test('the canvas is exactly the size of its box, from the first paint on and after the window changes size', async ({ page }) => {
    await page.goto(`/seed/?seed=${SEED}&version=26.3`);
    await firstPaint(page);
    await expectCanvasUndistorted(page);
    await settled(page, { seed: SEED });
    const before = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        return { width: canvas.width, height: canvas.height, boxWidth: canvas.parentElement.clientWidth, boxHeight: canvas.parentElement.clientHeight };
    });
    expect(before.width).toBe(before.boxWidth);
    expect(before.height).toBe(before.boxHeight);

    // A smaller window: ResizeObserver re-fits the bitmap and the map repaints.
    await page.setViewportSize({ width: 1000, height: 640 });
    await page.waitForFunction((w) => document.querySelector('canvas').width < w, before.width);
    await settled(page, { seed: SEED });
    const after = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        return { width: canvas.width, height: canvas.height, boxWidth: canvas.parentElement.clientWidth, boxHeight: canvas.parentElement.clientHeight };
    });
    expect(after.width).toBe(after.boxWidth);
    expect(after.height).toBe(after.boxHeight);
    expect(after.height).toBeLessThan(before.height);
    await expectCellPainted(page, 0, 0);
});

test('hovering shows the biome, its colour and block coordinates next to the pointer, under a crosshair', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const d = await drawer(page);
    const canvas = page.getByRole('img', { name: 'Biome map' });
    const box = await canvas.boundingBox();
    const at = { x: box.x + d.panX + 10.5, y: box.y + d.panZ - 6.5 };   // cell (10, -7)
    expect(await canvas.evaluate((el) => getComputedStyle(el).cursor)).toContain('crosshair.svg');
    // What the map can do, at its bottom, above the down arrow; the mouse's wording only.
    const hint = page.getByText('Drag to move, scroll to zoom, point at the map to see the biome');
    await expect(hint).toBeVisible();
    await expect(page.getByText('Drag to move, pinch to zoom, tap to see the biome')).toBeHidden();
    const [hintBox, down] = [await hint.boundingBox(), await page.getByRole('button', { name: 'Pan down' }).boundingBox()];
    expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(down.y);
    expect(hintBox.y).toBeGreaterThan(box.y + box.height - 120);
    expect(Math.abs(hintBox.x + hintBox.width / 2 - (box.x + box.width / 2)), 'centred').toBeLessThanOrEqual(1);
    await page.mouse.move(at.x, at.y);
    const id = await expectCellPainted(page, 10, -7);
    const coords = page.getByText('X: 40, Z: -28');
    await expect(coords).toBeVisible();
    const name = page.getByText(await biomeLabel(page, id), { exact: true });
    await expect(name).toBeVisible();
    // Next to the pointer (16 px below right of it), not in a corner of the map.
    const bubble = await coords.locator('..').boundingBox();
    for (const gap of [bubble.x - at.x, bubble.y - at.y]) {
        expect(gap).toBeGreaterThanOrEqual(10);
        expect(gap).toBeLessThanOrEqual(40);
    }
    // The swatch is the colour the cell is painted in.
    expect(await name.evaluate((el) => getComputedStyle(el.previousElementSibling).backgroundColor))
        .toBe(`rgb(${d.colors[id].slice(0, 3).join(', ')})`);
    await expect(hint, 'pointing is not moving').toBeVisible();
    // Dragging: the "grabbing" cursor and no tip. Released after a rest, the map does not
    // glide on, and the tip is back on the same cell, which moved with the pointer.
    const anyTip = page.getByText(/^X: -?\d+, Z: -?\d+$/);
    await page.mouse.down();
    await page.mouse.move(at.x + 40, at.y + 20, { steps: 5 });
    expect(await canvas.evaluate((el) => getComputedStyle(el).cursor)).toBe('grabbing');
    await expect(anyTip).toHaveCount(0);
    await expect(hint, 'the map has been moved: the hint has done its job').toHaveCount(0);
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);   // time a glide would take to show
    expect(await page.evaluate(() => window.__seederDrawer.panX), 'no glide after a resting pointer').toBeCloseTo(d.panX + 40, 0);
    await expect(coords).toBeVisible();
    expect(await canvas.evaluate((el) => getComputedStyle(el).cursor)).toContain('crosshair.svg');
    // Off the map, the tip goes.
    await page.mouse.move(box.x + box.width / 2, box.y - 20);
    await expect(anyTip).toHaveCount(0);
});

test('finds spawn and strongholds like the engine', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await page.waitForFunction(() => window.__seederDrawer.spawnX != null && window.__seederDrawer.strongholds?.length > 0);
    const d = await drawer(page);
    const seeder = await engine();
    expect([d.spawnX, d.spawnZ]).toEqual(Array.from(seeder.findSpawn(d.mcVersion, SEED)));
    expect(d.strongholds.slice(0, 3).map((c) => Array.from(c))).toEqual(seeder.findStrongholds(d.mcVersion, SEED, 3).map((c) => Array.from(c)));
    expect(d.strongholds.length).toBeGreaterThan(100);
});

test('the spawn and stronghold markers are really drawn: hiding their labels changes the canvas', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await page.waitForFunction(() => {
        const d = window.__seederDrawer;
        return d.spawnX != null && d.strongholds?.length > 0 && d.spawnIcon.complete && d.eyeIcon.complete;
    });
    await painted(page);
    const withLabels = await checksum(page);

    await page.getByLabel('Show structure coords').uncheck();
    await page.waitForFunction(() => window.__seederDrawer.showStructureCoords === false);
    await painted(page);
    const withoutLabels = await checksum(page);
    expect(withoutLabels).not.toBe(withLabels);

    await page.getByLabel('Show structure coords').check();
    await page.waitForFunction(() => window.__seederDrawer.showStructureCoords === true);
    await painted(page);
    expect(await checksum(page)).toBe(withLabels);
});

test('switching Minecraft version re-renders with that version\'s generation', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const before = await expectCellPainted(page, 0, 0);
    await pick(page, 'Minecraft version', '1.16.5');
    await expect(page).toHaveURL(/version=1\.16\.5/);
    await settled(page, { mcVersion: 20 });
    await expectCellPainted(page, 0, 0);
    await expectCellPainted(page, 25, 25);
    // Not required to differ, but for this seed the origin biome does change between eras.
    const seeder = await engine();
    expect(seeder.getArea(20, SEED, 0, 0, 1, 1, 0, 256).ids[0]).not.toBe(before);
});

test('renders the Nether and the End', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await pick(page, 'Dimension', /Nether/);
    await settled(page, { dimension: -1 });
    await expectCellPainted(page, 0, 0);
    await expectCellPainted(page, -20, 15);
    await pick(page, 'Dimension', /End/);
    await settled(page, { dimension: 1 });
    await expectCellPainted(page, 0, 0);
    await expectCellPainted(page, 200, 200);
});

test('changing the biome height re-renders underground', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await pick(page, 'Biome height', 'Deep underground (Y=0)');
    await settled(page, { yHeight: 0 });
    await expectCellPainted(page, 0, 0);
    await expectCellPainted(page, 40, -40);
});

test('showing a structure marks every viable position the engine knows within 50 regions', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await pick(page, 'Structures to show', /Village/);
    await page.waitForFunction(() => window.__seederDrawer.structures[5]?.length > 0);
    const d = await drawer(page);
    const seeder = await engine();
    const expected = seeder.getStructuresInRegions(d.mcVersion, 5, SEED, 50, 0).map((c) => Array.from(c));
    expect(d.structures[5]).toEqual(expected);
});

// ---- controls ----------------------------------------------------------------

test('Zoom + doubles the pixel size around the centre and keeps the origin cell painted right', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await page.getByRole('button', { name: 'Zoom +' }).click();
    await page.waitForFunction(() => window.__seederDrawer.pixDim === 2 && window.__seederDrawer.rafId == null);
    const d = await drawer(page);
    expect(d.pixDim).toBe(2);
    expect(d.panX).toBe(d.canvasWidth / 2);
    await expectCellPainted(page, 0, 0);
    await expectCellPainted(page, 5, 5);
    await page.getByRole('button', { name: 'Zoom -' }).click();
    await page.waitForFunction(() => window.__seederDrawer.pixDim === 1);
});

test('the mouse wheel zooms in and out', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => window.__seederDrawer.pixDim === 2);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => window.__seederDrawer.pixDim === 1);
});

test('dragging pans the map, a plain click does not', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const box = await page.locator('canvas').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before = await drawer(page);
    await page.mouse.click(cx, cy);
    expect((await drawer(page)).panX).toBeCloseTo(before.panX, 0);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 10, cy + i * 4); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(600);   // let any flick glide settle
    const after = await drawer(page);
    expect(after.panX).toBeGreaterThanOrEqual(before.panX + 70);
    expect(after.panZ).toBeGreaterThanOrEqual(before.panZ + 25);
    await settled(page);
    expect(after.tiles).toBeGreaterThan(0);
});

test('arrow keys and the arrow buttons pan the map', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const before = await drawer(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((x) => window.__seederDrawer.panX > x + 20, before.panX);
    await page.getByRole('button', { name: 'Pan up' }).click();
    await page.waitForFunction((z) => window.__seederDrawer.panZ > z + 20, before.panZ);
    const afterUp = await drawer(page);
    await page.getByRole('button', { name: 'Pan right' }).click();
    await page.waitForFunction((x) => window.__seederDrawer.panX < x - 20, afterUp.panX);
    await page.getByRole('button', { name: 'Pan down' }).click();
    await page.waitForFunction((z) => window.__seederDrawer.panZ < z - 20, afterUp.panZ);
});

test('typing in the seed box never pans the map', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await painted(page);
    const before = await drawer(page);
    await seedInput(page).click();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const after = await drawer(page);
    expect(after.panX).toBe(before.panX);
    expect(after.panZ).toBe(before.panZ);
    await expect(seedInput(page)).toBeFocused();
});

test('the legend lists every biome with a colour swatch', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await expect(page.getByText('Mushroom Fields', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Show legend' }).click();
    const count = await page.evaluate(() => window.__seederDrawer.biomeIdToLabel.size);
    for (const label of ['Ocean', 'Mushroom Fields', 'Cherry Grove', 'Dappled Forest']) await expect(page.getByText(label, { exact: true })).toBeVisible();
    expect(await page.locator('div', { hasText: /^(Ocean|Plains|Dappled Forest)$/ }).count()).toBeGreaterThanOrEqual(3);
    expect(count).toBeGreaterThan(90);
    // The swatch next to "Plains" is the colour the engine paints Plains in.
    const d = await drawer(page);
    const swatch = await page.getByText('Plains', { exact: true }).locator('xpath=preceding-sibling::div[1]').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(swatch).toBe(`rgb(${d.colors[1].slice(0, 3).join(', ')})`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Mushroom Fields', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show legend' })).toBeVisible();
});

// ---- URL contract --------------------------------------------------------------

test('a shared URL restores seed and version', async ({ page }) => {
    await gotoSeed(page, SEED, '1.18');
    await expect(seedInput(page)).toHaveValue(SEED);
    await expect(page.getByText('1.18', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/seed\/\?seed=8091867987493326313&version=1\.18$/);
    await expect(page).toHaveTitle(`Seed ${SEED} (1.18) - Seeder`);
    const d = await drawer(page);
    expect(d.seed).toBe(SEED);
    expect(d.mcVersion).toBe(22);
});

test('a decimal too big for a 64-bit long is hashed like Minecraft does, and the URL names the hash', async ({ page }) => {
    const text = '18446744073709551615';
    // Java's String.hashCode, what Minecraft falls back to when Long.parseLong refuses the text.
    let hash = 0;
    for (const ch of text) hash = (Math.imul(31, hash) + ch.charCodeAt(0)) | 0;
    const seed = String(hash);
    await page.goto(`/seed/?seed=${text}&version=1.20`);
    await settled(page, { seed });
    await expect(seedInput(page)).toHaveValue(seed);
    await expect(page).toHaveURL(new RegExp(`/seed/\\?seed=${seed}&version=1\\.20$`));
});

test('an old share URL with a numeric version is redirected to /seed/ and rewritten to the label', async ({ page }) => {
    await page.goto('/?version=17&seed=42');
    await settled(page, { seed: '42' });
    await expect(page.getByText('1.17', { exact: true })).toBeVisible();
    // The legacy redirect appends from=legacy; the seed page strips it on its first replaceState.
    await expect(page).toHaveURL(/\/seed\/\?seed=42&version=1\.17$/);
    expect((await drawer(page)).mcVersion).toBe(21);
});

test('without parameters the page picks a random seed and the default version, and publishes them', async ({ page }) => {
    await page.goto('/seed/');
    await page.waitForFunction(() => window.__seederDrawer?.seed != null);
    const seed = await seedInput(page).inputValue();
    expect(seed).toMatch(/^-?\d+$/);
    await expect(page).toHaveURL(new RegExp(`/seed/\\?seed=${seed}&version=26\\.3$`));
    await expect(page.getByText('26.3', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`Seed ${seed} (26.3) - Seeder`);
});

test('the share box is the canonical mcseeder.com URL, COPY puts it on the clipboard with a toast, and copies the next seed\'s URL', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    const shared = 'https://mcseeder.com/seed/?seed=123&version=26.3';
    // A link copied from a preview build has to work for whoever receives it.
    expect(page.url()).not.toBe(shared);
    await expect(page.getByLabel('Share URL')).toHaveValue(shared);
    await page.getByRole('button', { name: 'COPY' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'COPY' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shared);

    await seedInput(page).fill('124');
    await page.getByRole('button', { name: 'GO' }).click();
    await expect(page.getByLabel('Share URL')).toHaveValue('https://mcseeder.com/seed/?seed=124&version=26.3');
    await page.getByRole('button', { name: 'COPY' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('https://mcseeder.com/seed/?seed=124&version=26.3');
});

test('the dimension is part of the URL, and only when it is not the Overworld', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await expect(page).toHaveURL(/\/seed\/\?seed=123&version=26\.3$/);

    await pick(page, 'Dimension', /Nether/);
    await expect(page).toHaveURL(/\/seed\/\?seed=123&version=26\.3&dim=-1$/);
    await settled(page, { seed: '123', dimension: -1 });
    await expect(page.getByLabel('Share URL')).toHaveValue('https://mcseeder.com/seed/?seed=123&version=26.3&dim=-1');

    await pick(page, 'Dimension', /End/);
    await expect(page).toHaveURL(/&dim=1$/);
    await pick(page, 'Dimension', /Overworld/);
    await expect(page).toHaveURL(/\/seed\/\?seed=123&version=26\.3$/);
});

test('a ?dim= link opens in that dimension', async ({ page }) => {
    await page.goto('/seed/?seed=123&version=26.3&dim=-1');
    await settled(page, { seed: '123', dimension: -1 });
    await expect(page.getByText('Nether', { exact: true })).toBeVisible();
});

test('from=legacy shows the what\'s-new card once and never stays in the address bar', async ({ page }) => {
    await page.goto('/seed/?seed=42&version=1.17&from=legacy');
    await settled(page, { seed: '42' });

    await expect(page.getByRole('heading', { name: 'Seeder has new sections' })).toBeVisible();
    await expect(page).toHaveURL(/\/seed\/\?seed=42&version=1\.17$/);
    expect(page.url()).not.toContain('from=');

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('heading', { name: 'Seeder has new sections' })).toBeHidden();

    // The flag is remembered, so a second legacy visit is not nagged again.
    await page.goto('/seed/?seed=42&version=1.17&from=legacy');
    await settled(page, { seed: '42' });
    await expect(page.getByRole('heading', { name: 'Seeder has new sections' })).toBeHidden();
});

test('the address bar is replaced, not pushed: back leaves the seed page in one step', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Seed', exact: true }).click();
    await settled(page);

    // Three state changes that all rewrite the URL.
    await seedInput(page).fill('-98765');
    await page.getByRole('button', { name: 'GO' }).click();
    await expect(page).toHaveURL(/seed=-98765&/);
    await page.getByRole('button', { name: 'Random seed' }).click();
    await pick(page, 'Dimension', /Nether/);
    await expect(page).toHaveURL(/&dim=-1$/);

    await page.goBack();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seeder - Minecraft seed map, finder & explorer');
});

test('a non-numeric ?seed= parameter is hashed like typed text and the map still renders', async ({ page }) => {
    await page.goto('/seed/?seed=12abc&version=26.3');
    await settled(page, { seed: '46838433' });                // Java "12abc".hashCode()
    await expect(seedInput(page)).toHaveValue('46838433');
    await expect(page).toHaveURL(/seed=46838433&version=26\.3$/);
});

test('a text seed is hashed like Minecraft does and lands in the URL', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await seedInput(page).fill('hello');
    await seedInput(page).press('Enter');
    await expect(page).toHaveURL(/seed=99162322&/);
    await settled(page, { seed: '99162322' });
    await expect(seedInput(page)).toHaveValue('hello');       // the box keeps what was typed
});

test('GO and Random seed change the seed in the URL and on the map', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await seedInput(page).fill('-98765');
    await page.getByRole('button', { name: 'GO' }).click();
    await expect(page).toHaveURL(/seed=-98765&/);
    await settled(page, { seed: '-98765' });
    await page.getByRole('button', { name: 'Random seed' }).click();
    const seed = await seedInput(page).inputValue();
    expect(seed).not.toBe('-98765');
    await expect(page).toHaveURL(new RegExp(`seed=${seed}&`));
    await settled(page, { seed });
});

// ---- what moved to /finder/ --------------------------------------------------------

test('the inline seed finder is gone; the CTA opens the advanced finder for the current version and dimension', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await expect(page.getByRole('button', { name: 'Find', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Biomes to find')).toHaveCount(0);
    await expect(page.getByLabel('Structure to find')).toHaveCount(0);
    await expect(page.getByText('Finding seed...')).toHaveCount(0);

    const cta = page.getByRole('link', { name: 'Open the advanced finder' });
    await expect(cta).toHaveAttribute('href', '/finder/?version=26.3&dim=0');
    await pick(page, 'Dimension', /Nether/);
    await expect(cta).toHaveAttribute('href', '/finder/?version=26.3&dim=-1');
    await cta.click();
    await expect(page).toHaveURL(/\/finder\/\?version=26\.3&dim=-1$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minecraft seed finder');
});
