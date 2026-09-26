// The four HTML entries of the multi-page app. Each is a real document
// with its own title, description and canonical, shares the <head> partial and boots
// exactly one page module. Checked on the source files, expanding `@include` with the
// same regex the html-partials plugin in vite/plugins.js uses.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './harness.js';
import { ENTRY_PAGES, INCLUDE, ROOT_MARKER } from '../../vite/plugins.js';

const PAGES = [
    { name: 'landing', file: 'index.html', route: '/' },
    { name: 'seed', file: 'seed/index.html', route: '/seed/' },
    { name: 'finder', file: 'finder/index.html', route: '/finder/' },
    { name: 'about', file: 'about/index.html', route: '/about/' },
];
const read = (file) => fs.readFileSync(path.join(APP_ROOT, file), 'utf8');
const expand = (html) => html.replace(INCLUDE, (_, file) => read(path.join('src/shared/html', file)));
const count = (html, re) => (html.match(re) ?? []).length;
const first = (html, re) => html.match(re)?.[1] ?? null;

const raw = Object.fromEntries(PAGES.map((p) => [p.name, read(p.file)]));
const expanded = Object.fromEntries(PAGES.map((p) => [p.name, expand(raw[p.name])]));

describe('HTML entries', () => {
    it('every page includes the shared head partial exactly once', () => {
        for (const { name } of PAGES) {
            expect(count(raw[name], /<!--\s*@include\s+head-common\.html\s*-->/g), name).toBe(1);
            expect(expanded[name], name).not.toMatch(INCLUDE);
        }
    });

    it('titles and descriptions are unique per page', () => {
        const titles = PAGES.map(({ name }) => first(raw[name], /<title>(.*?)<\/title>/s));
        const descriptions = PAGES.map(({ name }) => first(raw[name], /<meta name="description" content="(.*?)"/));
        for (const value of [...titles, ...descriptions]) expect(value).toBeTruthy();
        expect(new Set(titles).size).toBe(PAGES.length);
        expect(new Set(descriptions).size).toBe(PAGES.length);
        for (const { name } of PAGES) {
            expect(count(expanded[name], /<title>/g), name).toBe(1);
            expect(count(expanded[name], /<meta name="description"/g), name).toBe(1);
            expect(first(raw[name], /<meta property="og:title" content="(.*?)"/), name).toBeTruthy();
            expect(first(raw[name], /<meta name="twitter:title" content="(.*?)"/), name).toBeTruthy();
        }
    });

    it('og:url and the canonical end with the page path and carry no query', () => {
        for (const { name, route } of PAGES) {
            const ogUrl = first(raw[name], /<meta property="og:url" content="(.*?)"/);
            const canonical = first(raw[name], /<link rel="canonical" href="(.*?)"/);
            expect(ogUrl, name).toMatch(new RegExp(`${route.replaceAll('/', '\\/')}$`));
            expect(canonical, name).toMatch(new RegExp(`${route.replaceAll('/', '\\/')}$`));
            expect(ogUrl, name).not.toContain('?');
            expect(canonical, name).not.toContain('?');
            expect(count(expanded[name], /rel="canonical"/g), name).toBe(1);
        }
    });

    it('boots exactly one page module, which exists', () => {
        for (const { name } of PAGES) {
            const entry = `/src/pages/${name}/main.jsx`;
            expect(count(raw[name], /<script type="module"/g), name).toBe(1);
            expect(count(raw[name], new RegExp(`<script type="module" src="${entry}"></script>`, 'g')), name).toBe(1);
            expect(fs.existsSync(path.join(APP_ROOT, entry.slice(1))), entry).toBe(true);
        }
    });

    it('carries the analytics loader once, from the partial, and never the ads loader', () => {
        for (const { name } of PAGES) {
            const html = expanded[name];
            // Auto ads would insert units into the prerendered #root before React hydrates
            // it: the loader is added after mount (loadAds in src/shared/ads.js) instead.
            expect(html, name).not.toMatch(/adsbygoogle\.js/);
            expect(count(html, /googletagmanager\.com\/gtag\/js\?id=G-CLDNC49SNT/g), name).toBe(1);
            expect(count(html, /gtag\('config', 'G-CLDNC49SNT'/g), name).toBe(1);
            // Consent Mode defaults come before any hit: denied in the EEA/UK/CH until the
            // consent message answers, so Analytics sets no cookie before consent there.
            const consent = html.indexOf("gtag('consent', 'default'");
            expect(consent, name).toBeGreaterThan(-1);
            expect(consent, name).toBeLessThan(html.indexOf("gtag('js'"));
            expect(html, name).toMatch(/analytics_storage: 'denied'[\s\S]*region: \['AT'[\s\S]*'DE'[\s\S]*'GB', 'CH'\]/);
            // A legacy redirect must not be counted as a page view.
            expect(html, name).toMatch(/if \(!window\.__legacyRedirect\) gtag\('config'/);
            expect(count(html, /<link rel="manifest" href="\/manifest\.json\?v=__APP_VERSION__"/g), name).toBe(1);
            expect(html, name).toContain('<meta property="og:site_name" content="Seeder"');
        }
    });

    it('keeps exactly one empty mount point, the marker the prerender fills', () => {
        expect(Object.keys(ENTRY_PAGES).sort()).toEqual(PAGES.map((p) => p.file).sort());
        for (const { name, file } of PAGES) {
            expect(ENTRY_PAGES[file], file).toBe(name);
            expect(count(raw[name], new RegExp(ROOT_MARKER, 'g')), name).toBe(1);
            expect(raw[name], name).not.toMatch(/<div id="root">[^<]/);
        }
    });

    it('tells visitors without JavaScript what still needs it', () => {
        const noscript = (name) => first(raw[name], /<noscript>(.*?)<\/noscript>/s);
        // The landing and About are prerendered, so only the app pages need it.
        expect(noscript('landing')).toBe('The map and finder need JavaScript.');
        expect(noscript('about')).toBe('The map and finder need JavaScript.');
        expect(noscript('seed')).toBe('You need to enable JavaScript to run this app.');
        expect(noscript('finder')).toBe('You need to enable JavaScript to run this app.');
    });

    it('declares its charset once, within the first 1024 bytes', () => {
        for (const { name } of PAGES) {
            const html = expanded[name];
            expect(count(html, /<meta charset=/g), name).toBe(1);
            expect(Buffer.byteLength(html.slice(0, html.indexOf('<meta charset=')), 'utf8'), name).toBeLessThan(1024);
        }
    });

    it('only the landing carries the legacy redirect inline script', () => {
        expect(raw.landing).toMatch(/<script>window\.__legacyRedirect = /);
        expect(raw.landing).toContain(".redirecting body { visibility: hidden }");
        // The GA snippet in the partial reads the flag, so the script must come first.
        expect(raw.landing.indexOf('window.__legacyRedirect')).toBeLessThan(raw.landing.indexOf('@include head-common.html'));
        for (const { name } of PAGES.filter((p) => p.name !== 'landing')) {
            expect(raw[name], name).not.toContain('__legacyRedirect');
        }
    });

    it('marks html.js and holds the prerendered intro back before the first paint, from the partial', () => {
        const partial = read('src/shared/html/head-common.html');
        expect(count(partial, /<script>document\.documentElement\.classList\.add\('js'\)<\/script>/g)).toBe(1);
        expect(partial).toMatch(/\.js \.static-intro, \.js main:has\(> \.static-intro\) ~ \.site-footer \{ animation: static-fallback 220ms ease-out 3s both \}/);
        // Before any stylesheet: the rule must hold while the page's CSS is still loading.
        expect(partial.indexOf("classList.add('js')")).toBeLessThan(partial.indexOf('<link'));
        for (const { name } of PAGES) expect(count(expanded[name], /classList\.add\('js'\)/g), name).toBe(1);
    });

    it('the inline script flags only a decimal seed, the ones legacy.js redirects', () => {
        const code = raw.landing.match(/<script>(window\.__legacyRedirect = [^<]*)<\/script>/)[1];
        const run = (search) => {
            const classes = new Set();
            const window = {};
            const document = { documentElement: { classList: { add: (c) => classes.add(c) } } };
            new Function('window', 'document', 'location', code)(window, document, { search });
            expect(classes.has('redirecting'), search).toBe(window.__legacyRedirect);
            return window.__legacyRedirect;
        };
        for (const search of ['?seed=123', '?seed=-42&version=1.16', '?version=1.16&seed=7', '?seed=%2B5', '?seed=+5', '?seed=%2012%20']) {
            expect(run(search), search).toBe(true);
        }
        for (const search of ['', '?seed=', '?seed=abc', '?seed=12abc', '?seed=1.5', '?seeds=12', '?xseed=12', '?version=1.16']) {
            expect(run(search), search).toBe(false);
        }
    });

    it('is a multi-page app: nothing references react-router', () => {
        for (const { name } of PAGES) expect(expanded[name], name).not.toMatch(/react-router/);
        const pkg = JSON.parse(read('package.json'));
        expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('react-router-dom');
    });
});

describe('site-wide structured data', () => {
    it('the shared head carries the WebSite + WebApplication JSON-LD, which parses', () => {
        const partial = read('src/shared/html/head-common.html');
        const json = partial.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
        const data = JSON.parse(json.replaceAll('__SITE_URL__', 'https://mcseeder.com').replaceAll('__APP_VERSION__', '1.0.0'));
        expect(data['@graph'].map((node) => node['@type'])).toEqual(['WebSite', 'WebApplication']);
    });
});
