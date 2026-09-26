// Release hygiene: the app version has one source (package.json). Everything else
// derives from it at build time, except the README heading, which this test guards.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, REPO_ROOT } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
const README = fs.readFileSync(path.join(REPO_ROOT, 'README.MD'), 'utf8');
// AGENTS.MD is the agents' entry point: it must name every WASM export (see below).
const AGENTS_MD = path.join(REPO_ROOT, 'AGENTS.MD');
// The four HTML documents of the multi-page app; they live outside src/.
const ENTRIES = ['index.html', 'seed/index.html', 'finder/index.html', 'about/index.html'];
// Application sources only: tests may use made-up versions in fixtures.
const readAll = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && /\.(jsx?|css|html)$/.test(d.name) && !/\.test\.jsx?$/.test(d.name) && !(d.parentPath ?? d.path).includes(`${path.sep}test`))
    .map((d) => path.join(d.parentPath ?? d.path, d.name));

describe('app version', () => {
    it('package.json carries a semver version', () => {
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
    it('README.MD heading matches package.json', () => {
        expect(README.split('\n')[0]).toBe(`# Seeder v${pkg.version}`);
    });
    it('README.MD "Works up to" names the newest version in constants.jsx', () => {
        const newest = Object.entries(VERSIONS).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        expect(README).toMatch(/Works up to \*\*[^*]+\*\*/);
        expect(README.match(/Works up to \*\*([^*]+)\*\*/)[1]).toBe(newest);
    });
    it('every entry takes the manifest cache-buster from the shared head partial, not a literal', () => {
        for (const entry of ENTRIES) {
            const html = fs.readFileSync(path.join(APP_ROOT, entry), 'utf8');
            expect(html, entry).toContain('<!-- @include head-common.html -->');
            expect(html, entry).not.toMatch(/manifest\.json\?v=\d/);
        }
        const head = fs.readFileSync(path.join(APP_ROOT, 'src', 'shared', 'html', 'head-common.html'), 'utf8');
        expect(head).toContain('manifest.json?v=__APP_VERSION__');
        expect(head).not.toMatch(/manifest\.json\?v=\d/);
    });
    it('no source file hardcodes a version string', () => {
        const files = [...readAll(path.join(APP_ROOT, 'src')), ...ENTRIES.map((entry) => path.join(APP_ROOT, entry))];
        for (const file of files) {
            const src = fs.readFileSync(file, 'utf8');
            expect(src, file).not.toMatch(/\?v=\d+\.\d+\.\d+/);
            expect(src, file).not.toMatch(/\(0\.\d+\.\d+\)/);
        }
    });
});

describe('AGENTS.MD', () => {
    it('names every function api.c exports to the WASM', () => {
        const api = fs.readFileSync(path.join(REPO_ROOT, 'cubiomes-mods', 'api.c'), 'utf8').split('\n');
        // Each EMSCRIPTEN_KEEPALIVE marker sits on the line before its signature; the export
        // is the identifier right before the signature's "(".
        const exported = api.flatMap((line, i) => (/^\s*EMSCRIPTEN_KEEPALIVE\b/.test(line)
            ? [api[i + 1].match(/([A-Za-z_]\w*)\s*\(/)[1]] : []));
        expect(exported.length).toBeGreaterThan(0);
        const agents = fs.readFileSync(AGENTS_MD, 'utf8');
        const missing = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(agents));
        expect(missing).toEqual([]);
    });
});
