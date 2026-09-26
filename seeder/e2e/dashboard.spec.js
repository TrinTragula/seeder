// The seed page's dashboard: the tab bar, the sections each tab mounts, the two ad units
// and My worlds. Runs on both projects: on the phone every case first opens the bottom
// sheet fully, since the panel lives inside it there.
import { test, expect, gotoSeed, settled, openSheet, sheetSnap, expectedBiome, biomeLabel, engine, pick } from './fixtures.js';

const SEED = '8091867987493326313';
const panel = (page) => page.locator('#dashboard');
const worldsSection = (page) => page.getByRole('region', { name: 'My worlds' });
const tabBar = (page) => page.getByRole('tablist', { name: 'Dashboard' });
// Open a tab of the dashboard and wait until its panel is the one shown.
async function openTab(page, name) {
    await tabBar(page).getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}

// Arrive on the seed page with its panel in view (the sheet fully open on a phone).
async function arrive(page, isMobile, url = `/seed/?seed=${SEED}&version=26.3`) {
    if (url) await page.goto(url);
    await settled(page, { seed: SEED });
    if (isMobile) await openSheet(page, 'full');
}

// The element's box lies inside the panel's scroll container's box (with 1 px of slack).
// `before` runs ahead of every check (e.g. a scroll that must be redone while content grows).
async function expectInsidePanel(page, locator, before = async () => {}) {
    await expect.poll(async () => {
        await before();
        const [box, container] = await Promise.all([locator.boundingBox(), panel(page).boundingBox()]);
        return box.y >= container.y - 1 && box.y < container.y + container.height && box.x >= container.x - 1
            && box.x + box.width <= container.x + container.width + 1;
    }, { message: 'scrolled into the panel' }).toBe(true);
}

// The compact footer ends the panel: nothing inside it (not even visually hidden text,
// like the stacked table's header row) may hang below it as blank scrollable space.
async function expectFooterLast(page) {
    const below = await panel(page).evaluate((root) => {
        const end = document.querySelector('.site-footer').getBoundingClientRect().bottom;
        return [...root.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().bottom > end + 1)
            .map((el) => `${el.tagName}.${el.className}`);
    });
    expect(below, 'nothing below the footer').toEqual([]);
}

// Scroll the panel (and only the panel: never the page's clipped <main>) until the
// section with this id sits just under the top, as a user scrolling it would.
async function scrollPanelTo(page, id) {
    await panel(page).evaluate((box, id) => {
        box.scrollTop += document.getElementById(id).getBoundingClientRect().top - box.getBoundingClientRect().top - 60;
    }, id);
}

// Open the More tab and bring My worlds into view: it sits under Farms, below the
// fold, and Farms grows as its answers land, so the scroll is redone until it holds.
async function openMyWorlds(page) {
    await openTab(page, 'More');
    await expectInsidePanel(page, worldsSection(page), () => scrollPanelTo(page, 'worlds'));
}

test('the tab strip shows five icon tabs in one row, opens on Map, and never scrolls away', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    await expect(tabBar(page)).toBeVisible();
    const tabs = tabBar(page).getByRole('tab');
    await expect(tabs).toHaveText(['Map', 'Structures', 'Biomes', 'Near me', 'More']);
    for (const [i, name] of ['Map', 'Spawn & structures', 'Biomes', 'Find near me', 'More'].entries()) {
        await expect(tabs.nth(i)).toHaveAccessibleName(name);
    }
    await expect(tabBar(page).getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Map' }).getByLabel('Minecraft version')).toBeVisible();
    // One full-width row, every icon loaded, nothing cut off or scrolled sideways.
    const boxes = await tabs.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        const label = el.querySelector('.dashboard-tab__label');
        const icon = el.querySelector('img');
        return { y: r.y, clipped: label.scrollWidth > label.clientWidth, icon: icon.complete && icon.naturalWidth > 0 };
    }));
    for (const b of boxes) {
        expect(Math.abs(b.y - boxes[0].y), 'one row').toBeLessThanOrEqual(1);
        expect(b.clipped, 'label fits').toBe(false);
        expect(b.icon, 'icon loaded').toBe(true);
    }
    const [stripWidth, scrollWidth] = await tabBar(page).evaluate((el) => [el.clientWidth, el.scrollWidth]);
    expect(scrollWidth, 'the strip does not scroll sideways').toBeLessThanOrEqual(stripWidth);
    // Scroll the Map tab to its end: the strip stays in sight (pinned on desktop, in the sheet's header on a phone).
    await panel(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await panel(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    if (isMobile) await expect(page.locator('.sheet__header').getByRole('tablist', { name: 'Dashboard' })).toBeInViewport();
    else await expectInsidePanel(page, tabBar(page));
    // Another tab starts at its top.
    await openTab(page, 'More');
    await expectInsidePanel(page, page.getByRole('region', { name: 'Farms' }));
    await openMyWorlds(page);
    await expect(worldsSection(page).getByText('No saved worlds yet. Save the seed you are playing to find it here.')).toBeVisible();
    // Only the panel scrolled: the page itself never moves (the header stays put).
    expect(await page.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('main').scrollTop])).toEqual([0, 0]);
    expect(page.url(), 'a tab does not change the URL').not.toContain('#');
});

test('on a phone the collapsed sheet shows the tab strip, and a tab opens the sheet halfway on it', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the bottom sheet exists on phones only');
    await gotoSeed(page, SEED, '26.3');
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'collapsed');
    const strip = page.locator('.sheet__header').getByRole('tablist', { name: 'Dashboard' });
    await expect(strip).toBeInViewport({ ratio: 1 });
    const vh = page.viewportSize().height;
    const box = await strip.boundingBox();
    expect(box.y + box.height, 'the whole strip is on screen').toBeLessThanOrEqual(vh);
    // The pan-down arrow still clears the taller collapsed sheet.
    const arrow = await page.getByRole('button', { name: 'Pan down' }).boundingBox();
    const sheetPanel = await page.getByRole('region', { name: 'World details' }).boundingBox();
    expect(arrow.y + arrow.height).toBeLessThanOrEqual(sheetPanel.y);
    await strip.getByRole('tab', { name: 'Biomes' }).click();
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'half');
    await expect(page.getByRole('tabpanel', { name: 'Biomes' })).toBeVisible();
    await expect(biomesSection(page)).toBeVisible();
});

test('hovering a tab that is not open keeps the strip\'s bottom line under it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'touch screens get no hover tint');
    await arrive(page, isMobile);
    const tab = tabBar(page).getByRole('tab', { name: 'Find near me' });
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    // The strip's 1 px bottom border, under this tab, as rendered: before and during the hover.
    const [strip, box] = await Promise.all([tabBar(page).boundingBox(), tab.boundingBox()]);
    const line = { x: Math.ceil(box.x) + 2, y: Math.round(strip.y + strip.height) - 1, width: Math.floor(box.width) - 4, height: 1 };
    const before = await page.screenshot({ clip: line });
    await tab.hover();
    // The hover tint is on (a tab at rest has no background).
    await expect(tab).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect((await page.screenshot({ clip: line })).equals(before), 'the line is still drawn under the hovered tab').toBe(true);
});

test('a tab mounts its sections only when it is opened, and keeps them while another tab is open', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    await expect(page.locator('#worlds')).toHaveCount(0);
    await expect(page.locator('#spawn')).toHaveCount(0);
    await openMyWorlds(page);
    await openTab(page, 'Map');
    await expect(page.locator('#worlds')).toHaveCount(1);
    await expect(page.locator('#worlds')).toBeHidden();
});

test('a world is saved, reopened after a reload, renamed and deleted', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    await openMyWorlds(page);
    await worldsSection(page).getByRole('button', { name: 'Save this world' }).click();
    const name = worldsSection(page).getByLabel('World name');
    await expect(name).toHaveValue(`Seed ${SEED}`);
    await name.fill('Mushroom base');
    await worldsSection(page).getByRole('button', { name: 'Save', exact: true }).click();
    // The controls (Map tab) learn about it at once: one store for the whole panel.
    await expect(panel(page).getByText('Saved ✓')).toHaveCount(1);
    await expect(worldsSection(page).getByRole('row')).toHaveCount(2);            // header + the world

    // Reload: the list comes back from localStorage, the world on screen is "Current".
    await page.reload();
    await arrive(page, isMobile, null);
    await expect(panel(page).getByText('Saved ✓')).toBeVisible();
    await openMyWorlds(page);
    // Found by its seed: while renaming, the name lives in an input's value, not in the text.
    const row = worldsSection(page).getByRole('row').filter({ hasText: SEED });
    await expect(row).toContainText('Mushroom base');
    await expect(row).toContainText('26.3');
    await expect(row).toContainText('Overworld');
    await expect(row.getByText('Current', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Open' })).toHaveCount(0);
    await expectFooterLast(page);

    // Rename, and it survives a reload.
    await row.getByRole('button', { name: 'Rename' }).click();
    await row.getByLabel('World name').fill('Spawn island');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(worldsSection(page).getByRole('row').filter({ hasText: 'Spawn island' })).toHaveCount(1);
    await page.reload();
    await arrive(page, isMobile, null);
    await openMyWorlds(page);
    const renamed = worldsSection(page).getByRole('row').filter({ hasText: 'Spawn island' });
    await expect(renamed).toHaveCount(1);

    // Delete takes a confirmation; the list is empty afterwards.
    await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(worldsSection(page).getByRole('row')).toHaveCount(2);
    await renamed.getByRole('button', { name: 'Delete for good' }).click();
    await expect(worldsSection(page).getByText(/No saved worlds yet/)).toBeVisible();
    await expect(panel(page).getByText('Saved ✓')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('seeder.worlds.v1')))).toEqual([]);
});

test('opening a saved world loads its canonical seed page', async ({ page, isMobile }) => {
    // Two worlds: the one to open, and the one on screen.
    await page.goto('/about/');
    await page.evaluate(() => localStorage.setItem('seeder.worlds.v1', JSON.stringify([{
        id: 'w1', name: 'Fortress', seed: '-77', version: '1.16.5', dimension: -1,
        createdAt: '2026-09-20T10:00:00.000Z', lastOpenedAt: '2026-09-20T10:00:00.000Z',
    }])));
    await arrive(page, isMobile);
    await openMyWorlds(page);
    const row = worldsSection(page).getByRole('row').filter({ hasText: 'Fortress' });
    await expect(row).toContainText('Nether');
    await row.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/seed\/\?seed=-77&version=1\.16\.5&dim=-1$/);
    await settled(page, { seed: '-77' });
    // Opening moved it to the front and stamped it.
    const [saved] = await page.evaluate(() => JSON.parse(localStorage.getItem('seeder.worlds.v1')));
    expect(saved.name).toBe('Fortress');
    expect(saved.lastOpenedAt > '2026-09-20T10:00:00.000Z').toBe(true);
});

test('from the half-open sheet a tab shows its panel, and only the sheet scrolls', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the bottom sheet exists on phones only');
    await gotoSeed(page, SEED, '26.3');
    await openSheet(page, 'half');
    // Let the snap animation end: a click on a tab still moving makes Playwright scroll it
    // "into view", which would scroll the page's clipped <main> (a finger tap never does).
    await page.locator('.sheet__panel').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await openTab(page, 'More');
    // A tab leaves the sheet where the user put it.
    await expect(page.locator('.sheet')).toHaveAttribute('data-snap', 'half');
    await expect(worldsSection(page).getByText(/No saved worlds yet/)).toBeVisible();
    // Nothing but the sheet's content scrolled: the header and the map stay where they were.
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('main').scrollTop])).toEqual([0, 0]);
    expect((await page.getByRole('banner').boundingBox()).y).toBe(0);
});

// Known test vectors for SEED on 26.3.
const SPAWN = [-32, 80];
const FIRST_RING = ['(-1356, 164)', '(644, -1484)', '(1108, 1524)'];
const spawnSection = (page) => page.getByRole('region', { name: 'Spawn' });
const strongholdsSection = (page) => page.getByRole('region', { name: 'Strongholds' });

test('Spawn and Strongholds show the engine\'s spawn, biome and first ring for the vector seed', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    await openTab(page, 'Spawn & structures');
    const spawn = spawnSection(page);
    await expect(spawn.getByText(`(${SPAWN[0]}, ${SPAWN[1]})`, { exact: true })).toBeVisible();
    // The biome of the map cell under the spawn, at the page's height, as the engine paints it.
    const label = await biomeLabel(page, await expectedBiome(page, SPAWN[0] >> 2, SPAWN[1] >> 2));
    await expect(spawn.locator('dd').filter({ hasText: label })).toHaveCount(1);
    await expect(spawn.getByText(/^≈ Y -?\d+$/)).toBeVisible();                   // 1.18+: a surface estimate

    await strongholdsSection(page).scrollIntoViewIfNeeded();
    const rows = strongholdsSection(page).getByRole('listitem');
    await expect(rows).toHaveCount(1);                                              // collapsed: the nearest one
    await strongholdsSection(page).getByRole('button', { name: 'Show 7 more' }).click();
    await expect(rows).toHaveCount(8);
    const coords = await rows.locator('code').allTextContents();
    for (const c of FIRST_RING) expect(coords).toContain(c);
    // The table fits the column (it stacks by the section's width): the panel never scrolls sideways.
    const [scrollWidth, clientWidth] = await panel(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth, 'the panel scrolls sideways').toBeLessThanOrEqual(clientWidth);
});

test('"Show on map" pans the map to the spawn and highlights it', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    await openTab(page, 'Spawn & structures');
    await spawnSection(page).getByRole('button', { name: 'Show on map' }).click();
    // At rest (the pan animates on the glide handle), with the spawn block in the canvas centre.
    await page.waitForFunction(([x, z]) => {
        const d = window.__seederDrawer;
        const h = d.highlight;
        return d.glideRaf == null
            && Math.abs(d.panX - (d.canvas.width / 2 - (x / 4) * d.pixDim)) <= 1
            && Math.abs(d.panZ - (d.canvas.height / 2 - (z / 4) * d.pixDim)) <= 1
            && h?.x === x && h?.z === z && h?.label === 'Spawn';
    }, SPAWN, { timeout: 10_000 });
    // On a phone the sheet gets out of the way of the map.
    if (isMobile) expect(await sheetSnap(page)).toBe('collapsed');
});

test('the panel holds at most two ad units, each requested once: under the controls and at the end of Spawn & structures', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    // On arrival only the Map tab exists: one unit, under the controls.
    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1);
    await expect(page.getByRole('tabpanel', { name: 'Map' }).locator('ins.adsbygoogle')).toHaveCount(1);
    for (const name of ['Spawn & structures', 'Biomes', 'Find near me', 'More', 'Spawn & structures', 'Map']) await openTab(page, name);
    await expect(page.locator('.ad--placeholder')).toHaveCount(0);
    await expect(panel(page).locator('ins.adsbygoogle')).toHaveCount(2);
    // Each unit was requested once (AdSense's loader is stubbed: the queue stays a plain array),
    // however often its tab is opened again.
    expect(await page.evaluate(() => window.adsbygoogle?.length)).toBe(2);
    // The second unit ends the Spawn & structures tab, after Structures.
    const after = await page.evaluate(() => document.querySelectorAll('.ad')[1].previousElementSibling?.id);
    expect(after).toBe('structures');
    // Never over the map, never in the sheet's header, never next to Locate.
    await expect(page.locator('.map-canvas .ad, .sheet__header .ad, #dashboard-panel-near .ad')).toHaveCount(0);
});

// Structures. The expected Village is the engine's own answer for the same
// question: nearest to the engine's spawn, within 4096 blocks.
const VILLAGE = 5;
const structuresSection = (page) => page.getByRole('region', { name: 'Structures' });
const villageRow = (page) => structuresSection(page).getByRole('listitem').filter({ has: page.getByText('Village', { exact: true }) });

// Unfold the list (the 5 nearest show at first), then open the Village row.
async function openVillage(page) {
    await expect(structuresSection(page).getByRole('list', { name: 'Nearest structures' })).toBeVisible();
    const more = structuresSection(page).getByRole('button', { name: /^Show \d+ more$/ });
    if (await more.count()) await more.click();
    await villageRow(page).getByRole('button', { expanded: false }).click();
}

async function engineVillage() {
    const seeder = await engine();
    const { spawnX, spawnZ } = seeder.seedSummary({ mcVersion: 35, seed: SEED, dimension: 0 });
    const [village] = seeder.nearestStructures({
        mcVersion: 35, seed: SEED, dimension: 0, x: spawnX, z: spawnZ, types: [VILLAGE], maxRadiusBlocks: 4096,
    }).results;
    expect(village.found).toBe(1);
    const { variant } = seeder.structureVariant({ mcVersion: 35, seed: SEED, dimension: 0, type: VILLAGE, x: village.x, z: village.z });
    return { ...village, variant };
}

test('Structures lists the Village the engine finds nearest to spawn, with its variant', async ({ page, isMobile }) => {
    const village = await engineVillage();
    await arrive(page, isMobile);
    await openTab(page, 'Spawn & structures');
    await openVillage(page);
    const row = villageRow(page);
    await expect(row).toHaveCount(1);
    await expect(row.getByText(`(${village.x}, ${village.z})`, { exact: true })).toBeVisible();
    // The variant lands in the row: the village type of the engine's biome (cubiomes' snowy_tundra is "Snowy Plains").
    const biome = await biomeLabel(page, village.variant.biome);
    await expect(row.getByText(`${biome === 'Snowy Plains' ? 'Snowy' : biome} village`, { exact: true })).toBeVisible();
    await expect(row.getByText('Zombie village', { exact: true })).toHaveCount(village.variant.abandoned);
    // Overworld only: nothing from the Nether or the End.
    for (const name of ['Fortress', 'Bastion', 'End City', 'End Gateway']) {
        await expect(structuresSection(page).getByText(name, { exact: true })).toHaveCount(0);
    }
    const [scrollWidth, clientWidth] = await panel(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth, 'the panel scrolls sideways').toBeLessThanOrEqual(clientWidth);
});

test('"Show all" on Village draws every village on the map, and "Hide all" takes them off', async ({ page, isMobile }) => {
    await arrive(page, isMobile);
    await openTab(page, 'Spawn & structures');
    await openVillage(page);
    await villageRow(page).getByRole('button', { name: 'Show all' }).click();
    await page.waitForFunction((type) => {
        const d = window.__seederDrawer;
        return d.structuresShown[type] === true && d.structures[type]?.length > 0;
    }, VILLAGE, { timeout: 10_000 });
    await villageRow(page).getByRole('button', { name: 'Hide all' }).click();
    await expect(villageRow(page).getByRole('button', { name: 'Show all' })).toBeVisible();
    await page.waitForFunction((type) => !window.__seederDrawer.structuresShown[type], VILLAGE);
});

// Biomes and the Biome locator. Expected values are the engine's own answers for
// the same questions: the 500×500-cell area around the known spawn, and biome_centers.
const biomesSection = (page) => page.getByRole('region', { name: 'Biomes', exact: true });
const locatorSection = (page) => page.getByRole('region', { name: 'Biome locator', exact: true });
// The renderer's biome id for a label (its lookup table is the one the UI's labels come from).
const biomeIdOf = (page, label) => page.evaluate((label) => {
    for (const [id, name] of window.__seederDrawer.biomeIdToLabel) if (name === label) return id;
    return null;
}, label);

test('Biomes shows the engine\'s most common biome around spawn, its share and one bar segment per row', async ({ page, isMobile }) => {
    const seeder = await engine();
    const { ids } = seeder.getArea(35, SEED, (SPAWN[0] >> 2) - 250, (SPAWN[1] >> 2) - 250, 500, 500, 0, 256);
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const [topId, topCount] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];

    await arrive(page, isMobile);
    await openTab(page, 'Biomes');
    const list = biomesSection(page).getByRole('list', { name: 'Biome breakdown' });
    await expect(list).toBeVisible({ timeout: 15_000 });
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(Math.min(10, counts.size));
    const first = await rows.first().textContent();
    expect(first).toContain(await biomeLabel(page, topId));
    const shown = Number(first.match(/(\d+(?:\.\d)?)%$/)[1]);
    expect(Math.abs(shown - (topCount / ids.length) * 100)).toBeLessThanOrEqual(0.1);
    const bar = biomesSection(page).getByRole('img', { name: /^Top biomes: / });
    await expect(bar.locator('span')).toHaveCount(await rows.count());
    await expect(biomesSection(page).getByText('Within 1000 blocks of spawn at Y 256.')).toBeVisible();
    const [scrollWidth, clientWidth] = await panel(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth, 'the panel scrolls sideways').toBeLessThanOrEqual(clientWidth);
});

test('the Biome locator finds the engine\'s Plains patches at 1k, shows one on the map, and says when there are none', async ({ page, isMobile }) => {
    const seeder = await engine();
    await arrive(page, isMobile);
    const plains = await biomeIdOf(page, 'Plains');
    const ask = (biomeId) => seeder.biomeCenters({
        mcVersion: 35, seed: SEED, dimension: 0, biomeId, x: SPAWN[0], z: SPAWN[1], radiusBlocks: 1000, yHeight: 256, minSizeCells: 4, nmax: 32,
    });
    const expected = ask(plains);
    expect(expected.error ?? null).toBeNull();
    expect(expected.centers.length).toBeGreaterThan(0);
    const distance = ({ x, z }) => Math.round(Math.hypot(x - SPAWN[0], z - SPAWN[1]));
    const nearest = Math.min(...expected.centers.map(distance));

    await openTab(page, 'Biomes');
    const section = locatorSection(page);
    await expect(section.getByRole('button', { name: 'Find' })).toBeDisabled();
    await pick(page, 'Biome to locate', 'Plains');
    await section.getByRole('button', { name: 'Find' }).click();
    const rows = section.getByRole('list', { name: 'Biome patches' }).getByRole('listitem');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(rows).toHaveCount(Math.min(8, expected.centers.length));
    const [, x, z] = (await rows.first().locator('code').textContent()).match(/^\((-?\d+), (-?\d+)\)$/).map(Number);
    expect(expected.centers.map((c) => `${c.x},${c.z}`)).toContain(`${x},${z}`);
    expect(distance({ x, z })).toBe(nearest);

    await rows.first().getByRole('button', { expanded: false }).click();
    await rows.first().getByRole('button', { name: 'Show on map' }).click();
    await page.waitForFunction(([x, z]) => {
        const d = window.__seederDrawer;
        const h = d.highlight;
        return d.glideRaf == null
            && Math.abs(d.panX - (d.canvas.width / 2 - (x / 4) * d.pixDim)) <= 1
            && Math.abs(d.panZ - (d.canvas.height / 2 - (z / 4) * d.pixDim)) <= 1
            && h?.x === x && h?.z === z && h?.label === 'Plains';
    }, [x, z], { timeout: 10_000 });
    if (isMobile) {
        expect(await sheetSnap(page)).toBe('collapsed');
        await openSheet(page, 'full');
    }

    // A biome of this version's Overworld that the engine finds no patch of within 1k.
    let missing = null;
    for (const label of ['Mushroom Fields', 'Ice Spikes', 'Badlands', 'Bamboo Jungle', 'Cherry Grove', 'Mangrove Swamp', 'Jungle']) {
        const id = await biomeIdOf(page, label);
        const answer = ask(id);
        if (!answer.error && answer.centers.length === 0) { missing = label; break; }
    }
    expect(missing, 'a biome with no patch within 1k').not.toBeNull();
    await pick(page, 'Biome to locate', missing);
    await expect(section.getByRole('list', { name: 'Biome patches' })).toHaveCount(0);
    await section.getByRole('button', { name: 'Find' }).click();
    await expect(section.getByText(`No ${missing} within 1k blocks of spawn.`)).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText('Try 2k.')).toBeVisible();
});

// Find near me. Expected values are the engine's
// answers for the same point.
const whereSection = (page) => page.getByRole('region', { name: 'Find near me' });

test('Find near me at (0, 0): the engine\'s biome, the Nether line, the nearest stronghold, and "Centre map here"', async ({ page, isMobile }) => {
    const seeder = await engine();
    const { strongholds } = seeder.strongholdsList({ mcVersion: 35, seed: SEED, howMany: 128, approx: true });
    const [nearest] = strongholds
        .map((s) => ({ ...s, distance: Math.round(Math.hypot(s.x, s.z)) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index);

    await arrive(page, isMobile);
    await openTab(page, 'Find near me');
    const section = whereSection(page);
    await section.getByLabel('X coordinate').fill('0');
    await section.getByLabel('Z coordinate').fill('0');
    await section.getByRole('button', { name: 'Locate' }).click();

    // The biome of the map cell at (0, 0), at the page's height, as the engine paints it.
    const label = await biomeLabel(page, await expectedBiome(page, 0, 0));
    await expect(section.locator('dd').filter({ hasText: `${label} at Y 256` })).toHaveCount(1);
    await expect(section.getByText('In the Nether', { exact: true }).locator('xpath=following-sibling::dd[1]')).toContainText('(0, 0)');
    const stronghold = section.getByRole('list', { name: 'Nearest stronghold' });
    await expect(stronghold).toContainText(`≈ (${nearest.x}, ${nearest.z})`);
    await expect(stronghold).toContainText(`Ring ${nearest.ring + 1}`);
    await expect(section.getByRole('list', { name: 'Nearest slime chunks' }).getByRole('listitem')).toHaveCount(10);
    const [scrollWidth, clientWidth] = await panel(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth, 'the panel scrolls sideways').toBeLessThanOrEqual(clientWidth);

    await section.getByRole('button', { name: 'Centre map here' }).click();
    await page.waitForFunction(() => {
        const d = window.__seederDrawer;
        return d.glideRaf == null && Math.abs(d.panX - d.canvas.width / 2) <= 1 && Math.abs(d.panZ - d.canvas.height / 2) <= 1
            && d.highlight?.label === 'You' && d.highlight.x === 0 && d.highlight.z === 0;
    }, undefined, { timeout: 10_000 });
    // On a phone the sheet gets out of the way of the map.
    if (isMobile) expect(await sheetSnap(page)).toBe('collapsed');
});

// Farms. Expected values are the engine's answers for the same questions:
// QUAD_HUTS (16 regions around the origin), and the Nether fortresses within ±4 regions.
const farmsSection = (page) => page.getByRole('region', { name: 'Farms' });
const kBlocks = (blocks) => `${Math.round(blocks / 1000)}k`;
// A seed with a quad witch farm about the origin on 26.3 (test/engine/dashboard.test.js).
const QUAD_SEED = '122723573472276867';

test('Farms says whether the vector seed has a quad witch farm, like the engine: no, with the reach', async ({ page, isMobile }) => {
    const seeder = await engine();
    const { farms } = seeder.quadHuts({ mcVersion: 35, seed: SEED });
    expect(farms, 'the vector seed has no quad witch farm').toEqual([]);
    const { regionBlocks } = seeder.getVersionSupport(35, [], [3]);

    await arrive(page, isMobile);
    await openTab(page, 'More');
    const section = farmsSection(page);
    await expect(section.getByText(`No quad witch farm within ${kBlocks(16 * regionBlocks[3])} blocks of the origin.`)).toBeVisible();
    await expect(section.getByText('Quad witch huts are extremely rare: about one region in 100 million.')).toBeVisible();
    // No picker, no radius, no list: the answer only.
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await expect(section.getByRole('group', { name: 'Radius' })).toHaveCount(0);
    const [scrollWidth, clientWidth] = await panel(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth, 'the panel scrolls sideways').toBeLessThanOrEqual(clientWidth);
});

test('Farms says yes for a quad witch hut seed, with the engine\'s farm, and shows it on the map', async ({ page, isMobile }) => {
    const seeder = await engine();
    const { farms } = seeder.quadHuts({ mcVersion: 35, seed: QUAD_SEED });
    expect(farms).toHaveLength(1);
    const [{ x, z }] = farms;
    const { spawnX, spawnZ } = seeder.seedSummary({ mcVersion: 35, seed: QUAD_SEED, dimension: 0 });
    const distance = Math.round(Math.hypot(x - spawnX, z - spawnZ));

    await page.goto(`/seed/?seed=${QUAD_SEED}&version=26.3`);
    await settled(page, { seed: QUAD_SEED });
    if (isMobile) await openSheet(page, 'full');
    await openTab(page, 'More');
    const section = farmsSection(page);
    const answer = section.getByText(/quad witch farm at/);
    await expect(answer).toHaveText(`Yes: a quad witch farm at (${x}, ${z}), ${distance < 1000 ? `${distance} blocks` : `${(distance / 1000).toFixed(1)}k blocks`} from spawn.`);
    await section.getByRole('button', { name: 'Show on map' }).click();
    await page.waitForFunction(([hx, hz]) => {
        const d = window.__seederDrawer;
        return d.highlight?.label === 'Quad witch farm' && d.highlight.x === hx && d.highlight.z === hz;
    }, [x, z], { timeout: 10_000 });
    if (isMobile) expect(await sheetSnap(page)).toBe('collapsed');
});

test('"Switch to the Nether" lists the engine\'s nearest fortress with its blaze spawners, and a spawner shows on the map', async ({ page, isMobile }) => {
    const seeder = await engine();
    const coords = seeder.getStructuresInRegions(35, 18, SEED, 4, -1).map((pair) => Array.from(pair));
    const [nearest] = coords
        .map(([x, z]) => ({ x, z, distance: Math.hypot(x, z) }))
        .sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
    const { spawners } = seeder.fortressSpawners({ mcVersion: 35, seed: SEED, chunkX: nearest.x >> 4, chunkZ: nearest.z >> 4 });
    expect(spawners.length, 'the nearest fortress has a blaze spawner').toBeGreaterThan(0);

    await arrive(page, isMobile);
    await openTab(page, 'More');
    await farmsSection(page).getByRole('button', { name: 'Switch to the Nether' }).click();
    await expect(page).toHaveURL(/[?&]dim=-1(&|$)/);
    await settled(page, { dimension: -1 });
    const section = farmsSection(page);
    await expect(section.getByText('Witch huts are in the Overworld.')).toBeVisible();
    const rows = section.getByRole('list', { name: 'Nearest fortresses' }).getByRole('listitem');
    await expect(rows).toHaveCount(Math.min(3, coords.length));
    const first = rows.first();
    await expect(first.locator('code').first()).toHaveText(`(${nearest.x}, ${nearest.z})`);
    await expect(first).toContainText(`${spawners.length} blaze spawner${spawners.length === 1 ? '' : 's'}`);
    await first.getByRole('button', { expanded: false }).click();
    const lines = first.getByRole('list', { name: 'Blaze spawners' }).getByRole('listitem');
    await expect(lines).toHaveCount(spawners.length);
    const [spawner] = spawners;
    await expect(lines.first().locator('code')).toHaveText(`(${spawner.x}, ${spawner.y}, ${spawner.z})`);
    await lines.first().getByRole('button', { name: 'Show on map' }).click();
    await page.waitForFunction(([x, z]) => {
        const d = window.__seederDrawer;
        const h = d.highlight;
        return d.glideRaf == null
            && Math.abs(d.panX - (d.canvas.width / 2 - (x / 4) * d.pixDim)) <= 1
            && Math.abs(d.panZ - (d.canvas.height / 2 - (z / 4) * d.pixDim)) <= 1
            && h?.x === x && h?.z === z && h?.label === 'Blaze spawner';
    }, [spawner.x, spawner.z], { timeout: 10_000 });
    // On a phone the sheet gets out of the way of the map.
    if (isMobile) expect(await sheetSnap(page)).toBe('collapsed');
});
