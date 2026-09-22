import { test, expect, engine, gotoSeed, drawer, settled, pick, expectCellPainted, biomeLabel } from './fixtures.js';

const SEED = '8091867987493326313';

test('paints the seed with the engine\'s biomes at the right places', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const d = await drawer(page);
    expect(d.tiles).toBeGreaterThan(0);
    expect(d.pixDim).toBe(1);
    expect(d.panX).toBe(d.canvasWidth / 2);
    const ids = new Set();
    for (const [cx, cz] of [[0, 0], [10, -7], [-33, 21], [60, 40]]) ids.add(await expectCellPainted(page, cx, cz));
    expect(ids.size, 'the sampled cells should not all be the same biome').toBeGreaterThan(1);
});

test('hovering shows block coordinates and the biome name', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const d = await drawer(page);
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + d.panX + 10.5, box.y + d.panZ - 6.5);   // cell (10, -7)
    const id = await expectCellPainted(page, 10, -7);
    await expect(page.getByText('X: 40, Z: -28')).toBeVisible();
    await expect(page.getByText(await biomeLabel(page, id), { exact: true })).toBeVisible();
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
