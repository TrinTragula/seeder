// A seed-page link carries the sender's view (GitHub #19): the structures shown, the
// structure coordinates, the slime chunks, the chunk grid and the biome height. The page
// opens with it, and its address bar and Share box then follow the controls (replaceState,
// no history entries). Runs in the desktop project, once per layout: the phone case sets
// Pixel 7 itself (the mobile project's testMatch lists only the specs written for it).
import { devices } from '@playwright/test';
import { test, expect, settled, openSheet } from './fixtures.js';

const SEED = '8091867987493326313';
const VILLAGE = 5;
const CANONICAL = `/seed/?seed=${SEED}&version=26.3`;
const tabBar = (page) => page.getByRole('tablist', { name: 'Dashboard' });
const shareInput = (page) => page.getByLabel('Share URL');

async function openTab(page, name) {
    await tabBar(page).getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}

async function opensTheSendersView(page, isMobile) {
    // Params in any order: the page rewrites them in the contract's order.
    await page.goto(`${CANONICAL}&slime=1&structs=${VILLAGE}`);
    await settled(page, { seed: SEED });
    const address = () => page.evaluate(() => location.pathname + location.search);
    await expect.poll(address).toBe(`${CANONICAL}&structs=${VILLAGE}&slime=1`);
    const historyLength = await page.evaluate(() => history.length);
    await page.waitForFunction((v) => {
        const d = window.__seederDrawer;
        return !!d.overlays.slime && d.structuresShown[v] === true;
    }, VILLAGE);
    if (isMobile) await openSheet(page, 'full');

    // The village filter is picked, and the Share box carries the view.
    await expect(page.locator('#dashboard').getByText('Village', { exact: true })).toBeVisible();
    await expect(shareInput(page)).toHaveValue(`https://mcseeder.com${CANONICAL}&structs=${VILLAGE}&slime=1`);

    // The slime toggle (Find near me, once a point is located) is pressed.
    await openTab(page, 'Find near me');
    const where = page.getByRole('region', { name: 'Find near me' });
    await where.getByLabel('X coordinate').fill('0');
    await where.getByLabel('Z coordinate').fill('0');
    await where.getByRole('button', { name: 'Locate' }).click();
    await expect(where.getByRole('checkbox', { name: 'Show slime chunks on the map' })).toBeChecked();

    // Toggling the grid on: the Share box and the address bar gain grid=1, history does not grow.
    await openTab(page, 'Map');
    await page.getByRole('checkbox', { name: 'Show chunk grid lines' }).check();
    await expect(shareInput(page)).toHaveValue(`https://mcseeder.com${CANONICAL}&structs=${VILLAGE}&slime=1&grid=1`);
    await expect.poll(address).toBe(`${CANONICAL}&structs=${VILLAGE}&slime=1&grid=1`);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await page.waitForFunction(() => !!window.__seederDrawer.overlays.chunkGrid);

    // A reload keeps the whole view.
    await page.reload();
    await settled(page, { seed: SEED });
    await page.waitForFunction((v) => {
        const d = window.__seederDrawer;
        return !!d.overlays.slime && !!d.overlays.chunkGrid && d.structuresShown[v] === true;
    }, VILLAGE);
    await expect.poll(address).toBe(`${CANONICAL}&structs=${VILLAGE}&slime=1&grid=1`);
}

test('desktop: a view link opens with the sender\'s structures and overlays', async ({ page, isMobile }) => {
    await opensTheSendersView(page, isMobile);
});

test('a plain link opens with the defaults and shares a plain link', async ({ page }) => {
    await page.goto(CANONICAL);
    await settled(page, { seed: SEED });
    await expect(shareInput(page)).toHaveValue(`https://mcseeder.com${CANONICAL}`);
    expect(await page.evaluate(() => location.pathname + location.search)).toBe(CANONICAL);
    const d = await page.evaluate(() => ({
        overlays: Object.keys(window.__seederDrawer.overlays),
        shown: Object.keys(window.__seederDrawer.structuresShown),
        y: window.__seederDrawer.yHeight,
    }));
    expect(d).toEqual({ overlays: [], shown: [], y: 256 });
});

test.describe('on a Pixel 7', () => {
    // defaultBrowserType cannot change inside a describe (it needs a new worker); Pixel 7 is Chromium anyway.
    const { defaultBrowserType, ...pixel7 } = devices['Pixel 7'];
    test.use(pixel7);

    test('a view link opens with the sender\'s structures and overlays', async ({ page, isMobile }) => {
        expect(isMobile).toBe(true);
        await opensTheSendersView(page, isMobile);
    });
});
