import { test, expect, gotoSeed, drawer, settled } from './fixtures.js';

test('a shared URL restores seed and version', async ({ page }) => {
    await gotoSeed(page, '8091867987493326313', '1.18');
    await expect(page.getByLabel('Seed')).toHaveValue('8091867987493326313');
    await expect(page.getByText('1.18', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\?seed=8091867987493326313&version=1\.18$/);
    const d = await drawer(page);
    expect(d.seed).toBe('8091867987493326313');
    expect(d.mcVersion).toBe(22);
});

test('an old share URL with a numeric version still works and is rewritten to the label', async ({ page }) => {
    await page.goto('/?version=17&seed=42');
    await settled(page, { seed: '42' });
    await expect(page.getByText('1.17', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/seed=42&version=1\.17$/);
    expect((await drawer(page)).mcVersion).toBe(21);
});

test('without parameters the page picks a random seed and the default version, and publishes them', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__seederDrawer?.seed != null);
    const seed = await page.getByLabel('Seed').inputValue();
    expect(seed).toMatch(/^-?\d+$/);
    await expect(page).toHaveURL(new RegExp(`\\?seed=${seed}&version=26\\.3$`));
    await expect(page.getByText('26.3', { exact: true })).toBeVisible();
});

test('COPY puts the share URL on the clipboard', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await expect(page.getByLabel('Share URL')).toHaveValue(page.url());
    await page.getByRole('button', { name: 'COPY' }).click();
    await expect(page.getByRole('button', { name: 'COPIED!' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test('a non-numeric ?seed= parameter is hashed like typed text and the map still renders', async ({ page }) => {
    await page.goto('/?seed=12abc&version=26.3');
    await settled(page, { seed: '46838433' });                // Java "12abc".hashCode()
    await expect(page.getByLabel('Seed')).toHaveValue('46838433');
    await expect(page).toHaveURL(/seed=46838433&version=26\.3$/);
});

test('a text seed is hashed like Minecraft does and lands in the URL', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await page.getByLabel('Seed').fill('hello');
    await page.getByLabel('Seed').press('Enter');
    await expect(page).toHaveURL(/seed=99162322&/);
    await settled(page, { seed: '99162322' });
});

test('GO and Random seed change the seed in the URL and on the map', async ({ page }) => {
    await gotoSeed(page, '123', '26.3');
    await page.getByLabel('Seed').fill('-98765');
    await page.getByRole('button', { name: 'GO' }).click();
    await expect(page).toHaveURL(/seed=-98765&/);
    await settled(page, { seed: '-98765' });
    await page.getByRole('button', { name: 'Random seed' }).click();
    const seed = await page.getByLabel('Seed').inputValue();
    expect(seed).not.toBe('-98765');
    await expect(page).toHaveURL(new RegExp(`seed=${seed}&`));
    await settled(page, { seed });
});
