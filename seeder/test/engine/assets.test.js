// The static files served verbatim from public/: nothing in the build would notice if one
// went stale or wrong.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from './harness.js';
import { DISCLAIMER } from '../../src/shared/Footer.jsx';
import { HERO_LEAD } from '../../src/pages/landing/content.js';

const SITE = 'https://mcseeder.com';
const PAGES = ['/', '/seed/', '/finder/', '/about/'];
const read = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file));
const text = (file) => read(file).toString('utf8');

// A PNG's size is in its IHDR chunk: width and height as big-endian ints at bytes 16-24.
const pngSize = (file) => {
    const bytes = read(file);
    expect(bytes.subarray(1, 4).toString('latin1'), `${file} is a PNG`).toBe('PNG');
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};

// An ICO's directory: one 16-byte entry per image, width/height bytes where 0 means 256.
const icoSizes = (file) => {
    const bytes = read(file);
    return Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => {
        const at = 6 + 16 * i;
        return `${bytes[at] || 256}x${bytes[at + 1] || 256}`;
    });
};

describe('sitemap.xml', () => {
    it('lists exactly the four pages, with trailing slashes and no query', () => {
        const xml = text('sitemap.xml');
        const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
        expect(locs).toEqual(PAGES.map((p) => `${SITE}${p}`));
        expect(xml.match(/<url>/g)).toHaveLength(PAGES.length);
        for (const loc of locs) expect(loc).not.toContain('?');
        expect(xml).not.toContain('<lastmod>');
        expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    });
});

describe('robots.txt', () => {
    it('points at the sitemap and still allows everything', () => {
        const robots = text('robots.txt');
        expect(robots).toMatch(new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'));
        expect(robots).toMatch(/^User-agent: \*$/m);
        expect(robots).toMatch(/^Disallow:\s*$/m);
        expect(robots).not.toMatch(/^Disallow: *\S/m);
    });

    it('welcomes the AI crawlers by name', () => {
        const robots = text('robots.txt');
        for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) {
            expect(robots, bot).toMatch(new RegExp(`^User-agent: ${bot}$`, 'm'));
        }
        expect(robots).toMatch(/^Allow: \/$/m);
    });
});

describe('manifest.json', () => {
    const manifest = JSON.parse(text('manifest.json'));

    it('starts on the seed page and covers the whole site', () => {
        expect(manifest.start_url).toBe('/seed/');
        expect(manifest.scope).toBe('/');
        expect(manifest.short_name).toBe('Seeder');
    });

    it('describes the site with the landing lead', () => {
        expect(manifest.description).toBe(HERO_LEAD);
    });

    it('declares every icon at the sizes its file really has', () => {
        expect(manifest.icons.length).toBeGreaterThan(0);
        for (const icon of manifest.icons) {
            expect(fs.existsSync(path.join(PUBLIC_DIR, icon.src)), icon.src).toBe(true);
            const declared = icon.sizes.split(/\s+/);
            if (icon.type === 'image/png') expect(declared, icon.src).toEqual([pngSize(icon.src)]);
            else expect(declared.sort(), icon.src).toEqual(icoSizes(icon.src).sort());
        }
    });
});

describe('404.html', () => {
    const html = text('404.html');

    it('is self-contained: no script, no web font', () => {
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/@font-face/i);
        expect(html).toMatch(/<meta name="robots" content="noindex"/);
        expect(html).toMatch(/<html lang="en">/);
    });

    it('links every section and carries the disclaimer', () => {
        const hrefs = [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
        for (const page of PAGES) expect(hrefs, page).toContain(page);
        expect(html).toContain(DISCLAIMER);
        expect(html).toMatch(/<h1>Page not found<\/h1>/);
    });
});

describe('og-card.png', () => {
    it('exists at 1200×630', () => {
        expect(pngSize('img/og-card.png')).toBe('1200x630');
    });
});

describe('ads.txt', () => {
    it('still carries the publisher line', () => {
        expect(text('ads.txt')).toContain('google.com, pub-2625181666337030, DIRECT, f08c47fec0942fa0');
    });
});
