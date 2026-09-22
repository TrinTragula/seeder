import { test, expect, engine, gotoSeed, drawer, settled, pick } from './fixtures.js';

const overlay = (page) => page.getByText('Finding seed...');
const seedInput = (page) => page.getByLabel('Seed');
const foundSeed = async (page) => {
    await expect(overlay(page)).toBeHidden({ timeout: 80_000 });
    const seed = await seedInput(page).inputValue();
    expect(seed).toMatch(/^-?\d+$/);
    await expect(page).toHaveURL(new RegExp(`seed=${seed}(&|$)`));
    return BigInt(seed);
};

test('finds a seed with Plains near the origin, then another one further on', async ({ page }) => {
    await gotoSeed(page, '1', '26.3');
    await expect(page.getByRole('button', { name: 'Find' })).toBeDisabled();
    await pick(page, 'Biomes to find', 'Plains');
    await pick(page, 'Range', '<100 blocks');
    await page.getByRole('button', { name: 'Find' }).click();
    // Plains near the origin is so common that the search can finish within a frame,
    // so the "Finding seed..." overlay may never be observable here.
    const first = await foundSeed(page);
    await settled(page, { seed: String(first) });
    const seeder = await engine();
    const d = await drawer(page);
    expect(Array.from(seeder.getArea(d.mcVersion, String(first), -25, -25, 50, 50, 0, d.yHeight).ids)).toContain(1);

    await page.getByRole('button', { name: 'Find another' }).click();
    const second = await foundSeed(page);
    expect(second).toBeGreaterThan(first);
});

test('finds a seed with a Village near the origin and shows it on the map', async ({ page }) => {
    await gotoSeed(page, '1', '26.3');
    await pick(page, 'Structure to find', /Village/);
    await pick(page, 'Range', '<300 blocks');
    await page.getByRole('button', { name: 'Find' }).click();
    const seed = await foundSeed(page);
    await page.waitForFunction(() => window.__seederDrawer.structures[5]?.length > 0);
    const d = await drawer(page);
    // The search box is 300 blocks wide around (-75,-75) today (see plans/00-shared.md);
    // either way a village must sit within a few hundred blocks of the origin.
    expect(d.structures[5].some(([x, z]) => Math.hypot(x, z) <= 400), `villages: ${JSON.stringify(d.structures[5])}`).toBe(true);
    const seeder = await engine();
    expect(d.structures[5]).toEqual(seeder.getStructuresInRegions(d.mcVersion, 5, String(seed), 50, 0).map((c) => Array.from(c)));
});

test('STOP aborts a hopeless search and the map keeps working afterwards', async ({ page }) => {
    await gotoSeed(page, '1', '26.3');
    await pick(page, 'Biomes to find', 'Mushroom Fields');
    await pick(page, 'Structure to find', /Mansion/);
    await pick(page, 'Range', '<100 blocks');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(overlay(page)).toBeVisible();
    await expect(page.getByText(/seed\/s/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'STOP' }).click();
    await expect(overlay(page)).toBeHidden();
    await expect(seedInput(page)).toHaveValue('1');

    await page.getByRole('button', { name: 'Random seed' }).click();
    const seed = await seedInput(page).inputValue();
    expect(seed).not.toBe('1');
    await settled(page, { seed });
    expect((await drawer(page)).tiles).toBeGreaterThan(0);
});
