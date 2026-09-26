import fs from 'node:fs';
import { test, expect } from './fixtures.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the About page is reachable from the header and shows the release version', async ({ page }) => {
    await page.goto('/');
    // The landing links every section too: the header is the one being tested here.
    await page.getByRole('banner').getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.getByRole('heading', { name: 'Seeder', level: 1 })).toBeVisible();
    await expect(page.getByText(`(${pkg.version})`)).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
    // The brand goes back to the landing, not to the map.
    await page.getByRole('banner').getByRole('link', { name: 'Seeder', exact: true }).click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seeder - Minecraft seed map, finder & explorer');
});

test('deep-linking /about/ works on a fresh load (its own document, no SPA fallback)', async ({ page }) => {
    const response = await page.goto('/about/');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle('About - Seeder');
    await expect(page.getByRole('heading', { name: 'Seeder', level: 1 })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/TrinTragula/seeder');
});

test('/finder and /about without the trailing slash end on the slashed page', async ({ page }) => {
    await page.goto('/finder');
    await expect(page).toHaveURL(/\/finder\/(\?.*)?$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minecraft seed finder');
    await page.goto('/about');
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.getByRole('heading', { name: 'Seeder', level: 1 })).toBeVisible();
});

test('the About page lists what Seeder does, its limitations and its credits', async ({ page }) => {
    await page.goto('/about/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
        'Who', 'Can I help?', 'What is it', "Where's the code?", 'What it does', 'Limitations', 'Credits', 'Privacy and ads',
    ]);
    const features = main.getByRole('region', { name: 'What it does' });
    await expect(features).toContainText('quad');
    await expect(features).toContainText('Slime-chunk');
    await expect(main.getByRole('region', { name: 'Limitations' })).toContainText(/dungeon/i);
    const credits = main.getByRole('region', { name: 'Credits' });
    await expect(credits.getByRole('link', { name: 'cubiomes', exact: true })).toHaveAttribute('href', 'https://github.com/Cubitect/cubiomes');
    await expect(credits.getByRole('link', { name: 'xpple/cubiomes' })).toHaveAttribute('href', 'https://github.com/xpple/cubiomes');
    await expect(credits.getByRole('link', { name: /Minecraftia/ })).toHaveAttribute('href', 'http://www.andrewtyler.net');
    await expect(credits.getByRole('link', { name: 'CC BY-SA 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/');
    await expect(credits.getByRole('link', { name: 'licenses.txt' })).toHaveAttribute('href', '/licenses.txt');
    // One ad unit on the page, laid out (so AdSense can fill it), and inside the content.
    await expect(page.locator('ins.adsbygoogle')).toHaveCount(1);
    await expect(main.locator('ins.adsbygoogle')).toHaveCount(1);
    expect(await main.locator('ins.adsbygoogle').evaluate((ins) => ins.offsetWidth)).toBeGreaterThan(0);
    // The donate buttons are on the page ("Can I help?") and in the footer.
    await expect(main.getByRole('region', { name: 'Can I help?' }).locator('form[action*="paypal"]')).toHaveCount(1);
    await expect(page.getByRole('contentinfo').locator('form[action*="paypal"]')).toHaveCount(1);
});

test('unknown paths are 404s, and the 404 page itself links home', async ({ page }) => {
    // vite preview answers an unknown path with a bare 404 and never serves 404.html;
    // Cloudflare Pages serves the file (with status 404) in production.
    const missing = await page.request.get('/nope/');
    expect(missing.status()).toBe(404);

    const response = await page.goto('/404.html');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle('Page not found - Seeder');
    await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    const hrefs = await page.getByRole('main').getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(['/', '/seed/', '/finder/', '/about/']);
    await expect(page.getByText('Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.')).toBeVisible();
    expect(await page.locator('script').count()).toBe(0);
});

test('the SEO files are served', async ({ page }) => {
    for (const file of ['/sitemap.xml', '/robots.txt', '/manifest.json', '/img/og-card.png', '/licenses.txt']) {
        const response = await page.request.get(file);
        expect(response.status(), file).toBe(200);
    }
    const manifest = await (await page.request.get('/manifest.json')).json();
    expect(manifest.start_url).toBe('/seed/');
});
