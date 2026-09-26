// The seed page on a phone: a full-screen map under the
// header and a bottom sheet whose collapsed header is the seed row. Runs in the
// `mobile` project only (Pixel 7: 412x839, touch, isMobile), plus a 360px-wide case.
// The sheet is driven with page.mouse, which the emulated phone still accepts, and the
// gestures a finger makes (swipes on the tabs and the content) with real touches.
import { test, expect, gotoSeed, drawer, settled, expectCanvasUndistorted, openSheet, sheetSnap, touchSwipe, expectedBiome, biomeLabel } from './fixtures.js';

const SEED = '8091867987493326313';
const seedInput = (page) => page.getByLabel('Seed', { exact: true });
const header = (page) => page.locator('.sheet__header');
const toggle = (page) => page.getByRole('button', { name: 'Toggle world details' });
const viewport = (page) => page.viewportSize();

// The site header stays on top and usable: nothing of the sheet covers its links.
const expectHeaderUncovered = async (page) => {
    const banner = await page.getByRole('banner').boundingBox();
    const panel = await page.getByRole('region', { name: 'World details' }).boundingBox();
    expect(banner.y).toBe(0);
    expect(panel.y, 'the sheet must stay under the header').toBeGreaterThanOrEqual(banner.y + banner.height - 1);
    const link = await page.getByRole('banner').getByRole('link', { name: 'Finder' }).boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('header, .site-header') != null,
        [link.x + link.width / 2, link.y + link.height / 2]);
    expect(hit, 'the header links must still receive taps').toBe(true);
};

test('the map fills the screen under the header and is drawn at its displayed size', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const box = await page.locator('canvas').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(0.8 * viewport(page).height);
    expect(box.width).toBeCloseTo(viewport(page).width, 0);
    await expectCanvasUndistorted(page);
    await expect(page.locator('aside')).toHaveCount(0);
    expect(await sheetSnap(page)).toBe('collapsed');
});

test('the collapsed sheet shows the seed row on one line at the bottom of the screen', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const vh = viewport(page).height;
    const boxes = [];
    for (const control of [seedInput(page), header(page).getByRole('button', { name: 'GO' }), header(page).getByRole('button', { name: 'Random' })]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box.y, 'in the bottom fifth of the screen').toBeGreaterThan(0.8 * vh);
        expect(box.y + box.height, 'entirely on screen').toBeLessThanOrEqual(vh);
        boxes.push(box);
    }
    for (const box of boxes) expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(2);
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
    expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x + 1);
    await expectHeaderUncovered(page);
});

test('dragging the grip opens the sheet halfway, and its content scrolls on its own', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await openSheet(page, 'half');
    await expect(page.locator('.sheet[data-snap="half"]')).toHaveCount(1);
    await expect(page.getByText('Dimension', { exact: true })).toBeVisible();
    await expectHeaderUncovered(page);

    const content = page.locator('.sheet__content');
    const box = await content.boundingBox();
    expect(await content.evaluate((el) => el.scrollTop)).toBe(0);
    // Near the top of the content: at half, the panel's lower part is below the screen.
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // At half the panel's lower part is below the screen: scrolling still reaches the
    // end of the content, and the end stops on screen. Dashboard sections mount their
    // bodies as they scroll into view and grow the content, so keep going to
    // the end until it stops growing, like a reader would.
    await expect.poll(() => content.evaluate(async (el) => {
        const height = el.scrollHeight;
        el.scrollTop = el.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return el.scrollHeight === height;
    }), { message: 'the sheet content stops growing at its end' }).toBe(true);
    const last = page.getByRole('button', { name: 'Save this world' });
    const lastBox = await last.boundingBox();
    expect(lastBox.y + lastBox.height, 'the last control is reachable at half').toBeLessThanOrEqual(viewport(page).height);
    // The compact footer is the last thing in the sheet (not a landmark inside a region).
    const footer = await page.getByText('Buy me a coffee!').boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(viewport(page).height);
    // The map did not move with it.
    const d = await drawer(page);
    expect(d.panX).toBe(d.canvasWidth / 2);
});

test('a finger swiping up on the collapsed sheet\'s tabs opens it, without pressing the tab', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const strip = header(page).getByRole('tablist', { name: 'Dashboard' });
    const tab = strip.getByRole('tab', { name: 'Biomes' });
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    const box = await tab.boundingBox();
    const area = await page.locator('.sheet').boundingBox();
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touchSwipe(page, from, { x: from.x, y: area.y + area.height / 2 });
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'half');
    // A drag, not a tap: the tab it started on was not chosen.
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    // And the seed row: a swipe up from GO moves the sheet on, and does not submit.
    const url = page.url();
    const go = await header(page).getByRole('button', { name: 'GO' }).boundingBox();
    await touchSwipe(page, { x: go.x + go.width / 2, y: go.y + go.height / 2 }, { x: go.x + go.width / 2, y: area.y + 10 });
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
    expect(page.url()).toBe(url);
});

test('a finger on the content: up opens the half sheet fully, then it scrolls, and from the top down closes it', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await openSheet(page, 'half');
    const content = page.locator('.sheet__content');
    const vh = viewport(page).height;
    let box = await content.boundingBox();
    const x = box.x + box.width / 2;
    // Half open: the swipe moves the sheet, the content does not scroll.
    await touchSwipe(page, { x, y: box.y + 80 }, { x, y: box.y + 80 - 300 });
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
    expect(await content.evaluate((el) => el.scrollTop)).toBe(0);
    // Wait for the slide to finish, then scroll the content with the finger.
    await expect.poll(async () => (await page.getByRole('region', { name: 'World details' }).boundingBox()).y).toBeLessThan(60);
    box = await content.boundingBox();
    await touchSwipe(page, { x, y: vh - 100 }, { x, y: vh - 500 }, { holdMs: 0 });
    await expect.poll(() => content.evaluate((el) => el.scrollTop), { message: 'the open sheet scrolls under a finger' }).toBeGreaterThan(100);
    expect(await sheetSnap(page)).toBe('full');
    // Scrolled down, a swipe down scrolls back and leaves the sheet open.
    await touchSwipe(page, { x, y: box.y + 100 }, { x, y: box.y + 200 }, { holdMs: 0 });
    expect(await sheetSnap(page)).toBe('full');
    // From the very top, pulling down takes the sheet down with it.
    await content.evaluate((el) => { el.scrollTop = 0; });
    await touchSwipe(page, { x, y: box.y + 40 }, { x, y: box.y + 40 + 0.45 * box.height });
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'half');
});

test('a slow 150 px swipe up on the half-open content ends fully open and stays there (no slide back)', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await openSheet(page, 'half');
    const box = await page.locator('.sheet__content').boundingBox();
    const x = box.x + box.width / 2;
    await touchSwipe(page, { x, y: box.y + 200 }, { x, y: box.y + 50 }, { steps: 10, holdMs: 200 });
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
    await expect.poll(async () => (await page.getByRole('region', { name: 'World details' }).boundingBox()).y).toBeLessThan(60);
    await page.waitForTimeout(600);
    expect(await sheetSnap(page), 'nothing moves it afterwards').toBe('full');
});

test('the real AdSense override on the ad\'s ancestors does not move the sheet\'s snaps', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const before = await page.locator('.sheet').boundingBox();
    // What adsbygoogle.js does a moment after load (stubbed here): height: auto !important
    // on every ancestor of the ad unit, the sheet's panel included.
    const touched = await page.evaluate(() => {
        const names = [];
        const ad = document.querySelector('.sheet .ad');
        for (let el = ad?.parentElement; el && el !== document.body; el = el.parentElement) {
            el.style.setProperty('height', 'auto', 'important');
            names.push(String(el.className).split(' ')[0]);
        }
        return names;
    });
    expect(touched).toContain('sheet__panel');
    const panel = page.getByRole('region', { name: 'World details' });
    const area = await page.locator('.sheet').boundingBox();
    expect(Math.abs(area.height - before.height), 'the sheet keeps its height').toBeLessThanOrEqual(1);
    expect(Math.round((await panel.boundingBox()).height)).toBe(Math.round(area.height));
    await openSheet(page, 'half');
    await expect.poll(async () => Math.round((await panel.boundingBox()).y - area.y)).toBe(Math.round(area.height / 2));
    const box = await page.locator('.sheet__content').boundingBox();
    const x = box.x + box.width / 2;
    await touchSwipe(page, { x, y: box.y + 200 }, { x, y: box.y + 50 }, { steps: 10, holdMs: 200 });
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
    await expect.poll(async () => Math.round((await panel.boundingBox()).y - area.y)).toBe(0);
});

test('the map still pans by drag above the collapsed sheet', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const box = await page.locator('canvas').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.4;
    const before = await drawer(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 10, cy + i * 4); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(600);   // let any flick glide settle
    const after = await drawer(page);
    expect(after.panX).toBeGreaterThanOrEqual(before.panX + 70);
    expect(after.panZ).toBeGreaterThanOrEqual(before.panZ + 25);
    expect(await sheetSnap(page), 'a drag on the map is not a drag on the sheet').toBe('collapsed');
    await settled(page);
});

test('a tap on the map pins the biome there; the pin rides along with a swipe and closes with its button', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    // What the map can do, in the touch wording, above the down arrow and the collapsed sheet.
    const hint = page.getByText('Drag to move, pinch to zoom, tap to see the biome');
    await expect(hint).toBeVisible();
    await expect(page.getByText('Drag to move, scroll to zoom, point at the map to see the biome')).toBeHidden();
    const [hintBox, down] = [await hint.boundingBox(), await page.getByRole('button', { name: 'Pan down' }).boundingBox()];
    expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(down.y);
    expect(hintBox.x).toBeGreaterThanOrEqual(0);
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(viewport(page).width);
    const canvas = page.getByRole('img', { name: 'Biome map' });
    const box = await canvas.boundingBox();
    const d = await drawer(page);
    const at = { x: box.x + d.panX + 10.5, y: box.y + d.panZ - 6.5 };   // cell (10, -7), above the sheet
    const coords = page.getByText('X: 40, Z: -28');
    const close = page.getByRole('button', { name: 'Close biome info' });
    await expect(coords).toHaveCount(0);
    await page.touchscreen.tap(at.x, at.y);
    await expect(coords).toBeVisible();
    await expect(page.getByText(await biomeLabel(page, await expectedBiome(page, 10, -7)), { exact: true })).toBeVisible();
    await expect(close).toBeVisible();
    await expect(hint, 'a tap is not a move').toBeVisible();
    // Above the tapped point, where the finger was, and wholly inside the map, close button
    // included: in the middle of a phone neither side has room, so it is pushed in.
    const expectInside = async () => {
        const [bubble, button] = [await coords.locator('..').boundingBox(), await close.boundingBox()];
        expect(bubble.y + bubble.height).toBeLessThan(at.y);
        for (const b of [bubble, button]) {
            expect(b.x).toBeGreaterThanOrEqual(box.x);
            expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
        }
    };
    await expectInside();
    // Where the pin is and how far the map is panned.
    const view = () => page.evaluate(() => {
        const d = window.__seederDrawer;
        return { left: d.lastTip.pin.left, top: d.lastTip.pin.top, panX: d.panX, panZ: d.panZ };
    });
    const before = await view();
    // A quick swipe elsewhere whose finger stops before lifting: the map stays exactly where
    // the finger left it (no glide), the pin moves with it, and the swipe pins nothing new.
    const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.25 };
    await touchSwipe(page, from, { x: from.x - 60, y: from.y + 40 }, { steps: 4, holdMs: 150 });
    await page.waitForTimeout(300);   // time a glide would take to show
    const after = await view();
    expect([Math.round(after.panX - before.panX), Math.round(after.panZ - before.panZ)], 'no glide after a resting finger').toEqual([-60, 40]);
    expect([Math.round(after.left - before.left), Math.round(after.top - before.top)], 'the pin moved with the map').toEqual([-60, 40]);
    at.y += 40;
    await expectInside();
    await expect(hint, 'the map has been moved').toHaveCount(0);
    expect(await sheetSnap(page), 'a swipe on the map is not a swipe on the sheet').toBe('collapsed');
    await close.tap();
    await expect(coords).toHaveCount(0);
    await touchSwipe(page, from, { x: from.x + 30, y: from.y + 30 });
    await expect(close).toHaveCount(0);
    expect(await page.evaluate(() => window.__seederDrawer.pin)).toBeNull();
});

test('the pan-down arrow stays above the collapsed sheet', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    const arrow = await page.getByRole('button', { name: 'Pan down' }).boundingBox();
    const panel = await page.getByRole('region', { name: 'World details' }).boundingBox();
    expect(arrow.y + arrow.height).toBeLessThanOrEqual(panel.y);
    const before = await drawer(page);
    await page.getByRole('button', { name: 'Pan down' }).click();
    await page.waitForFunction((z) => window.__seederDrawer.panZ < z - 20, before.panZ);
});

test('the toggle opens the sheet fully under the header, Escape collapses it', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await openSheet(page, 'half');
    await toggle(page).click();
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'full');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    // Wait for the slide to finish before measuring.
    await expect.poll(async () => (await page.getByRole('region', { name: 'World details' }).boundingBox()).y).toBeLessThan(60);
    await expectHeaderUncovered(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'collapsed');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
});

test('a select in the half-open sheet opens its menu on screen and re-renders the map', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await openSheet(page, 'half');
    await page.getByLabel('Minecraft version').click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    const box = await listbox.boundingBox();
    const { width, height } = viewport(page);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await page.getByRole('option', { name: '1.16.5', exact: true }).first().click();
    await expect(page).toHaveURL(/version=1\.16\.5/);
    await settled(page, { mcVersion: 20 });
    expect(await sheetSnap(page), 'picking an option does not move the sheet').toBe('half');
});

test('a "?" tapped in the half-open sheet opens its tip on screen; Escape closes the tip, not the sheet', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await openSheet(page, 'half');
    const tip = page.getByRole('button', { name: 'About the Y level' });
    await tip.tap();
    const bubble = page.getByRole('dialog', { name: 'About the Y level' });
    await expect(bubble).toBeVisible();
    const box = await bubble.boundingBox();
    const { width, height } = viewport(page);
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // On top: the bubble's centre is the bubble, not the sheet under it.
    const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.help-tip__bubble') != null,
        [box.x + box.width / 2, box.y + box.height / 2]);
    expect(onTop).toBe(true);
    expect(await sheetSnap(page), 'a tap on a tip is not a drag').toBe('half');
    await page.keyboard.press('Escape');
    await expect(bubble).toHaveCount(0);
    expect(await sheetSnap(page), 'Escape was the tip\'s').toBe('half');
    await tip.tap();
    await expect(bubble).toBeVisible();
    await page.getByText('Dimension', { exact: true }).tap();
    await expect(bubble).toHaveCount(0);
});

test('GO in the sheet header applies a new seed', async ({ page }) => {
    await gotoSeed(page, SEED, '26.3');
    await seedInput(page).fill('12345');
    await header(page).getByRole('button', { name: 'GO' }).click();
    await settled(page, { seed: '12345' });
    await expect(page).toHaveURL(/seed=12345&/);
    expect(await sheetSnap(page), 'a tap on GO is not a drag').toBe('collapsed');
});

test.describe('on a 360px-wide phone', () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test('nothing scrolls sideways and the seed row still fits', async ({ page }) => {
        await gotoSeed(page, SEED, '26.3');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        await openSheet(page, 'full');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
        const random = await header(page).getByRole('button', { name: 'Random' }).boundingBox();
        expect(random.x + random.width).toBeLessThanOrEqual(360);
        await expectCanvasUndistorted(page);
    });
});
