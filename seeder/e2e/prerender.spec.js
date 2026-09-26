// The prerender: the text of every page is in its HTML, so crawlers and visitors
// without JavaScript get it, and the browser takes it over without a hydration error
// even when Auto ads has already put a unit inside the page.
import { test as plainTest } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { CARDS, FAQ, HERO_LEAD, HERO_TITLE } from '../src/pages/landing/content.js';

const card = (id) => CARDS.find((entry) => entry.id === id);
// renderToString escapes text; the raw HTML is compared against the same escaping.
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;');
// Vite moves the page's module script into the <head>, so #root runs to the end of the body.
const rootOf = (html) => html.match(/<div id="root">([\s\S]*)<\/div>\s*<\/body>/)?.[1] ?? '';
const nav = (page) => page.getByRole('navigation', { name: 'Primary' });

const PAGES = [
    { path: '/', texts: [HERO_TITLE, HERO_LEAD, ...FAQ.map((entry) => entry.question)] },
    { path: '/about/', texts: ['Who', 'What it does', 'Limitations', 'Privacy and ads'] },
    { path: '/seed/', texts: [card('map').title, card('map').text] },
    { path: '/finder/', texts: [card('finder').title, card('finder').text] },
];

test.describe('raw HTML, as a crawler that runs no JavaScript gets it', () => {
    for (const { path, texts } of PAGES) {
        test(`${path} carries its text and no ads loader`, async ({ request }) => {
            const response = await request.get(path);
            expect(response.status()).toBe(200);
            const html = await response.text();
            const root = rootOf(html);
            expect(root.length, 'prerendered #root').toBeGreaterThan(500);
            expect(root).toMatch(/<header class="site-header">/);
            for (const text of texts) expect(root, text).toContain(escape(text));
            expect(html).not.toMatch(/adsbygoogle\.js/);
        });
    }
});

// Playwright turns scripts off without telling the parser, so <noscript> content stays
// unrendered here; its text is checked on the HTML entries (test/engine/html.test.js).
test.describe('with JavaScript turned off', () => {
    test.use({ javaScriptEnabled: false });

    test('the landing reads in full: hero, cards, FAQ', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toContainText(HERO_TITLE);
        await expect(page.getByRole('link', { name: 'Open a random seed' })).toHaveAttribute('href', '/seed/');
        for (const { title } of CARDS) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'FAQ' })).toBeVisible();
        for (const { question } of FAQ) await expect(page.getByText(question, { exact: true })).toBeAttached();
    });

    test('the seed form still works: it is a plain GET form', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('form', { name: 'Open a seed' }).getByLabel('Seed', { exact: true }).fill('hello');
        await page.getByRole('button', { name: 'Open map' }).click();
        await expect(page).toHaveURL(/\/seed\/\?seed=hello$/);
    });

    test('About reads in full', async ({ page }) => {
        await page.goto('/about/');
        await expect(page.getByRole('heading', { level: 1, name: 'Seeder' })).toBeVisible();
        for (const name of ['Who', 'What is it', 'Limitations', 'Credits']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        await expect(nav(page).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
    });

    test('the seed page and the finder show their intro', async ({ page }) => {
        for (const [path, id, current] of [['/seed/', 'map', 'Seed'], ['/finder/', 'finder', 'Finder']]) {
            await page.goto(path);
            // No inline script ran, so nothing waits: the page is there from the first paint.
            expect(await page.locator('.static-intro').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
            expect(await page.locator('.site-footer').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(card(id).title);
            await expect(page.getByText(card(id).text)).toBeVisible();
            await expect(nav(page).getByRole('link', { name: current, exact: true })).toHaveAttribute('aria-current', 'page');
        }
    });
});

// What script blockers do (uBlock Origin's "no scripting", NoScript): the browser keeps
// scripting on but a CSP forbids every script, inline ones included. Unlike Playwright's
// javaScriptEnabled: false, this also shows <noscript>. Plain Playwright: the shared fixture
// fails on any console error, and every blocked script logs one here by design.
plainTest.describe('with scripts blocked by a CSP, as uBlock Origin does', () => {
    plainTest.beforeEach(async ({ page }) => {
        await page.route(/localhost/, async (route) => {
            if (route.request().resourceType() !== 'document') return route.continue();
            const response = await route.fetch();
            await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "script-src 'none'" } });
        });
    });

    for (const { path, texts } of PAGES) {
        plainTest(`${path} shows its prerendered page at once`, async ({ page }) => {
            const errors = [];
            page.on('console', (m) => { if (m.type() === 'error' && !/Content Security Policy/i.test(m.text())) errors.push(m.text()); });
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(path);
            expect(await page.evaluate(() => document.documentElement.classList.contains('js'))).toBe(false);
            expect(await page.locator('#root').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
            await expect(page.getByText(texts[0], { exact: true }).first()).toBeVisible();
            const intro = page.locator('.static-intro');
            if (await intro.count()) expect(await intro.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
            expect(errors).toEqual([]);
        });
    }
});

test.describe('Auto ads inserting a unit inside the page', () => {
    // What adsbygoogle.js does with Auto ads on: put an <ins> of its own among the page's
    // nodes. Loaded after mount, it never lands in markup React is still hydrating.
    // Like the real script, it places the unit whenever the page's content is there.
    const AUTO_AD = `(function place() {
        const main = document.querySelector('main');
        if (!main) return setTimeout(place, 0);
        main.insertAdjacentHTML('afterbegin', '<ins class="google-auto-placed" data-auto-ad></ins>');
    })();`;
    test.beforeEach(async ({ page }) => {
        await page.route(/adsbygoogle\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTO_AD }));
    });

    test('the landing hydrates cleanly, and the unit survives the Continue section appearing', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('seeder.lastSeed', JSON.stringify({ seed: '42', version: '1.17', dimension: 0 }));
        });
        await page.goto('/');
        await expect(page.getByRole('link', { name: 'Open Seed 42' })).toBeVisible();
        await expect(page.locator('[data-auto-ad]')).toHaveCount(1);
        await expect(page.locator('script[src*="adsbygoogle"]')).toHaveCount(1);
        // Nothing rendered twice (a recovered mismatch would also log, which the fixture fails on).
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });

    for (const path of ['/about/', '/finder/']) {
        test(`${path} mounts cleanly and keeps the unit`, async ({ page }) => {
            await page.goto(path);
            await expect(page.locator('script[src*="adsbygoogle"]')).toHaveCount(1);
            await expect(page.locator('[data-auto-ad]')).toHaveCount(1);
            await expect(page.locator('.static-intro')).toHaveCount(0);
        });
    }
});

test.describe('the handover from the prerendered page', () => {
    const opacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));
    // The page's modules answer empty: the app never mounts, as on a very slow connection.
    const withoutApp = (page) => page.route(/\/assets\/.*\.js$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));

    test('with JavaScript on, the static page is never shown: only the header, then the app', async ({ page }) => {
        const seen = [];
        await page.exposeFunction('reportStaticSeen', (what) => seen.push(what));
        await page.addInitScript(() => {
            const check = () => {
                for (const selector of ['.static-intro', '.site-footer']) {
                    const el = document.querySelector(selector);
                    if (el && document.querySelector('.static-intro') && Number(getComputedStyle(el).opacity) > 0) window.reportStaticSeen(selector);
                }
                if (performance.now() < 3000) requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
        for (const [path, root] of [['/seed/', '.seed-page'], ['/finder/', '.finder']]) {
            await page.goto(path);
            await expect(page.locator(root)).toHaveCount(1);
            await page.waitForTimeout(300);
            expect(seen, path).toEqual([]);
        }
    });

    test('if the app never arrives, the static page fades in after 3s', async ({ page }) => {
        await withoutApp(page);
        for (const path of ['/seed/', '/finder/']) {
            await page.goto(path);
            const intro = page.locator('.static-intro');
            const footer = page.locator('.site-footer');
            expect(await opacity(intro), `${path} intro at first paint`).toBe(0);
            expect(await opacity(footer), `${path} footer at first paint`).toBe(0);
            // The header is the same in the app and never waits.
            expect(await opacity(page.locator('.site-header'))).toBe(1);
            await page.waitForTimeout(1500);
            expect(await opacity(intro), `${path} at 1.5s`).toBe(0);
            await expect.poll(() => opacity(intro), { timeout: 5000 }).toBe(1);
            await expect.poll(() => opacity(footer), { timeout: 5000 }).toBe(1);
        }
    });

    test('the app replaces the intro with a short fade', async ({ page }) => {
        for (const [path, root] of [['/seed/', '.seed-page'], ['/finder/', '.finder']]) {
            await page.goto(path);
            await expect(page.locator(root)).toHaveCount(1);
            await expect(page.locator('.static-intro')).toHaveCount(0);
            expect(await page.locator(root).evaluate((el) => getComputedStyle(el).animationName), path).toBe('fade-in');
        }
    });

    test('hydrated pages never fade: their text is painted from the first byte', async ({ page }) => {
        for (const path of ['/', '/about/']) {
            await page.goto(path);
            const animated = await page.evaluate(() => [...document.querySelectorAll('#root *')]
                .filter((el) => getComputedStyle(el).animationName !== 'none' && !el.closest('.landing-continue'))
                .map((el) => el.className));
            expect(animated, path).toEqual([]);
        }
    });

    test('with reduced motion the fallback still waits, then appears without a fade', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await withoutApp(page);
        await page.goto('/seed/');
        const intro = page.locator('.static-intro');
        expect(await opacity(intro)).toBe(0);
        await expect.poll(() => opacity(intro), { timeout: 5000 }).toBe(1);
    });
});
