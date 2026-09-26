// Layout with classic scrollbars, the ones that take width (Windows, or macOS with a
// mouse). Headless Chromium hides scrollbars by default, which hid these bugs; the flag
// forces a worker of its own, so these cases live in a file of their own. Desktop only:
// phones draw overlay scrollbars, which take no width.
import { test, expect, settled } from './fixtures.js';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const SEED = '8091867987493326313';

test('switching dashboard tabs never changes the panel\'s width, even on the short Find near me tab', async ({ page }) => {
    await page.goto(`/seed/?seed=${SEED}&version=26.3`);
    await settled(page, { seed: SEED });
    const panel = page.locator('#dashboard');
    const tabBar = page.getByRole('tablist', { name: 'Dashboard' });
    const measure = () => Promise.all([
        panel.evaluate((el) => ({ width: el.clientWidth, overflows: el.scrollHeight > el.clientHeight })),
        tabBar.getByRole('tab', { name: 'More' }).boundingBox(),
        page.getByRole('img', { name: 'Biome map' }).boundingBox(),
    ]);
    const [map, moreTab, canvas] = await measure();
    expect(map.overflows, 'the Map tab scrolls: its scrollbar is on screen').toBe(true);
    for (const name of ['Find near me', 'Spawn & structures', 'Biomes', 'More', 'Map']) {
        await tabBar.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        const [now, tab, box] = await measure();
        expect(now.width, `${name}: the panel keeps its width`).toBe(map.width);
        expect(tab, `${name}: the tab strip stays put`).toEqual(moreTab);
        expect(box, `${name}: the map stays put`).toEqual(canvas);
    }
});
