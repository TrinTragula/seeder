// The site's Vite plugins (vite/plugins.js), driven without a Vite server: the
// trailing-slash middleware with a fake request/response, the two HTML transforms in
// the order vite.config.js lists them, and the prerender with a stand-in renderer (the
// real one is src/shared/prerender.test.jsx; the build itself is covered by e2e).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEV_HIDE_ROOT, ENTRY_PAGES, PRERENDER_CHILD, ROOT_MARKER, htmlPartials, htmlVars, pageOf, prerender, trailingSlash, SITE_URL } from '../../vite/plugins.js';
import { APP_ROOT } from './harness.js';

const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
const read = (file) => fs.readFileSync(path.join(APP_ROOT, file), 'utf8');

// Captures the middleware the plugin registers on a server hook.
function middlewareOf(hook) {
    let registered = null;
    trailingSlash()[hook]({ middlewares: { use: (fn) => { registered = fn; } } });
    return registered;
}

function hit(middleware, url) {
    const res = { statusCode: 200, headers: {}, ended: false };
    res.setHeader = (name, value) => { res.headers[name] = value; };
    res.end = () => { res.ended = true; };
    const next = vi.fn();
    middleware({ url, method: 'GET' }, res, next);
    return { res, next };
}

const transform = (plugin, html) => plugin().transformIndexHtml.handler(html);

describe('trailingSlash', () => {
    for (const hook of ['configureServer', 'configurePreviewServer']) {
        describe(hook, () => {
            const middleware = middlewareOf(hook);

            it('redirects a section without its slash with a 308', () => {
                const { res, next } = hit(middleware, '/finder');
                expect(res.statusCode).toBe(308);
                expect(res.headers.Location).toBe('/finder/');
                expect(res.ended).toBe(true);
                expect(next).not.toHaveBeenCalled();
            });

            it('keeps the query', () => {
                const { res, next } = hit(middleware, '/about?x=1');
                expect(res.statusCode).toBe(308);
                expect(res.headers.Location).toBe('/about/?x=1');
                expect(next).not.toHaveBeenCalled();
            });

            it('leaves slashed sections, the root and unknown paths alone', () => {
                for (const url of ['/seed/', '/seed/?seed=1', '/', '/nope', '/seeds', '/licenses.txt']) {
                    const { res, next } = hit(middleware, url);
                    expect(next, url).toHaveBeenCalledTimes(1);
                    expect(res.statusCode, url).toBe(200);
                    expect(res.ended, url).toBe(false);
                }
            });
        });
    }
});

describe('htmlPartials and htmlVars', () => {
    const partial = read('src/shared/html/head-common.html');

    it('pastes the partial in place of the include comment', () => {
        const html = transform(htmlPartials, '<head>\n<!-- @include head-common.html -->\n<title>x</title>\n</head>');
        expect(html).toBe(`<head>\n${partial}\n<title>x</title>\n</head>`);
        expect(html).not.toContain('@include');
    });

    it('run in order, leave no placeholder in any entry', () => {
        for (const file of ['index.html', 'seed/index.html', 'finder/index.html', 'about/index.html']) {
            const html = transform(htmlVars, transform(htmlPartials, read(file)));
            expect(html, file).not.toContain('@include');
            expect(html, file).not.toContain('__APP_VERSION__');
            expect(html, file).not.toContain('__SITE_URL__');
            expect(html, file).toContain(`/manifest.json?v=${pkg.version}`);
            expect(html, file).toContain(`content="${SITE_URL}/img/og-card.png"`);
        }
    });

    it('run in pre order, so the partial is expanded before the vars are stamped', () => {
        expect(htmlPartials().transformIndexHtml.order).toBe('pre');
        expect(htmlVars().transformIndexHtml.order).toBe('pre');
    });
});

describe('prerender', () => {
    const renders = [];
    const fake = () => prerender({ load: async () => ({ render: (page) => { renders.push(page); return `<p>${page} $& $1</p>`; } }) });
    const run = (plugin, html, file, extra = {}) => plugin.transformIndexHtml.handler(html, { filename: path.join(APP_ROOT, file), ...extra });

    it('maps each entry file to its page, and anything else to none', () => {
        for (const [file, page] of Object.entries(ENTRY_PAGES)) expect(pageOf(path.join(APP_ROOT, file)), file).toBe(page);
        expect(pageOf(path.join(APP_ROOT, 'public/404.html'))).toBeNull();
        expect(pageOf(path.join(APP_ROOT, 'seed/other.html'))).toBeNull();
    });

    it('fills only the mount point of every entry, with that page\'s markup taken verbatim', async () => {
        renders.length = 0;
        for (const [file, page] of Object.entries(ENTRY_PAGES)) {
            const source = read(file);
            const html = await run(fake(), source, file);
            expect(html, file).toBe(source.replace(ROOT_MARKER, () => `<div id="root"><p>${page} $& $1</p></div>`));
        }
        expect(renders).toEqual(Object.values(ENTRY_PAGES));
    });

    it('in dev only, hides #root until the stylesheet (injected from JS there) shows it again', async () => {
        const source = read('seed/index.html');
        const dev = await run(fake(), source, 'seed/index.html', { server: {} });
        expect(dev.match(/data-prerender-dev/g)).toHaveLength(1);
        expect(dev.indexOf(DEV_HIDE_ROOT)).toBeLessThan(dev.indexOf('</head>'));
        // Only while scripts run: with JavaScript blocked the stylesheet never comes in dev.
        expect(DEV_HIDE_ROOT).toContain(':where(.js) #root { visibility: hidden }');
        const build = await run(fake(), source, 'seed/index.html');
        expect(build).not.toContain('data-prerender-dev');
        // The stylesheet's own rule is what turns it back on.
        expect(read('src/shared/styles/base.css')).toMatch(/#root \{\n    visibility: visible;\n\}/);
    });

    it('leaves a document that is not an entry alone', async () => {
        renders.length = 0;
        expect(await run(fake(), `<body>${ROOT_MARKER}</body>`, 'public/404.html')).toBe(`<body>${ROOT_MARKER}</body>`);
        expect(renders).toEqual([]);
    });

    it('fails the build on an entry without exactly one mount point, instead of shipping an empty shell', async () => {
        await expect(run(fake(), '<body><div id="app"></div></body>', 'index.html')).rejects.toThrow(/exactly one/);
        await expect(run(fake(), `<body>${ROOT_MARKER}${ROOT_MARKER}</body>`, 'about/index.html')).rejects.toThrow(/exactly one/);
    });

    it('turns itself off inside its own render server', () => {
        process.env[PRERENDER_CHILD] = '1';
        try {
            const plugin = prerender();
            expect(plugin.name).toBe('prerender');
            expect(plugin.transformIndexHtml).toBeUndefined();
        } finally {
            delete process.env[PRERENDER_CHILD];
        }
        expect(prerender().transformIndexHtml).toBeDefined();
    });

    it('runs after the pre-order transforms, once the partial is expanded and the vars stamped', () => {
        expect(prerender().transformIndexHtml.order).toBeUndefined();
    });
});
