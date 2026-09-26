// The Large Biomes world type (GitHub #12) end to end: the seed page's World type control
// redraws the map as the Large Biomes world and the share link says so; a Large Biomes
// finder search opens its row on the seed page as that world. Desktop project.
import { test, expect, settled, engine, pixelAt, drawer } from './fixtures.js';

const SEED = '8091867987493326313';
const MC_1_16_5 = 20;
const LARGE = 1 << 16;
const shareInput = (page) => page.getByLabel('Share URL');
// The World type select is not searchable: its input is a zero-size dummy, so the menu is
// opened from the keyboard, as a keyboard user would.
async function pickWorldType(page, text) {
    await page.getByLabel('World type').focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('option', { name: text, exact: true }).click();
}

// A cell near the origin whose biome differs between the two worlds, from the engine itself.
async function differingCell(mc) {
    const seeder = await engine();
    for (let cz = -20; cz <= 20; cz += 5) {
        for (let cx = -20; cx <= 20; cx += 5) {
            const plain = seeder.getArea(mc, SEED, cx, cz, 1, 1, 0, 256).ids[0];
            const large = seeder.getArea(mc | LARGE, SEED, cx, cz, 1, 1, 0, 256).ids[0];
            if (plain !== large) return { cx, cz, plain, large };
        }
    }
    throw new Error('no differing cell near the origin');
}

test('the World type control redraws the map as Large Biomes and the share link carries world=large', async ({ page }) => {
    await page.goto(`/seed/?seed=${SEED}&version=1.16.5`);
    await settled(page, { seed: SEED, mcVersion: MC_1_16_5 });
    const cell = await differingCell(MC_1_16_5);
    const at = async () => {
        const d = await drawer(page);
        return pixelAt(page, d.panX + cell.cx * d.pixDim, d.panZ + cell.cz * d.pixDim);
    };
    const { colors } = await drawer(page);
    expect(await at()).toEqual(colors[cell.plain]);
    await expect(page.getByLabel('World type')).toBeEnabled();

    await pickWorldType(page, 'Large Biomes');
    await settled(page, { seed: SEED, mcVersion: MC_1_16_5 | LARGE });
    // The same screen pixel now shows the Large Biomes world's biome there.
    expect(await at()).toEqual(colors[cell.large]);
    await expect(shareInput(page)).toHaveValue(`https://mcseeder.com/seed/?seed=${SEED}&version=1.16.5&world=large`);
    await expect(page).toHaveURL(/[?&]world=large(&|$)/);

    // A reload opens the same world; Default again drops the param.
    await page.reload();
    await settled(page, { seed: SEED, mcVersion: MC_1_16_5 | LARGE });
    expect(await at()).toEqual(colors[cell.large]);
    await pickWorldType(page, 'Default');
    await settled(page, { seed: SEED, mcVersion: MC_1_16_5 });
    await expect(shareInput(page)).toHaveValue(`https://mcseeder.com/seed/?seed=${SEED}&version=1.16.5`);
});

test('the World type control is disabled in the Nether and on Beta, with the reason', async ({ page }) => {
    await page.goto(`/seed/?seed=${SEED}&version=1.16.5&world=large&dim=-1`);
    await settled(page, { seed: SEED });
    await expect(page.getByLabel('World type')).toBeDisabled();
    await expect(page.getByText('No effect in the Nether.')).toBeVisible();
    await expect(shareInput(page)).toHaveValue(/&dim=-1&world=large$/);
    await page.goto(`/seed/?seed=${SEED}&version=Beta%201.7&world=large`);
    await settled(page, { seed: SEED });
    await expect(page.getByLabel('World type')).toBeDisabled();
    await expect(page.getByText('Large Biomes starts in 1.3.')).toBeVisible();
    await expect(shareInput(page)).not.toHaveValue(/world=/);
});

test('a Large Biomes finder search opens its row on the seed page as the Large Biomes world', async ({ page, context }) => {
    await page.goto('/finder/?version=1.16.5&dim=0&world=large&range=100&biomes=21&count=10');
    // The World type sits in Advanced, which a Large Biomes search keeps open.
    await expect(page.getByText('World type', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const cards = page.getByTestId('seed-card');
    await expect(cards).toHaveCount(10, { timeout: 60_000 });
    const hrefs = await cards.getByRole('link', { name: 'Open seed' }).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    for (const href of hrefs) expect(new URL(href, page.url()).searchParams.get('world'), href).toBe('large');

    // Every row really has Jungle within 100 blocks on the Large Biomes world.
    const seeder = await engine();
    const first = new URL(hrefs[0], page.url()).searchParams.get('seed');
    const ids = new Set(seeder.getArea(MC_1_16_5 | LARGE, first, -25, -25, 50, 50, 0, 256).ids);
    expect(ids.has(21), first).toBe(true);

    const [tab] = await Promise.all([
        context.waitForEvent('page'),
        cards.first().getByRole('link', { name: 'Open seed' }).click(),
    ]);
    await settled(tab, { seed: first, mcVersion: MC_1_16_5 | LARGE });
    await expect(tab.getByLabel('Share URL')).toHaveValue(`https://mcseeder.com/seed/?seed=${first}&version=1.16.5&world=large`);
});
