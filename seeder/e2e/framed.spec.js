// Another site embedding our pages in a frame (msseedmap.us did, with the landing's
// legacy /?seed= link) sees only a notice pointing to the real site: no map, no workers.
import { test, expect } from './fixtures.js';

const SEED = '3245202589';
// Another origin for the browser (127.0.0.1 is not localhost), answered by the test itself.
// Chrome's Local Network Access checks would block the frame (a page the test answers
// counts as public), so they are off for this file.
const EMBEDDER = 'http://127.0.0.1:4173/__embedder__';

test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] } });

const embed = async (page, src) => {
    await page.route(EMBEDDER, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><title>Copy</title><iframe src="${src}" width="1000" height="700" allowfullscreen></iframe>`,
    }));
    await page.goto(EMBEDDER);
    return page.frameLocator('iframe');
};

test('a legacy seed link framed by another site shows only the notice, linking to the seed page', async ({ page }) => {
    const frame = await embed(page, `http://localhost:4173/?seed=${SEED}&version=1.21.4`);
    await expect(frame.getByRole('heading', { name: 'Open Seeder on its own site' })).toBeVisible();
    const link = frame.getByRole('link', { name: 'Open mcseeder.com' });
    await expect(link).toHaveAttribute('href', `http://localhost:4173/seed/?seed=${SEED}&version=1.21.4`);
    await expect(link).toHaveAttribute('target', '_top');
    await expect(frame.getByRole('img', { name: 'Biome map' })).toHaveCount(0);
    await expect(frame.getByRole('banner')).toHaveCount(0);

    // The link takes the whole tab to the real page.
    await link.click();
    await expect(page).toHaveURL(`http://localhost:4173/seed/?seed=${SEED}&version=1.21.4`);
    await expect(page.getByRole('img', { name: 'Biome map' })).toBeVisible();
});

for (const path of ['/', '/finder/', '/about/']) {
    test(`${path} framed by another site shows only the notice`, async ({ page }) => {
        const frame = await embed(page, `http://localhost:4173${path}`);
        await expect(frame.getByRole('heading', { name: 'Open Seeder on its own site' })).toBeVisible();
        await expect(frame.getByRole('heading')).toHaveCount(1);
        await expect(frame.getByRole('banner')).toHaveCount(0);
    });
}

test('a framed page starts no worker', async ({ page }) => {
    const workers = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    const frame = await embed(page, `http://localhost:4173/seed/?seed=${SEED}&version=1.21.4`);
    await expect(frame.getByRole('heading', { name: 'Open Seeder on its own site' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(workers).toEqual([]);
});
