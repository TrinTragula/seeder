// Release hygiene: the app version has one source (package.json). Everything else
// derives from it at build time, except the README heading, which this test guards.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, REPO_ROOT } from './harness.js';

const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
// Application sources only: tests may use made-up versions in fixtures.
const readAll = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && /\.(jsx?|css|html)$/.test(d.name) && !/\.test\.jsx?$/.test(d.name) && !(d.parentPath ?? d.path).includes(`${path.sep}test`))
    .map((d) => path.join(d.parentPath ?? d.path, d.name));

describe('app version', () => {
    it('package.json carries a semver version', () => {
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
    it('README.MD heading matches package.json', () => {
        const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.MD'), 'utf8');
        expect(readme.split('\n')[0]).toBe(`# Seeder v${pkg.version}`);
    });
    it('index.html takes the manifest cache-buster from the build, not a literal', () => {
        const html = fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8');
        expect(html).toContain('manifest.json?v=__APP_VERSION__');
        expect(html).not.toMatch(/manifest\.json\?v=\d/);
    });
    it('no source file hardcodes a version string', () => {
        for (const file of readAll(path.join(APP_ROOT, 'src'))) {
            const src = fs.readFileSync(file, 'utf8');
            expect(src, file).not.toMatch(/\?v=\d+\.\d+\.\d+/);
            expect(src, file).not.toMatch(/\(0\.\d+\.\d+\)/);
        }
    });
});
