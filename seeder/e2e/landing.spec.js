// The multi-page skeleton and the landing: the landing is its own
// document and starts no worker, legacy /?seed= links are redirected to /seed/ before
// anything renders, /seed is normalised to /seed/, and /about/ is a real page.
import fs from 'node:fs';
import { test, expect, firstPaint, settled, expectCanvasUndistorted } from './fixtures.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pathOf = (url) => url.replace(/^https?:\/\/[^/]+/, '');

const heroSeed = (page) => page.getByRole('form', { name: 'Open a seed' }).getByLabel('Seed', { exact: true });

test('the landing shows the hero, two cards and one ad, and starts no worker', async ({ page }) => {
    // Nothing on the landing may ask for the engine, not even in the background.
    const engineRequests = [];
    page.on('request', (request) => {
        if (/\/workers\/|\.wasm/.test(request.url())) engineRequests.push(pathOf(request.url()));
    });
    await page.goto('/');
    await expect(page).toHaveTitle('Seeder - Minecraft seed finder and analyzer');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seeder - Minecraft seed map, finder & explorer');
    await expect(page.getByRole('form', { name: 'Open a seed' })).toHaveAttribute('action', '/seed/');
    await expect(heroSeed(page)).toHaveAttribute('name', 'seed');
    const cards = page.getByRole('list', { name: 'Sections' });
    await expect(cards.getByRole('link', { name: 'Open the map' })).toHaveAttribute('href', '/seed/');
    await expect(cards.getByRole('link', { name: 'Find your seed' })).toHaveAttribute('href', '/finder/');
    await expect(cards.getByRole('link')).toHaveCount(2);
    // A first visit remembers nothing: no "Continue where you left off".
    await expect(page.getByRole('region', { name: 'Open the last seed you looked up:' })).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Seed', exact: true })).toHaveAttribute('href', '/seed/');
    // Minecraft's usage guidelines: the non-affiliation line on every page, via the shared footer.
    await expect(page.getByRole('contentinfo'))
        .toContainText('Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.');
    // One ad unit, laid out below the cards (never between them and the hero).
    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1);
    const cardsBottom = await cards.evaluate((el) => el.getBoundingClientRect().bottom);
    const adTop = await page.locator('ins.adsbygoogle').evaluate((el) => el.getBoundingClientRect().top);
    expect(adTop).toBeGreaterThan(cardsBottom);
    // Every card image arrived at its real size (a missing file has naturalWidth 0).
    const images = cards.getByRole('img');
    await expect(images).toHaveCount(2);
    await expect.poll(() => images.evaluateAll((els) => els.map((img) => (img.complete ? img.naturalWidth : 0))))
        .toEqual([960, 960]);
    await page.waitForLoadState('networkidle');
    expect(engineRequests).toEqual([]);
    expect(await page.evaluate(() => typeof window.__seederDrawer)).toBe('undefined');
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('visible');
});

test('the random seed is the hero\'s biggest button and opens a random world', async ({ page }) => {
    await page.goto('/');
    const random = page.getByRole('link', { name: 'Open a random seed' });
    const openMap = page.getByRole('button', { name: 'Open map' });
    const [r, o, form] = [await random.boundingBox(), await openMap.boundingBox(), await page.getByRole('form', { name: 'Open a seed' }).boundingBox()];
    expect(r.height).toBeGreaterThan(o.height);
    expect(r.width).toBeGreaterThanOrEqual(form.width - 1);   // as wide as the form
    expect(r.y + r.height).toBeLessThanOrEqual(form.y);       // above it
    await expect(random).toBeInViewport({ ratio: 1 });        // no scrolling needed
    await random.click();
    await expect(page).toHaveURL(/\/seed\/\?seed=-?\d+&version=26\.3$/);
});

test('a click anywhere on a card opens its section; saved worlds open from the section under the cards', async ({ page }) => {
    await page.goto('/');
    const cards = page.getByRole('list', { name: 'Sections' });
    // The picture, the title and the text are all the card's link (the link covers
    // them, so click where they are, as a visitor would).
    const clickOn = async (locator) => {
        await locator.scrollIntoViewIfNeeded();
        const b = await locator.boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    await clickOn(cards.getByRole('img').nth(1));
    await expect(page).toHaveURL(/\/finder\/$/);
    await page.goBack();
    await clickOn(cards.getByRole('heading', { name: 'Seed map' }));
    await expect(page).toHaveURL(/\/seed\//);
    await settled(page);
    // A saved world is listed under the cards and opens that world.
    await page.evaluate(() => localStorage.setItem('seeder.worlds.v1', JSON.stringify([
        { id: 'w1', name: 'My base', seed: '7', version: '1.20', dimension: 0, createdAt: '2026-09-26T00:00:00.000Z', lastOpenedAt: '2026-09-26T00:00:00.000Z' },
    ])));
    await page.goto('/');
    await page.getByRole('region', { name: 'Open the last seed you looked up:' }).getByRole('link', { name: 'My base' }).click();
    await expect(page).toHaveURL(/\/seed\/\?seed=7&version=1\.20/);
});

test('a text seed typed in the hero opens its canonical seed page', async ({ page }) => {
    await page.goto('/');
    await heroSeed(page).fill('hello');
    await heroSeed(page).press('Enter');
    // Plain HTML did the navigation; the seed page hashed the text the way Minecraft
    // does (String.hashCode) and published its canonical URL.
    await settled(page, { seed: '99162322' });
    await expect(page).toHaveURL(/\/seed\/\?seed=99162322&version=26\.3$/);
});

test('the section under the cards continues with the last seed', async ({ page }) => {
    await page.goto('/seed/?seed=42&version=1.17');
    await settled(page, { seed: '42' });
    await page.goto('/');
    const link = page.getByRole('region', { name: 'Open the last seed you looked up:' }).getByRole('link', { name: 'Open Seed 42' });
    await expect(link).toHaveAttribute('href', '/seed/?seed=42&version=1.17');
    await link.click();
    await settled(page, { seed: '42' });
    await expect(page).toHaveURL(/\/seed\/\?seed=42&version=1\.17$/);
});

test('a /?seed=hello visit prefills the hero', async ({ page }) => {
    await page.goto('/?seed=hello');
    await expect(heroSeed(page)).toHaveValue('hello');
});

test.describe('at 360 px', () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test('no horizontal scroll at 360 px, even with a 19-digit last seed and long world names', async ({ page }) => {
        // The longest things the "Continue where you left off" section can print: a signed 19-digit seed and
        // three 40-character world names (the maximum My worlds keeps).
        await page.addInitScript(() => {
            const at = '2026-09-24T10:00:00.000Z';
            const world = (i) => ({ id: `w${i}`, name: `Worldwithaverylongnamethatdoesnotbreak${i}`.slice(0, 40), seed: `${i}8091867987493326313`.slice(0, 19), version: '26.3', dimension: 0, createdAt: at, lastOpenedAt: at });
            localStorage.setItem('seeder.lastSeed', JSON.stringify({ seed: '-8091867987493326313', version: '26.3', dimension: 0 }));
            localStorage.setItem('seeder.worlds.v1', JSON.stringify([world(1), world(2), world(3)]));
        });
        await page.goto('/');
        await expect(page.getByRole('link', { name: 'Open Seed -8091867987493326313' })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Worlds you saved in this browser:' }).getByRole('link')).toHaveCount(3);
        await expect.poll(() => page.getByRole('list', { name: 'Sections' }).getByRole('img')
            .evaluateAll((els) => els.every((img) => img.complete && img.naturalWidth > 0))).toBe(true);
        const overflow = await page.evaluate(() => {
            const width = document.documentElement.clientWidth;
            return {
                scroll: document.documentElement.scrollWidth - width,
                outside: [...document.body.querySelectorAll('*')]
                    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > width + 0.5; })
                    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
            };
        });
        expect(overflow.scroll, 'horizontal scroll').toBe(0);
        expect(overflow.outside, 'elements past the right edge').toEqual([]);
    });
});

test('a legacy /?seed=&version= link lands on /seed/ with the version label, without showing the landing', async ({ page }) => {
    // Same-origin sessionStorage survives the redirect, so the landing document can
    // leave evidence of what happened to it before it was replaced.
    await page.addInitScript(() => {
        if (location.pathname !== '/') return;
        // The document is still empty when an init script runs: watch it grow instead of reading it.
        // The landing is prerendered, so its markup arrives with the HTML: what matters is that
        // it is already hidden when it does, and that React never takes it over.
        new MutationObserver(() => {
            const hidden = document.documentElement?.classList.contains('redirecting');
            if (hidden) sessionStorage.setItem('landingHidden', 'true');
            if (document.getElementById('root')?.childElementCount && !hidden) sessionStorage.setItem('landingShown', 'yes');
            if (document.querySelector('script[src*="adsbygoogle"]')) sessionStorage.setItem('landingMounted', 'ads');
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        addEventListener('pagehide', () => {
            const root = document.getElementById('root');
            if (root && Object.keys(root).some((key) => key.startsWith('__reactContainer'))) sessionStorage.setItem('landingMounted', 'react');
        });
    });
    const visited = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(pathOf(frame.url())); });

    await page.goto('/?seed=42&version=17');
    await firstPaint(page);

    // The landing entry replaced itself with the canonical seed URL (label, not index)…
    expect(visited).toContain('/seed/?seed=42&version=1.17&from=legacy');
    expect(visited.filter((url) => !url.startsWith('/seed/'))).toEqual(['/?seed=42&version=17']);
    // …and the seed page owns the URL from there: its first replaceState drops the
    // transient flag, and the what's-new card is the proof that the flag was seen.
    await expect(page).toHaveURL(/\/seed\/\?seed=42&version=1\.17$/);
    expect(page.url()).not.toContain('from=');
    await expect(page.getByRole('heading', { name: 'Seeder has new sections' })).toBeVisible();
    await expect(page.getByLabel('Seed')).toHaveValue('42');
    await expect(page.getByText('1.17', { exact: true })).toBeVisible();
    // Nothing of the landing was ever visible.
    expect(await page.evaluate(() => sessionStorage.getItem('landingHidden'))).toBe('true');
    expect(await page.evaluate(() => sessionStorage.getItem('landingShown'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('landingMounted'))).toBeNull();
});

test('a legacy link keeps the Nether or End dimension', async ({ page }) => {
    const visited = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(pathOf(frame.url())); });
    await page.goto('/?seed=-7&version=1.18&dim=-1');
    await firstPaint(page);
    expect(visited).toContain('/seed/?seed=-7&version=1.18&dim=-1&from=legacy');
});

test('a /?seed= link with a text seed is not a legacy link: the landing stays and is visible', async ({ page }) => {
    await page.goto('/?seed=hello');
    await expect(page).toHaveURL(/\/\?seed=hello$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility)).toBe('visible');
    expect(await page.evaluate(() => document.documentElement.classList.contains('redirecting'))).toBe(false);
});

test('/seed without a trailing slash is a 308 to /seed/ that keeps the query', async ({ page }) => {
    const bare = await page.request.get('/seed', { maxRedirects: 0 });
    expect(bare.status()).toBe(308);
    expect(bare.headers().location).toBe('/seed/');
    const withQuery = await page.request.get('/finder?version=1.18', { maxRedirects: 0 });
    expect(withQuery.status()).toBe(308);
    expect(withQuery.headers().location).toBe('/finder/?version=1.18');
    const about = await page.request.get('/about', { maxRedirects: 0 });
    expect(about.status()).toBe(308);
    expect(about.headers().location).toBe('/about/');
});

test('/about/ is its own document and shows the release version', async ({ page }) => {
    await page.goto('/about/');
    await expect(page).toHaveTitle('About - Seeder');
    await expect(page.getByRole('heading', { name: 'Seeder', level: 1 })).toBeVisible();
    await expect(page.getByText(`(${pkg.version})`)).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
});

test('/finder/ is its own document with the finder', async ({ page }) => {
    await page.goto('/finder/');
    await expect(page).toHaveTitle('Minecraft seed finder - Seeder');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minecraft seed finder');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Finder' })).toHaveAttribute('aria-current', 'page');
});

test('the seed page canvas is drawn at its displayed size (no squashed map inside the app layout)', async ({ page }) => {
    // Regression guard for the map measuring its container before Layout constrained it.
    // `settled` checks the same thing for every map test; this one is the explicit, named case
    // and also covers the first paint, before any tile has settled.
    await page.goto('/seed/?seed=8091867987493326313&version=26.3');
    await firstPaint(page);
    await expectCanvasUndistorted(page);
    await settled(page, { seed: '8091867987493326313' });
    await expectCanvasUndistorted(page);

    // The box never takes its size from the canvas: in flow, Safari let a taller bitmap
    // grow the box, the ResizeObserver grew the bitmap again, and the map never painted.
    const grown = await page.evaluate(() => {
        const canvas = document.querySelector('.map-canvas canvas');
        const box = canvas.parentElement;
        const before = [box.clientWidth, box.clientHeight];
        const bitmap = [canvas.width, canvas.height];
        canvas.height = bitmap[1] + 500;
        canvas.width = bitmap[0] + 300;
        const after = [box.clientWidth, box.clientHeight];
        [canvas.width, canvas.height] = bitmap;
        return { before, after, position: getComputedStyle(canvas).position };
    });
    expect(grown.position).toBe('absolute');
    expect(grown.after, 'a bigger bitmap must not resize the map box').toEqual(grown.before);
    // The map ends at the bottom of the screen and the document never scrolls, however long
    // the side column is (Safari once sized the page by the column: the map ran off-screen).
    const fit = await page.evaluate(() => ({
        mapBottom: Math.round(document.querySelector('.map-canvas').getBoundingClientRect().bottom),
        viewport: window.innerHeight,
        scroll: document.scrollingElement.scrollHeight,
    }));
    expect(Math.abs(fit.mapBottom - fit.viewport)).toBeLessThanOrEqual(1);
    expect(fit.scroll).toBeLessThanOrEqual(fit.viewport);
    // The real AdSense writes `height: auto !important` on every ancestor of an ad unit
    // (stubbed here, so do it by hand): the layout must not care.
    const afterAds = await page.evaluate(() => {
        const ad = document.querySelector('.ad');
        for (let el = ad?.parentElement; el && el !== document.body; el = el.parentElement) {
            el.style.setProperty('height', 'auto', 'important');
        }
        return {
            touched: !!ad,
            mapBottom: Math.round(document.querySelector('.map-canvas').getBoundingClientRect().bottom),
            viewport: window.innerHeight,
            scroll: document.scrollingElement.scrollHeight,
        };
    });
    expect(afterAds.touched, 'the seed page has an ad unit to walk up from').toBe(true);
    expect(Math.abs(afterAds.mapBottom - afterAds.viewport)).toBeLessThanOrEqual(1);
    expect(afterAds.scroll).toBeLessThanOrEqual(afterAds.viewport);
});
