import { readFileSync } from 'node:fs';
import { test, expect, settled } from './fixtures.js';

// /finder/. The first cases cover the page shell, the URL contract and the version-gated
// presets; the rest run real searches on the production build's worker pool.

const form = (page) => page.getByRole('form', { name: 'Search criteria' });
const results = (page) => page.getByRole('region', { name: 'Results' });
const cards = (page) => page.locator('[data-testid="seed-card"]');
const searchButton = (page) => page.getByRole('button', { name: 'Search', exact: true });
const stopButton = (page) => page.getByRole('button', { name: 'STOP', exact: true });

// react-select in the criteria form, by the combobox's exact name: fixtures' pick()
// matches labels by substring, and "Range" is also in "Exact range (blocks)". The menu
// opens from the keyboard: a select that is not searchable (Range) has only an
// off-screen dummy input to click.
async function choose(page, label, option) {
    await form(page).getByRole('combobox', { name: label, exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    const match = typeof option === 'string'
        ? page.getByRole('option', { name: option, exact: true })
        : page.getByRole('option', { name: option });
    await match.first().click();
}

// On a phone only the pinned preset group starts open: open the others, so every chip
// can be clicked. A desktop shows every group and has no disclosures.
const PRESET_GROUPS = ['Survival starts', 'Speedrun', 'Jackpot seeds', "Builders' biomes", 'Structure hunts', 'Nether & End'];
async function openPresetGroups(page) {
    const presets = page.getByRole('region', { name: 'Presets' });
    await expect(presets.getByRole('heading', { name: 'Survival starts' })).toBeVisible();
    for (const group of PRESET_GROUPS) {
        const toggle = presets.getByRole('button', { name: group, exact: true });
        if (await toggle.count() && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
}

// The finder is ready once the version probe has answered: the presets are enabled
// and the form's options reflect the version. Picking earlier can race the probe.
async function openFinder(page) {
    await page.goto('/finder/');
    await openPresetGroups(page);
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
}

// The slow search the STOP cases need: Mushroom Fields + Mansion within 100 blocks on
// 26.3 finds nothing for minutes.
async function chooseHopeless(page) {
    await choose(page, 'Biomes', 'Mushroom Fields');
    await choose(page, 'Structures', /Mansion/);
    await choose(page, 'Range', '100 blocks');
    await expect(form(page).getByText('Mushroom Fields', { exact: true })).toBeVisible();
    await expect(form(page).getByText('Mansion', { exact: true })).toBeVisible();
    await expect(form(page).getByText('100 blocks', { exact: true })).toBeVisible();
}

test('a criteria URL prefills the form and never starts a search', async ({ page }) => {
    await page.goto('/finder/?version=26.3&structures=5&biomes=185&range=300&count=25');
    const criteria = form(page);
    await expect(criteria.getByText('Village', { exact: true })).toBeVisible();
    await expect(criteria.getByText('Cherry Grove', { exact: true })).toBeVisible();
    await expect(criteria.getByText('300 blocks', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: '25' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled();

    // Nothing runs by itself: no progress, no "seeds checked", no cards within 2 s.
    await page.waitForTimeout(2_000);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText(/seeds checked/i)).toHaveCount(0);
    for (const status of await page.getByRole('status').all()) await expect(status).toBeEmpty();
    await expect(page.getByText('Search runs arrive with the next update.')).toHaveCount(0);
    // The page republished its own canonical URL: every parameter, in the fixed order.
    expect(new URL(page.url()).search).toBe('?version=26.3&dim=0&range=300&y=256&count=25&start=0&biomes=185&structures=5');
});

test('on 1.12 the Cherry Grove preset is disabled with its reason', async ({ page }) => {
    await page.goto('/finder/?version=1.12');
    await openPresetGroups(page);
    const cherry = page.getByRole('button', { name: 'Cherry Grove at spawn', exact: true });
    await expect(cherry).toBeDisabled();
    await expect(cherry).toHaveAttribute('title', 'Cherry Grove does not exist in 1.12.');
    await expect(cherry).toHaveAccessibleDescription('Cherry Grove does not exist in 1.12. Cherry Grove, 100 blocks');
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
});

test('the pinned group comes first; on 1.20 its Camp at spawn switches to 26.3 and finds camps', async ({ page }) => {
    await page.goto('/finder/?version=1.20');
    const presets = page.getByRole('region', { name: 'Presets' });
    await expect(presets.getByRole('heading', { level: 3 }).first()).toHaveText('New in 26.3');
    const camp = presets.getByRole('button', { name: 'Camp at spawn', exact: true });
    await expect(camp).toBeEnabled();
    await expect(camp).toHaveAccessibleDescription('Switches to 26.3. Abandoned Camp, 100 blocks');
    await camp.click();
    await expect(page).toHaveURL(/[?&]version=26\.3(&|$)/);
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    const hrefs = await cards(page).getByRole('link', { name: 'Open seed' }).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    for (const href of hrefs) expect(new URL(href, page.url()).searchParams.get('version'), href).toBe('26.3');
    await expect(cards(page).first().getByRole('list', { name: 'Structures' })).toContainText('Abandoned Camp');
});

test('a preset far down the list searches from the top of the page; "Back to presets" starts over', async ({ page, isMobile }) => {
    await openFinder(page);
    const chip = page.getByRole('button', { name: 'First End City', exact: true });
    await chip.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await chip.click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Beside the title, inside its line box (the CSS centres it on the letters). A phone
    // with results keeps both on one compact line: the visible label shrinks to "Presets".
    const back = page.getByRole('button', { name: 'Back to presets' });
    await expect(back).toBeVisible();
    await expect(back).toHaveText(isMobile ? 'Presets' : 'Back to presets');
    const [title, button] = [await page.getByRole('heading', { level: 1 }).boundingBox(), await back.boundingBox()];
    expect(button.x).toBeGreaterThan(title.x + title.width);
    expect(button.y).toBeGreaterThanOrEqual(title.y);
    expect(button.y + button.height).toBeLessThanOrEqual(title.y + title.height);
    await back.click();
    await expect(cards(page)).toHaveCount(0);
    await expect(back).toHaveCount(0);
    const presetsHeading = page.getByRole('heading', { name: 'Presets', level: 2 });
    await expect(presetsHeading).toBeFocused();
    // In view near the top of the screen, even on a phone where the form comes first.
    const top = await presetsHeading.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(page.viewportSize().height / 3);
    await expect(results(page).getByRole('status')).toHaveCount(0);
    // The form keeps the preset's criteria: End City, the End, 1,100 blocks.
    await expect(page).toHaveURL(/[?&]dim=1(&|$)/);
    await expect(page).toHaveURL(/[?&]range=1100(&|$)/);
});

test('on a phone only the pinned preset group is open; a group opens with a tap', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    await page.goto('/finder/');
    const presets = page.getByRole('region', { name: 'Presets' });
    await expect(presets.getByRole('button', { name: 'New in 26.3', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(presets.getByRole('button', { name: 'Camp at spawn', exact: true })).toBeVisible();
    await expect(presets.getByRole('button', { name: 'Village at spawn', exact: true })).toHaveCount(0);
    await presets.getByRole('button', { name: 'Survival starts', exact: true }).click();
    await expect(presets.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('one column at 360 px, two columns at 1280 px', async ({ page, isMobile }) => {
    test.skip(isMobile, 'resizes a desktop window');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/finder/');
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
    const criteria = page.locator('.finder__criteria');
    const results = page.locator('.finder__results');
    let c = await criteria.boundingBox();
    let r = await results.boundingBox();
    expect(Math.round(c.width)).toBe(320);
    expect(r.x).toBeGreaterThan(c.x + c.width);
    expect(Math.abs(r.y - c.y)).toBeLessThan(2);

    await page.setViewportSize({ width: 360, height: 740 });
    c = await criteria.boundingBox();
    r = await results.boundingBox();
    expect(Math.abs(r.x - c.x)).toBeLessThan(2);
    expect(r.y).toBeGreaterThan(c.y + c.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('the header marks Finder as the current section', async ({ page }) => {
    await page.goto('/finder/');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Finder' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minecraft seed finder');
});

// ---- searches ------------------------------------------------------------------

// Every text any status region shows from now on: a fast search can be over before a
// poll sees its live line.
const recordStatuses = (page) => page.evaluate(() => {
    window.__statusTexts = [];
    const grab = () => {
        for (const el of document.querySelectorAll('[role="status"]')) {
            if (el.textContent) window.__statusTexts.push(el.textContent);
        }
    };
    new MutationObserver(grab).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const statusTexts = (page) => page.evaluate(() => window.__statusTexts);

// The first structure of a card, as the card prints it: "(x, z)".
async function firstStructure(card) {
    const text = await card.getByRole('list', { name: 'Structures' }).getByRole('listitem').first().locator('code').textContent();
    const [, x, z] = text.match(/^\((-?\d+), (-?\d+)\)$/);
    return { x: Number(x), z: Number(z) };
}

// The preview map shows `seed`, has finished its pan, and highlights `label` there.
async function expectPreviewAt(page, seed, { x, z }, label) {
    await settled(page, { seed });
    await page.waitForFunction(() => window.__seederDrawer.glideRaf == null && !!window.__seederDrawer.highlight);
    const d = await page.evaluate(() => {
        const r = window.__seederDrawer;
        return { highlight: r.highlight, panX: r.panX, panZ: r.panZ, pixDim: r.pixDim, W: r.canvas.width, H: r.canvas.height };
    });
    expect(d.highlight).toEqual({ x, z, label });
    // The map is drawn at the size it is shown at (fixtures' settled() checks the first
    // canvas in the document, which is now a row's thumbnail).
    const shown = await page.getByLabel('Biome map').boundingBox();
    expect(Math.abs(shown.width - d.W)).toBeLessThanOrEqual(1);
    expect(Math.abs(shown.height - d.H)).toBeLessThanOrEqual(1);
    // Centred: DrawSeed's pan puts block (x, z) at the canvas centre (4 blocks per cell).
    expect(Math.abs(d.panX + (x / 4) * d.pixDim - d.W / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(d.panZ + (z / 4) * d.pixDim - d.H / 2)).toBeLessThanOrEqual(1);
}

test('Plains within 100 blocks on 1.17 streams 10 cards with canonical seed links', async ({ page }) => {
    await openFinder(page);
    await choose(page, 'Minecraft version', '1.17');
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
    await choose(page, 'Biomes', 'Plains');
    await choose(page, 'Range', '100 blocks');
    await expect(form(page).getByText('Plains', { exact: true })).toBeVisible();
    await expect(form(page).getByText('100 blocks', { exact: true })).toBeVisible();
    await expect(form(page).getByText('1.17', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: '10' })).toBeChecked();
    await recordStatuses(page);

    const t0 = Date.now();
    await searchButton(page).click();
    await expect(cards(page).first()).toBeVisible({ timeout: 60_000 });
    const first = Date.now() - t0;
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    const ten = Date.now() - t0;
    console.log(`Plains ±100 on 1.17: first card ${first} ms, 10 cards ${ten} ms`);

    await expect(results(page).getByRole('status')).toHaveText(/^Found all 10/);
    expect((await statusTexts(page)).some((t) => /Searching… [\d,]+ seeds checked · [\d,]+ seeds\/s/.test(t))).toBe(true);
    await expect(stopButton(page)).toHaveCount(0);
    const hrefs = await cards(page).getByRole('link', { name: 'Open seed' }).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toHaveLength(10);
    for (const href of hrefs) expect(href).toMatch(/^\/seed\/\?seed=-?\d+&version=1\.17$/);
    // Ten distinct seeds.
    expect(new Set(hrefs).size).toBe(10);
});

test('Village at spawn: the preset searches at once, rows stream in with thumbnails; a clicked row opens its map in place', async ({ page, isMobile }) => {
    await openFinder(page);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    // No Search click: the preset fills the form (the URL holds its state) and searches.
    await expect(page).toHaveURL(/[?&]structures=5(&|$)/);
    await expect(results(page).getByRole('status')).toHaveText(/^(Searching|Found)/);
    await expect(cards(page).first()).toBeVisible({ timeout: 60_000 });
    const first = Date.now() - t0;
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    const ten = Date.now() - t0;
    console.log(`Village ±100 on 26.3: first card ${first} ms, 10 cards ${ten} ms`);
    // The rows took the place of the clicked chip: move the pointer off the first row, whose
    // hover lift (translate -1 px) would otherwise shift it.
    await page.mouse.move(0, 0);

    // One row per line, full width, each with a pixel-exact thumbnail (1 px per cell, the map's zoom 1).
    const card = cards(page).first();
    const seed = (await card.locator('code').first().textContent()).trim();
    const thumb = card.getByRole('button', { name: `Preview ${seed}` });
    await expect(thumb.locator('canvas')).toBeVisible({ timeout: 60_000 });
    const size = await thumb.evaluate((button) => {
        const c = button.querySelector('canvas');
        const b = c.getBoundingClientRect();
        return { w: c.width, h: c.height, shownW: b.width, shownH: b.height, boxW: button.clientWidth };
    });
    expect(Math.abs(size.shownW - size.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(size.shownH - size.h)).toBeLessThanOrEqual(2);
    expect(size.w).toBe(size.boxW);
    // The band along the thumbnail's bottom says a click opens the map: "Tap" on a touch screen.
    const [said, unsaid] = isMobile ? ['Tap to explore the map', 'Click to explore the map'] : ['Click to explore the map', 'Tap to explore the map'];
    await expect(thumb.getByText(said)).toBeVisible();
    await expect(thumb.getByText(unsaid)).toBeHidden();
    const [band, thumbBox] = [await thumb.getByText(said).locator('..').boundingBox(), await thumb.boundingBox()];
    expect(Math.abs(band.y + band.height - (thumbBox.y + thumbBox.height)), 'on the bottom edge').toBeLessThanOrEqual(1);
    expect(Math.abs(band.width - thumbBox.width), 'full width').toBeLessThanOrEqual(1);
    const [a, b] = [await cards(page).nth(0).boundingBox(), await cards(page).nth(1).boundingBox()];
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    // Nothing is open until a click.
    await expect(page.getByLabel('Biome map')).toHaveCount(0);
    await expect(thumb).toHaveAttribute('aria-expanded', 'false');

    // Opened: the map takes the thumbnail's place in the same box, centred on the nearest
    // village - the thumbnail was its first frame.
    const before = await thumb.boundingBox();
    // A 7×5 grid of the thumbnail's pixels, away from the edges.
    const grid = (w, h) => Array.from({ length: 35 }, (_, i) => [Math.round(((i % 7) + 0.5) * w / 7), Math.round((Math.floor(i / 7) + 0.5) * h / 5)]);
    const thumbPixels = await thumb.evaluate((button, pts) => {
        const c = button.querySelector('canvas');
        const ctx = c.getContext('2d');
        return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
    }, grid(size.w, size.h));
    await thumb.click();
    await expect(card.getByLabel('Biome map')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Close preview' })).toBeFocused();
    await expectPreviewAt(page, seed, await firstStructure(card), 'Village');
    const map = await card.getByLabel('Biome map').boundingBox();
    expect(Math.abs(map.height - before.height), 'the open map is exactly as tall as the thumbnail').toBeLessThanOrEqual(1);
    expect(Math.abs(map.width - before.width)).toBeLessThanOrEqual(1);
    await settled(page);
    const mapPixels = await page.evaluate((pts) => {
        const ctx = window.__seederDrawer.canvas.getContext('2d');
        return pts.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
    }, grid(size.w, size.h));
    // The same picture: icons, the highlight and a half-cell rounding may differ here and there.
    const same = thumbPixels.filter((px, i) => px.every((v, k) => Math.abs(v - mapPixels[i][k]) <= 2)).length;
    expect(same, `${same}/35 sampled pixels match between the thumbnail and the open map`).toBeGreaterThanOrEqual(28);

    // Another row: the first closes and the map moves there.
    const other = cards(page).nth(3);
    const otherSeed = (await other.locator('code').first().textContent()).trim();
    const otherThumb = other.getByRole('button', { name: `Preview ${otherSeed}` });
    await otherThumb.click();
    await expect(other.getByLabel('Biome map')).toBeVisible();
    await expect(page.getByLabel('Biome map')).toHaveCount(1);
    await expect(card.getByRole('button', { name: `Preview ${seed}` })).toBeVisible();
    await expectPreviewAt(page, otherSeed, await firstStructure(other), 'Village');

    // Escape closes it and gives the focus back to its thumbnail.
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Biome map')).toHaveCount(0);
    await expect(otherThumb).toBeFocused();
});

// The rows' late answers (spawn biome, structure variants) have landed: the list keeps its
// height for 800 ms. A variant badge that wraps its line on a phone ("Zombie village")
// grows its row by 21 px about a second after the row appears.
async function rowsSettled(page) {
    await page.waitForFunction(() => {
        const s = window.__rowsProbe ??= { h: -1, since: performance.now() };
        const h = document.querySelector('[role="list"][aria-label="Seeds found"]').getBoundingClientRect().height;
        if (h !== s.h) Object.assign(s, { h, since: performance.now() });
        if (performance.now() - s.since < 800) return false;
        delete window.__rowsProbe;
        return true;
    }, undefined, { polling: 100, timeout: 15_000 });
}

// An opened row lands with its top edge 16 px under the top of the screen and its whole
// map in view. Waits for the smooth scroll to finish. When the
// page cannot scroll that far (the last rows), the row sits lower but the map must
// still be fully visible.
async function expectOpenedAtTop(page, card) {
    await expect(card.getByLabel('Biome map')).toBeVisible();
    await page.waitForFunction(() => {
        const s = window.__scrollProbe ??= { y: -1, still: 0 };
        s.still = window.scrollY === s.y ? s.still + 1 : 0;
        s.y = window.scrollY;
        if (s.still >= 5) { delete window.__scrollProbe; return true; }
        return false;
    }, undefined, { polling: 50, timeout: 5_000 });
    const r = await card.evaluate((article) => {
        const map = article.querySelector('canvas[aria-label="Biome map"]').getBoundingClientRect();
        const row = article.getBoundingClientRect();
        const doc = document.documentElement;
        return {
            rowTop: row.top, mapTop: map.top, mapBottom: map.bottom, viewport: window.innerHeight,
            atBottom: Math.ceil(window.scrollY + window.innerHeight) >= doc.scrollHeight - 1,
        };
    });
    expect(r.mapTop, 'the map starts inside the screen').toBeGreaterThanOrEqual(0);
    expect(r.mapBottom, 'the map ends inside the screen').toBeLessThanOrEqual(r.viewport + 1);
    if (!r.atBottom) expect(Math.abs(r.rowTop - 16), `row top at ${r.rowTop} px`).toBeLessThanOrEqual(2);
    else expect(r.rowTop).toBeGreaterThanOrEqual(14);
}

test('opening a row scrolls it near the top of the screen with its map in view, however it is reached', async ({ page }) => {
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await rowsSettled(page);
    const thumbOf = (i) => cards(page).nth(i).getByRole('button', { name: /^Preview / });

    // 1. The first row, from the top of the page (it starts below the stats bar and the ad).
    await page.evaluate(() => window.scrollTo(0, 0));
    await thumbOf(0).click();
    await expectOpenedAtTop(page, cards(page).nth(0));

    // 2. A row far below while the first is open: the first shrinks as this one opens.
    await thumbOf(6).scrollIntoViewIfNeeded();
    await thumbOf(6).click();
    await expectOpenedAtTop(page, cards(page).nth(6));
    await expect(page.getByLabel('Biome map')).toHaveCount(1);

    // 3. A row above the open one, half off the top of the screen: the page scrolls up.
    await thumbOf(2).evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.evaluate(() => window.scrollBy(0, 150));
    await thumbOf(2).click({ position: { x: 20, y: 5 } });
    await expectOpenedAtTop(page, cards(page).nth(2));

    // 4. The last row.
    await thumbOf(9).scrollIntoViewIfNeeded();
    await thumbOf(9).click();
    await expectOpenedAtTop(page, cards(page).nth(9));

    // 5. From the keyboard: Escape, focus a row with the arrows, Enter.
    await page.keyboard.press('Escape');
    await thumbOf(9).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    await expect(thumbOf(4)).toBeFocused();
    await page.keyboard.press('Enter');
    await expectOpenedAtTop(page, cards(page).nth(4));
    await expect(cards(page).nth(4).getByRole('button', { name: 'Close preview' })).toBeFocused();
});

test('STOP ends a hopeless search at once, keeps the page, and the next search works', async ({ page, isMobile }) => {
    await openFinder(page);
    await chooseHopeless(page);
    const url = page.url();
    await searchButton(page).click();
    await expect(results(page).getByRole('status')).toHaveText(/Searching… [\d,]+ seeds checked/);
    await expect(page.getByRole('progressbar', { name: 'Search progress' })).toBeVisible();

    const t0 = Date.now();
    await stopButton(page).click();
    await expect(results(page).getByRole('status')).toHaveText(/^Stopped after [\d,]+ seeds checked; 0 results kept\.$/, { timeout: 500 });
    console.log(`STOP -> stopped sentence: ${Date.now() - t0} ms`);
    await expect(stopButton(page)).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(new URL(page.url()).pathname).toBe('/finder/');

    // The pool is healthy: Village within 300 blocks finds its 10 seeds.
    if (isMobile) await page.getByRole('button', { name: 'Edit criteria' }).click();
    await form(page).getByRole('button', { name: 'Remove Mushroom Fields' }).click();
    await form(page).getByRole('button', { name: 'Remove Mansion' }).click();
    await choose(page, 'Structures', /Village/);
    await choose(page, 'Range', '300 blocks');
    await expect(form(page).getByText('Mushroom Fields', { exact: true })).toHaveCount(0);
    await expect(form(page).getByText('300 blocks', { exact: true })).toBeVisible();
    await searchButton(page).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(results(page).getByRole('status')).toHaveText(/^Found all 10/);
});

test('the layouts "?" opens its tip during a search, on screen, and the status line keeps its text', async ({ page }) => {
    await openFinder(page);
    await chooseHopeless(page);
    await searchButton(page).click();
    await expect(results(page).getByRole('status')).toHaveText(/Searching… [\d,]+ seeds checked · [\d,]+ seeds\/s/);
    // At 720 px the form reaches below the fold, so clicking Search scrolled the page. Bring
    // the "?" into view and let that scroll's event fire first: a tip closes on any scroll,
    // and click()'s own scroll-into-view could land right after it opened.
    const tip = page.getByRole('button', { name: 'About layouts', exact: true });
    await tip.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await tip.click();
    const bubble = page.getByRole('dialog', { name: 'About layouts' });
    await expect(bubble).toContainText('lower 48 bits');
    const box = await bubble.boundingBox();
    const { width, height } = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // Progress keeps streaming under the open tip, and it stays open.
    await page.waitForTimeout(600);
    await expect(bubble).toBeVisible();
    await expect(results(page).getByRole('status')).toHaveCount(1);
    await stopButton(page).click();
    await expect(bubble).toHaveCount(0);
});

test('one responsive ad in the results, at least 40 px under STOP while searching', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a phone shows the ad under the first row (next test)');
    await openFinder(page);
    await chooseHopeless(page);
    await searchButton(page).click();
    await expect(stopButton(page)).toBeVisible();

    const ads = results(page).locator('ins.adsbygoogle');
    await expect(ads).toHaveCount(1);
    await expect(ads).toHaveAttribute('data-ad-format', 'auto');
    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1);
    // Production build: the unconfigured in-feed slot renders nothing at all.
    await expect(page.locator('.ad--placeholder')).toHaveCount(0);
    const stop = await stopButton(page).boundingBox();
    const ad = await ads.boundingBox();
    expect(ad.y - (stop.y + stop.height)).toBeGreaterThanOrEqual(40);
    await stopButton(page).click();
    await expect(stopButton(page)).toHaveCount(0);
});

test('on a phone the first row shows without scrolling, and the ad sits under it', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The first row's seed and a good part of its picture are above the fold.
    const { height } = page.viewportSize();
    const first = await cards(page).first().boundingBox();
    expect(first.y + 160, `first row starts at ${first.y} px`).toBeLessThanOrEqual(height);
    // One compact title line, and the criteria inside the status box.
    const title = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(title.height).toBeLessThanOrEqual(30);
    await expect(page.locator('.finder__criteria')).toHaveCount(0);
    await expect(page.locator('.finder__status').getByRole('button', { name: 'Edit criteria' })).toBeVisible();
    // The one responsive ad (the in-feed units come after rows 5 and 10): between the
    // first and the second row, never above the rows.
    await expect(results(page).locator('ins.adsbygoogle[data-ad-format="auto"]')).toHaveCount(1);
    const ad = await results(page).locator('.finder__ad--results').boundingBox();
    const second = await cards(page).nth(1).boundingBox();
    expect(ad.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(ad.y + ad.height).toBeLessThanOrEqual(second.y);
});

test('on a phone the criteria collapse to a summary, and a row opens its map in place', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByText('Village · 100 blocks · 26.3 · Overworld', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit criteria' })).toBeVisible();

    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(page.getByLabel('Biome map')).toHaveCount(0);
    const card = cards(page).first();
    const seed = (await card.locator('code').first().textContent()).trim();
    await card.getByRole('button', { name: `Preview ${seed}` }).click();
    await expect(card.getByLabel('Biome map')).toBeVisible();
    await expectPreviewAt(page, seed, await firstStructure(card), 'Village');
    await card.getByRole('button', { name: 'Close preview' }).click();
    await expect(page.getByLabel('Biome map')).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit criteria' }).click();
    await expect(form(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

// ---- share / export -------------------------------------------------------------

const seedsOf = (page) => cards(page).evaluateAll((els) => els.map((el) => el.dataset.seed));
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
// The stats bar's done sentence (the seeds-mode banner is a status region too).
const doneSentence = (page, re) => results(page).getByRole('status').filter({ hasText: re });
// Phones keep the share / export row behind one "Share / export" button; desktop shows it.
async function openShare(page) {
    const toggle = page.getByRole('button', { name: 'Share / export', exact: true });
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

test('Avoid these biomes: Plains with no Ocean gets rows, and the share link carries exclude= and restores the form', async ({ page, isMobile }) => {
    await openFinder(page);
    await choose(page, 'Minecraft version', '1.17');
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
    await choose(page, 'Biomes', 'Plains');
    await form(page).getByRole('button', { name: 'More biome options' }).click();
    await choose(page, 'Avoid these biomes', 'Ocean');
    await choose(page, 'Range', '100 blocks');
    await expect(form(page).getByText('Ocean', { exact: true })).toBeVisible();
    await expect(form(page).getByText('Checked inside the whole range.')).toBeVisible();
    await expect(page).toHaveURL(/[?&]biomes=1&exclude=0(&|$)/);
    await searchButton(page).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible();
    const seeds = await seedsOf(page);

    await openShare(page);
    await page.getByRole('button', { name: 'Share these results' }).click();
    const shared = new URL(await clipboard(page));
    expect(shared.searchParams.get('biomes')).toBe('1');
    expect(shared.searchParams.get('exclude')).toBe('0');
    expect(shared.searchParams.get('seeds')).toBe(seeds.join(','));

    await page.goto(`/finder/${shared.search}`);
    await expect(cards(page)).toHaveCount(10, { timeout: 10_000 });
    const summary = 'Plains · no Ocean · 100 blocks · 1.17 · Overworld';
    if (isMobile) {
        await expect(page.getByText(summary, { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Edit criteria' }).click();
    }
    // The list holds a biome: its section is open by itself.
    await expect(form(page).getByRole('button', { name: 'More biome options' })).toHaveAttribute('aria-expanded', 'true');
    await expect(form(page).getByText('Plains', { exact: true })).toBeVisible();
    await expect(form(page).getByText('Ocean', { exact: true })).toBeVisible();
    await expect(form(page).getByText('100 blocks', { exact: true })).toBeVisible();
});

test('"Share these results" round-trips: the link renders its rows without searching, and "Find more" appends new seeds', async ({ page }) => {
    // A 19-digit start: every hit and the resume cursor are beyond Number's precision.
    const START = 8091867987493326313n;
    await openFinder(page);
    await choose(page, 'Minecraft version', '1.17');
    await expect(page.getByRole('button', { name: 'Village at spawn', exact: true })).toBeEnabled();
    await choose(page, 'Biomes', 'Plains');
    await choose(page, 'Range', '100 blocks');
    await form(page).getByRole('button', { name: 'Advanced' }).click();
    await form(page).getByLabel('Start seed').fill(String(START));
    await expect(form(page).getByText('Plains', { exact: true })).toBeVisible();
    await expect(form(page).getByText('100 blocks', { exact: true })).toBeVisible();
    await searchButton(page).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible();
    const seeds = await seedsOf(page);
    for (const seed of seeds) expect(BigInt(seed) >= START).toBe(true);

    await openShare(page);
    await page.getByRole('button', { name: 'Share these results' }).click();
    // Confirmed by the site-wide toast; the button keeps its label.
    await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share these results' })).toHaveText('Share link');
    const url = await clipboard(page);
    expect(url.startsWith('https://mcseeder.com/finder/?')).toBe(true);
    const shared = new URL(url);
    expect(shared.searchParams.get('seeds')).toBe(seeds.join(','));
    const sharedStart = BigInt(shared.searchParams.get('start'));
    expect(sharedStart > START).toBe(true);

    // Never the production host: the same query on the local server.
    const t0 = Date.now();
    await page.goto(`/finder/${shared.search}`);
    await expect(cards(page)).toHaveCount(10, { timeout: 10_000 });
    console.log(`10 shared rows rendered in ${Date.now() - t0} ms`);
    expect(await seedsOf(page)).toEqual(seeds);
    // No announcement box: the rows, the share row, and Find more at the end.
    await expect(page.getByText(/shared with you/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Find more' })).toBeEnabled();
    // Nothing runs by itself.
    await recordStatuses(page);
    await page.waitForTimeout(3_000);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByText(/seeds checked/i)).toHaveCount(0);
    await expect(stopButton(page)).toHaveCount(0);
    expect((await statusTexts(page)).some((t) => /seeds checked/.test(t))).toBe(false);

    await page.getByRole('button', { name: 'Find more' }).click();
    await expect.poll(async () => (await seedsOf(page)).filter((s) => !seeds.includes(s)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible({ timeout: 60_000 });
    expect((await statusTexts(page)).some((t) => /seeds checked/.test(t))).toBe(true);
    const all = await seedsOf(page);
    expect(all.slice(0, 10)).toEqual(seeds);
    expect(new Set(all).size).toBe(all.length);
    const fresh = all.filter((s) => !seeds.includes(s));

    await openShare(page);
    await page.getByRole('button', { name: 'Share these results' }).click();
    const again = new URL(await clipboard(page));
    expect(again.searchParams.get('seeds')).toBe(all.join(','));
    expect(again.searchParams.get('seeds').split(',')).toEqual(expect.arrayContaining(fresh));
    // The new cursor is the Find-more run's resumeSeed: past the shared one.
    expect(BigInt(again.searchParams.get('start')) > sharedStart).toBe(true);
    for (const seed of fresh) expect(BigInt(seed) >= sharedStart).toBe(true);
});

test('Village at spawn: seeds survive the link digit for digit; JSON, CSV and the PNG share card download', async ({ page }) => {
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible();
    const seeds = await seedsOf(page);

    await openShare(page);
    await page.getByRole('button', { name: 'Share these results' }).click();
    const link = new URL(await clipboard(page));
    expect(link.searchParams.get('seeds').split(',')).toEqual(seeds);
    expect(link.searchParams.get('structures')).toBe('5');

    const json = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const jsonFile = await json;
    expect(jsonFile.suggestedFilename()).toMatch(/^seeder-seeds-26\.3-\d{8}\.json$/);
    const data = JSON.parse(readFileSync(await jsonFile.path(), 'utf8'));
    expect(data.hits.map((h) => h.seed)).toEqual(seeds);
    for (const h of data.hits) {
        expect(typeof h.seed).toBe('string');
        expect(h.structures[0].type).toBe(5);
    }
    expect(data.start).toBe(link.searchParams.get('start'));

    const csv = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toMatch(/^seeder-seeds-26\.3-\d{8}\.csv$/);
    const lines = readFileSync(await csvFile.path(), 'utf8').split('\r\n');
    expect(lines[0]).toBe('seed,spawnX,spawnZ,structures,version,dimension,criteria');
    expect(lines.slice(1, 11).map((l) => l.split(',')[0])).toEqual(seeds);

    const card = cards(page).first();
    const shareImage = card.getByRole('button', { name: 'Share image' });
    await expect(shareImage).toBeEnabled({ timeout: 60_000 });
    const png = page.waitForEvent('download');
    await shareImage.click();
    const pngFile = await png;
    expect(pngFile.suggestedFilename()).toBe(`seed-${seeds[0]}.png`);
    const bytes = readFileSync(await pngFile.path());
    expect(bytes.length).toBeGreaterThan(10_000);
    // A PNG, 1200×630 (IHDR width and height, big-endian).
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);

    // "Find more" at the end of the list continues the run: 10 more rows, none repeated.
    const more = page.getByRole('button', { name: 'Find more' });
    await more.scrollIntoViewIfNeeded();
    await more.click();
    await expect(cards(page)).toHaveCount(20, { timeout: 60_000 });
    const all = await seedsOf(page);
    expect(all.slice(0, 10)).toEqual(seeds);
    expect(new Set(all).size).toBe(20);
    await expect(more).toBeEnabled({ timeout: 60_000 });
});

test('"Copy all seeds" puts the cards\' seeds on the clipboard, one per line', async ({ page }) => {
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible();
    const seeds = await seedsOf(page);
    for (const seed of seeds) expect(seed).toMatch(/^-?\d+$/);

    await openShare(page);
    await page.getByRole('button', { name: 'Copy all seeds' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
    expect(await clipboard(page)).toBe(seeds.join('\n'));
});

test('the Bastion + Fortress preset finds Nether seeds: every card link opens the Nether', async ({ page }) => {
    await openFinder(page);
    await page.getByRole('button', { name: 'Bastion + Fortress', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible();
    const hrefs = await cards(page).getByRole('link', { name: 'Open seed' }).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toHaveLength(10);
    for (const href of hrefs) {
        const url = new URL(href, page.url());
        expect(url.pathname, href).toBe('/seed/');
        expect(url.searchParams.get('seed'), href).toMatch(/^-?\d+$/);
        expect(url.searchParams.get('version'), href).toBe('26.3');
        expect(url.searchParams.get('dim'), href).toBe('-1');
    }
    expect(new Set(hrefs).size).toBe(10);
    expect(new URL(page.url()).searchParams.get('dim')).toBe('-1');
});

test('the share and export row sits in the stats box, compact', async ({ page }) => {
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(doneSentence(page, /^Found all 10/)).toBeVisible({ timeout: 60_000 });
    const box = page.locator('.finder__status');
    await expect(box).toHaveCount(1);
    await openShare(page);
    await expect(box.getByRole('toolbar', { name: 'Share and export' })).toBeVisible();
    await expect(box.getByText(/^Found all 10/)).toBeVisible();
    // One or two short lines of 26 px buttons, not a block of its own.
    const bar = await box.getByRole('toolbar', { name: 'Share and export' }).boundingBox();
    const button = await page.getByRole('button', { name: 'Download CSV' }).boundingBox();
    expect(button.height).toBeLessThanOrEqual(28);
    // Two lines at most: 2 × 26 px, the 4 px gap, and the hairline + 8 px above the row.
    expect(bar.height).toBeLessThanOrEqual(2 * 26 + 4 + 9 + 1);
});

test('the first ten rows draw their thumbnails without being scrolled to', async ({ page }) => {
    await openFinder(page);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    // No scrolling: the last row is far below the fold and is drawn all the same.
    await expect(cards(page).nth(9).locator('.seed-card__preview canvas')).toBeAttached({ timeout: 30_000 });
    await expect(page.locator('.seed-card__preview canvas')).toHaveCount(10);
    console.log(`10 thumbnails drawn ${Date.now() - t0} ms after the preset click`);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('an ad slot that stays empty (blocked here) shows the support box in its place', async ({ page }) => {
    await openFinder(page);
    await page.getByRole('button', { name: 'Village at spawn', exact: true }).click();
    await expect(cards(page)).toHaveCount(10, { timeout: 60_000 });
    const slot = page.locator('.finder .ad').first();
    await expect(slot.getByText(/If it helped you, you can support it/)).toBeVisible({ timeout: 10_000 });
    await expect(slot.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', 'https://buymeacoffee.com/mcseeder');
    await expect(slot.getByRole('button', { name: 'Donate with PayPal' })).toBeVisible();
    // No empty slot grows past the space it reserved: the note must not shift the rows
    // (it did on phones, by ~21 px, a few seconds after the rows were laid out).
    await expect(page.locator('.finder .ad--empty')).toHaveCount(await page.locator('.finder .ad').count(), { timeout: 10_000 });
    const sizes = await page.locator('.finder .ad').evaluateAll((els) => els.map((el) => ({
        height: el.getBoundingClientRect().height, reserved: parseFloat(el.style.minHeight),
    })));
    for (const { height, reserved } of sizes) expect(height, `slot reserved ${reserved} px`).toBeLessThanOrEqual(reserved + 1);
    // It stays inside the slot's reserved space: nothing spills over the rows.
    let box = await slot.boundingBox();
    const inner = await slot.locator('.support-box').boundingBox();
    expect(inner.y + inner.height).toBeLessThanOrEqual(box.y + box.height + 1);

    // What the real AdSense does with no ad to show (seen on localhost): it marks the <ins>
    // unfilled and pins it to the ad's height. The note must not sit under that blank.
    await slot.locator('ins').evaluate((ins) => {
        ins.setAttribute('style', 'display: block; height: 280px;');
        ins.setAttribute('data-ad-status', 'unfilled');
        ins.setAttribute('data-adsbygoogle-status', 'done');
    });
    box = await slot.boundingBox();
    const note = await slot.locator('.support-box').boundingBox();
    expect(note.y - box.y, 'the note starts at the top of the slot').toBeLessThanOrEqual(1);
    expect(box.height, 'no 280 px blank above or below it').toBeLessThan(280);
});
