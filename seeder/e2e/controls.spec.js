import { test, expect, gotoSeed, drawer, settled, expectCellPainted } from './fixtures.js';

const SEED = '8091867987493326313';

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

test('arrow keys and arrow buttons pan the map', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const before = await drawer(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((x) => window.__seederDrawer.panX > x + 20, before.panX);
    await page.getByAltText('arrow up').first().click();
    await page.waitForFunction((z) => window.__seederDrawer.panZ > z + 20, before.panZ);
});

test('the legend lists every biome with a colour swatch', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await expect(page.getByText('Mushroom Fields', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Show legend' }).click();
    const count = await page.evaluate(() => window.__seederDrawer.biomeIdToLabel.size);
    for (const label of ['Ocean', 'Mushroom Fields', 'Cherry Grove', 'Dappled Forest']) await expect(page.getByText(label, { exact: true })).toBeVisible();
    expect(await page.locator('div', { hasText: /^(Ocean|Plains|Dappled Forest)$/ }).count()).toBeGreaterThanOrEqual(3);
    expect(count).toBeGreaterThan(90);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Mushroom Fields', { exact: true })).toBeHidden();
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });
    test('the side panel is hidden until the menu toggle opens it', async ({ page }) => {
        await gotoSeed(page, SEED, '26.3');
        await expect(page.getByLabel('Seed')).toBeHidden();
        await page.getByRole('button', { name: 'seed menu toggle' }).click();
        await expect(page.getByLabel('Seed')).toBeVisible();
        await expect(page.getByLabel('Seed')).toHaveValue(SEED);
    });
});
