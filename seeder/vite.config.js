import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// package.json is the single source of the app version: `define` injects it into
// the JS bundle (see src/util/site.js) and this plugin stamps it into index.html
// (the manifest cache-buster). Bump package.json and everything follows.
const htmlAppVersion = () => ({
    name: 'html-app-version',
    transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('__APP_VERSION__', pkg.version),
    },
});

export default defineConfig({
    plugins: [react(), htmlAppVersion()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    // Port 3000 is what the docs and bench/bench.mjs expect (CRA's default).
    server: { port: 3000 },
    preview: { port: 4173 },
    // Keep CRA's output folder so deploy paths and .gitignore stay valid.
    build: { outDir: 'build' },
    test: {
        projects: [
            {
                // Unit + component tests, colocated under src/, run in jsdom.
                extends: true,
                test: {
                    name: 'unit',
                    environment: 'jsdom',
                    include: ['src/**/*.test.{js,jsx}'],
                    setupFiles: ['./src/test/setup.js'],
                },
            },
            {
                // Engine tests: the real api.wasm + worker glue, run in plain Node.
                extends: true,
                test: {
                    name: 'engine',
                    environment: 'node',
                    include: ['test/**/*.test.js'],
                    testTimeout: 120_000,
                    hookTimeout: 120_000,
                },
            },
        ],
    },
});
