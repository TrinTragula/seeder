import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { htmlPartials, htmlVars, prerender, trailingSlash } from './vite/plugins.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

export default defineConfig({
    // One real HTML document per section and a full load between them.
    appType: 'mpa',
    plugins: [react(), htmlPartials(), htmlVars(), prerender(), trailingSlash()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    // Port 3000 is what the docs and bench/bench.mjs expect (CRA's default).
    server: { port: 3000 },
    preview: { port: 4173 },
    build: {
        // Keep CRA's output folder so deploy paths and .gitignore stay valid.
        outDir: 'build',
        rolldownOptions: {
            input: {
                landing: resolve(root, 'index.html'),
                seed: resolve(root, 'seed/index.html'),
                finder: resolve(root, 'finder/index.html'),
                about: resolve(root, 'about/index.html'),
            },
            output: {
                // Shared chunks, so moving between sections only fetches the page's own code.
                codeSplitting: {
                    groups: [
                        { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
                        { name: 'react-select', test: /node_modules[\\/](react-select|@emotion|@floating-ui|memoize-one|use-isomorphic-layout-effect|prop-types)[\\/]/, priority: 20 },
                        { name: 'engine', test: /[\\/]src[\\/](library|util)[\\/]/, priority: 10 },
                    ],
                },
            },
        },
    },
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
