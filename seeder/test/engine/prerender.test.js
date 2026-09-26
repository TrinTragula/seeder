// The build-time renderer (src/shared/prerender.jsx), run the way the prerender plugin
// runs it: in plain Node, with no window, document or storage. A page that starts
// reading one of them while it renders fails here rather than in `vite build`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/shared/prerender.jsx';
import { APP_ROOT, ENTRY_PAGES } from '../../vite/plugins.js';
import { CARDS, FAQ, HERO_LEAD, HERO_NAME, HERO_TITLE, NEWEST_VERSION_LABEL } from '../../src/pages/landing/content.js';

const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
// renderToString escapes text; the checks compare against the same escaping.
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;');
const current = (html) => [...html.matchAll(/<a class="site-header__link" href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);

describe('prerender', () => {
    it('runs without a browser', () => {
        expect(typeof window).toBe('undefined');
        expect(typeof document).toBe('undefined');
        expect(typeof localStorage).toBe('undefined');
    });

    it('renders every entry the plugin knows, and refuses an unknown page', () => {
        for (const page of Object.values(ENTRY_PAGES)) expect(render(page), page).toMatch(/<header class="site-header">/);
        expect(() => render('nope')).toThrow(/unknown page/);
    });

    it('every page carries the header icons in its HTML', () => {
        for (const page of Object.values(ENTRY_PAGES)) {
            const html = render(page);
            for (const icon of ['/svg/map.svg', '/svg/search.svg', '/svg/info.svg']) {
                expect(html, `${page} ${icon}`).toContain(`<img class="site-header__icon" src="${icon}" alt=""`);
            }
        }
    });

    it('landing: the hero, the seed form, both cards and every FAQ answer are in the HTML', () => {
        const html = render('landing');
        for (const text of [HERO_NAME, HERO_TITLE, HERO_LEAD, `<strong>${pkg.version}</strong>`, `<strong>${NEWEST_VERSION_LABEL}</strong>`]) {
            expect(html).toContain(text.startsWith('<') ? text : escape(text));
        }
        expect(html).toMatch(/<form[^>]*action="\/seed\/"[^>]*method="get"/);
        for (const card of CARDS) {
            expect(html).toContain(escape(card.title));
            expect(html).toContain(`href="${card.link.href}"`);
        }
        for (const { question } of FAQ) expect(html).toContain(escape(question));
        expect(current(html)).toEqual([]);
    });

    it('landing: nothing the browser remembers or the URL says is prerendered', () => {
        const html = render('landing');
        // The Continue section and the ?seed= prefill are filled in after hydration.
        expect(html).not.toContain('landing-continue');
        expect(html).not.toMatch(/<input[^>]*name="seed"[^>]*value=/);
    });

    it('about: the title, the version and every section heading', () => {
        const html = render('about');
        expect(html).toContain('<h1>Seeder</h1>');
        expect(html).toContain(pkg.version);
        for (const heading of ['Who', 'Can I help?', 'What is it', 'What it does', 'Limitations', 'Credits', 'Privacy and ads']) {
            expect(html).toContain(`>${escape(heading)}</h2>`);
        }
        expect(current(html)).toEqual(['/about/']);
    });

    it('seed and finder: only the intro of their landing card, never the app', () => {
        for (const [page, id, path] of [['seed', 'map', '/seed/'], ['finder', 'finder', '/finder/']]) {
            const card = CARDS.find((entry) => entry.id === id);
            const html = render(page);
            expect(html, page).toContain(`<h1>${escape(card.title)}</h1>`);
            expect(html, page).toContain(escape(card.text));
            expect(html, page).not.toMatch(/<canvas|<ins /);
            expect(current(html), page).toEqual([path]);
        }
    });
});
