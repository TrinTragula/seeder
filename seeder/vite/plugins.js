// The site's own Vite plugins, used by vite.config.js and exercised directly by
// test/engine/plugins.test.js.
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The app folder (seeder/), one level above this file.
export const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(APP_ROOT, 'package.json'), 'utf8'));

// Stamped into og:url, canonical and og:image. Canonicals never carry a query.
export const SITE_URL = 'https://mcseeder.com';
// The sections that live in their own folder (seed/index.html …); "/" is index.html itself.
export const PAGES = ['seed', 'finder', 'about'];
// `<!-- @include file.html -->`, the file resolved against src/shared/html/.
export const INCLUDE = /<!--\s*@include\s+(\S+)\s*-->/g;
export const PARTIALS_DIR = resolve(APP_ROOT, 'src/shared/html');

// The four entry documents share one <head> block (meta, icons, manifest, analytics,
// ads) kept in src/shared/html/. `<!-- @include file.html -->` pastes it in verbatim,
// in dev and in the build, so the GA snippet is edited once instead of four times.
export const htmlPartials = () => ({
    name: 'html-partials',
    transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace(INCLUDE, (_, file) => readFileSync(resolve(PARTIALS_DIR, file), 'utf8')),
    },
    // A partial is not in Vite's module graph, so edits to it need an explicit watch.
    configureServer(server) {
        server.watcher.add(PARTIALS_DIR);
    },
});

// package.json is the single source of the app version: `define` injects it into the
// JS bundle (see src/util/site.js) and this plugin stamps it into the HTML (the
// manifest cache-buster), together with the site URL. It must run after htmlPartials
// so the placeholders inside the partial get stamped as well.
export const htmlVars = () => ({
    name: 'html-vars',
    transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('__APP_VERSION__', pkg.version).replaceAll('__SITE_URL__', SITE_URL),
    },
});

// With appType 'mpa' there is no SPA fallback, so /seed (no slash) would not resolve to
// seed/index.html the way production does: Cloudflare Pages normalises it to /seed/.
// This gives dev and preview the same behaviour (308 keeps the method and the query).
export const trailingSlash = () => {
    const middleware = (req, res, next) => {
        const at = req.url.indexOf('?');
        const pathname = at === -1 ? req.url : req.url.slice(0, at);
        const query = at === -1 ? '' : req.url.slice(at);
        if (PAGES.includes(pathname.slice(1))) {
            res.statusCode = 308;
            res.setHeader('Location', `${pathname}/${query}`);
            res.end();
            return;
        }
        next();
    };
    return {
        name: 'trailing-slash',
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
};

// The four entry documents and the page each one boots, by path relative to APP_ROOT.
export const ENTRY_PAGES = {
    'index.html': 'landing',
    'seed/index.html': 'seed',
    'finder/index.html': 'finder',
    'about/index.html': 'about',
};
// The empty mount point every entry carries; the prerender fills it.
export const ROOT_MARKER = '<div id="root"></div>';
// Set while the prerender's own Vite server loads this config, so it does not prerender itself.
export const PRERENDER_CHILD = 'SEEDER_PRERENDER_CHILD';
const RENDERER = '/src/shared/prerender.jsx';
// The dev server has no stylesheet <link>: it injects the CSS from JS, after the prerendered
// markup has been painted unstyled. In dev only, #root stays hidden until the shared
// stylesheet arrives and shows it again (base.css). Only while scripts run (html.js, set in
// head-common.html): with JavaScript blocked the stylesheet never comes, and the page must
// still show. :where() keeps the specificity of base.css's #root, so that later rule wins.
// The build links its CSS in the <head> and gets none of this.
export const DEV_HIDE_ROOT = '<style data-prerender-dev>:where(.js) #root { visibility: hidden }</style>';

export const pageOf = (filename) => ENTRY_PAGES[relative(APP_ROOT, filename).split(sep).join('/')] ?? null;

// Puts the rendered markup inside the one mount point, or fails the build: a page
// shipped as an empty shell is exactly what the prerender exists to prevent.
export function fillRoot(html, markup, page) {
    const at = html.indexOf(ROOT_MARKER);
    if (at === -1 || html.indexOf(ROOT_MARKER, at + 1) !== -1) {
        throw new Error(`prerender: the ${page} entry must contain exactly one ${ROOT_MARKER}`);
    }
    return `${html.slice(0, at)}<div id="root">${markup}</div>${html.slice(at + ROOT_MARKER.length)}`;
}

// Renders each page's React tree into its HTML (src/shared/prerender.jsx), so the text
// is in the document for crawlers and for the first paint; the landing and About then
// hydrate it, the seed page and the finder replace their intro with the app. In dev
// it renders through the dev server itself, so a hydration mismatch shows up there too.
// The build renders through a second Vite server with no port and no file watcher, so
// `vite build` still exits by itself (Cloudflare Pages runs it). `load` replaces the
// renderer in tests.
export const prerender = ({ load } = {}) => {
    if (process.env[PRERENDER_CHILD]) return { name: 'prerender' };
    let config;
    let devServer = null;
    let buildServer = null;

    const startBuildServer = async () => {
        const { createServer } = await import('vite');
        process.env[PRERENDER_CHILD] = '1';
        try {
            return await createServer({
                configFile: config.configFile,
                mode: config.mode,
                logLevel: 'error',
                appType: 'custom',
                server: { middlewareMode: true, hmr: false, watch: null },
            });
        } finally {
            delete process.env[PRERENDER_CHILD];
        }
    };
    const renderer = async () => {
        if (load) return load();
        if (devServer) return devServer.ssrLoadModule(RENDERER);
        buildServer ??= startBuildServer();
        return (await buildServer).ssrLoadModule(RENDERER);
    };
    const closeBuildServer = async () => {
        const server = buildServer;
        buildServer = null;
        if (server) await (await server).close();
    };

    return {
        name: 'prerender',
        configResolved(resolved) {
            config = resolved;
        },
        configureServer(server) {
            devServer = server;
        },
        transformIndexHtml: {
            handler: async (html, ctx) => {
                const page = pageOf(ctx.filename);
                if (!page) return html;
                const { render } = await renderer();
                const filled = fillRoot(html, render(page), page);
                return ctx.server ? filled.replace('</head>', () => `${DEV_HIDE_ROOT}\n</head>`) : filled;
            },
        },
        buildEnd: closeBuildServer,
        closeBundle: closeBuildServer,
    };
};
