import fs from 'node:fs';
import { test, expect } from './fixtures.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the About page is reachable from the header and shows the release version', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { name: 'Seeder', level: 1 })).toBeVisible();
    await expect(page.getByText(`(${pkg.version})`)).toBeVisible();
    await page.getByRole('link', { name: 'Seeder', exact: true }).click();
    await expect(page).toHaveURL(/\/\?seed=-?\d+&version=/);
});

test('deep-linking /about works on a fresh load (SPA fallback)', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'Seeder', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Github' })).toHaveAttribute('href', 'https://github.com/TrinTragula/seeder');
});
