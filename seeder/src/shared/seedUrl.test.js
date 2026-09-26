// The one URL contract of the seed page. Every share link, the address
// bar and the legacy redirect are built here, so a change that breaks a pre-1.0
// bookmark has to break one of these cases first.
import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW, SEED_PATH, SITE_URL, buildSeedUrl, parseSeedPage, versionLabelOf } from './seedUrl';
import { DEFAULT_VERSION, seedFromString } from '../util/seed';
import { HEIGHT_OPTIONS, STRUCTURES_OPTIONS, VERSIONS } from '../util/constants';

const BIG = '8091867987493326313';           // 19 digits: Number would round it

describe('parseSeedPage - seed', () => {
    it('keeps a decimal seed as the string it was, whatever its size', () => {
        expect(parseSeedPage('?seed=123').seed).toBe('123');
        expect(parseSeedPage('?seed=-98765').seed).toBe('-98765');
        expect(parseSeedPage(`?seed=${BIG}`).seed).toBe(BIG);
        expect(parseSeedPage('?seed=-9223372036854775808').seed).toBe('-9223372036854775808');
    });

    it('never routes a seed through Number', () => {
        expect(BigInt(parseSeedPage(`?seed=${BIG}`).seed)).toBe(8091867987493326313n);
        expect(String(Number(BIG))).not.toBe(BIG);                  // the bug this guards against
    });

    it('hashes anything that is not a decimal, exactly like Minecraft does', () => {
        expect(parseSeedPage('?seed=hello').seed).toBe('99162322');
        expect(parseSeedPage('?seed=hello').seed).toBe(String(seedFromString('hello')));
        expect(parseSeedPage('?seed=12abc').seed).toBe(String(seedFromString('12abc')));
        expect(parseSeedPage('?seed=1.5').seed).toBe(String(seedFromString('1.5')));
    });

    it('parses a decimal the way Minecraft does: canonical within the 64-bit range, hashed beyond it', () => {
        expect(parseSeedPage('?seed=9223372036854775807').seed).toBe('9223372036854775807');
        expect(parseSeedPage('?seed=%2B5').seed).toBe('5');
        expect(parseSeedPage('?seed=007').seed).toBe('7');
        expect(parseSeedPage('?seed=-0').seed).toBe('0');
        expect(parseSeedPage('?seed=9223372036854775808').seed).toBe(String(seedFromString('9223372036854775808')));
        expect(parseSeedPage('?seed=18446744073709551615').seed).toBe(String(seedFromString('18446744073709551615')));
        expect(parseSeedPage('?seed=99999999999999999999').seed).toBe(String(seedFromString('99999999999999999999')));
    });

    it('trims the seed before deciding what it is', () => {
        expect(parseSeedPage('?seed=%2042%20').seed).toBe('42');
    });

    it('picks a random decimal seed when there is none', () => {
        for (const search of ['', '?', '?seed=', '?seed=%20%20', '?version=1.18']) {
            expect(parseSeedPage(search).seed, search).toMatch(/^-?\d+$/);
        }
        // Random, not constant: two parses of an empty query differ (1 in 8.6e9 flake).
        expect(parseSeedPage('').seed).not.toBe(parseSeedPage('').seed);
    });
});

describe('parseSeedPage - version', () => {
    it('resolves a label to its cubiomes int', () => {
        expect(parseSeedPage('?version=1.17').mcVersion).toBe(VERSIONS['1.17']);
        expect(parseSeedPage('?version=26.3').mcVersion).toBe(VERSIONS['26.3']);
    });

    it('resolves a pre-1.0 numeric index', () => {
        expect(parseSeedPage('?version=17').mcVersion).toBe(VERSIONS['1.17']);
        expect(parseSeedPage('?version=16').mcVersion).toBe(VERSIONS['1.16.5']);
    });

    it('falls back to the default for an unknown or missing version', () => {
        for (const search of ['', '?version=', '?version=9.99', '?version=banana', '?version=999']) {
            expect(parseSeedPage(search).mcVersion, search).toBe(VERSIONS[DEFAULT_VERSION]);
        }
    });

    it('round-trips every label in VERSIONS', () => {
        for (const label of Object.keys(VERSIONS)) {
            expect(versionLabelOf(parseSeedPage(`?version=${encodeURIComponent(label)}`).mcVersion)).toBe(label);
        }
    });
});

describe('parseSeedPage - dimension and flags', () => {
    it('accepts only the Nether and the End', () => {
        expect(parseSeedPage('?dim=-1').dimension).toBe(-1);
        expect(parseSeedPage('?dim=1').dimension).toBe(1);
        for (const search of ['?dim=0', '?dim=2', '?dim=nether', '?dim=', '']) {
            expect(parseSeedPage(search).dimension, search).toBe(0);
        }
    });

    it('reports from=legacy and nothing else as a legacy arrival', () => {
        expect(parseSeedPage('?seed=1&from=legacy').fromLegacy).toBe(true);
        expect(parseSeedPage('?seed=1&from=twitter').fromLegacy).toBe(false);
        expect(parseSeedPage('?seed=1').fromLegacy).toBe(false);
    });

    it('ignores unrelated parameters', () => {
        expect(parseSeedPage('?seed=42&version=1.18&utm_source=x')).toEqual({
            seed: '42', mcVersion: VERSIONS['1.18'], dimension: 0, largeBiomes: false, fromLegacy: false, view: {},
        });
    });
});

describe('buildSeedUrl', () => {
    it('writes seed and version, in that order, under /seed/', () => {
        expect(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['1.18'] })).toBe('/seed/?seed=42&version=1.18');
        expect(SEED_PATH).toBe('/seed/');
    });

    it('accepts the version as an int or as the label itself', () => {
        expect(buildSeedUrl({ seed: '42', mcVersion: '1.18' })).toBe(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['1.18'] }));
    });

    it('omits dim for the Overworld and writes it for the Nether and the End', () => {
        expect(buildSeedUrl({ seed: '42', mcVersion: 22, dimension: 0 })).toBe('/seed/?seed=42&version=1.18');
        expect(buildSeedUrl({ seed: '42', mcVersion: 22 })).toBe('/seed/?seed=42&version=1.18');
        expect(buildSeedUrl({ seed: '42', mcVersion: 22, dimension: -1 })).toBe('/seed/?seed=42&version=1.18&dim=-1');
        expect(buildSeedUrl({ seed: '42', mcVersion: 22, dimension: 1 })).toBe('/seed/?seed=42&version=1.18&dim=1');
    });

    it('keeps a 64-bit seed byte-identical', () => {
        expect(buildSeedUrl({ seed: BIG, mcVersion: 35 })).toContain(`seed=${BIG}&`);
        expect(buildSeedUrl({ seed: -9223372036854775808n, mcVersion: 35 })).toContain('seed=-9223372036854775808&');
    });

    it('falls back to the default label for a version int that is not in VERSIONS', () => {
        expect(buildSeedUrl({ seed: '1', mcVersion: 999 })).toBe(`/seed/?seed=1&version=${DEFAULT_VERSION}`);
    });

    it('points a share URL at production, never at the host it was copied from', () => {
        const url = buildSeedUrl({ seed: BIG, mcVersion: 35 }, { absolute: true });
        expect(url.startsWith(`${SITE_URL}/seed/?`)).toBe(true);
        expect(url).toBe(`https://mcseeder.com/seed/?seed=${BIG}&version=26.3`);
        expect(new URL(url).origin).toBe(SITE_URL);
    });

    it('never emits the transient from=legacy flag, which is what strips it', () => {
        expect(buildSeedUrl(parseSeedPage('?seed=42&version=1.17&from=legacy'))).toBe('/seed/?seed=42&version=1.17');
    });
});

describe('world type (world=large)', () => {
    it('is canonical: written right after dim, before the view, only for Large Biomes', () => {
        expect(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['1.18'], largeBiomes: true })).toBe('/seed/?seed=42&version=1.18&world=large');
        expect(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['1.18'], dimension: -1, largeBiomes: true }, { view: { ...DEFAULT_VIEW, slime: true } }))
            .toBe('/seed/?seed=42&version=1.18&dim=-1&world=large&slime=1');
        expect(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['1.18'], largeBiomes: false })).toBe('/seed/?seed=42&version=1.18');
    });

    it('does not exist before 1.3: neither written nor read', () => {
        expect(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['1.2'], largeBiomes: true })).toBe('/seed/?seed=42&version=1.2');
        expect(buildSeedUrl({ seed: '42', mcVersion: VERSIONS['Beta 1.7'], largeBiomes: true })).toBe('/seed/?seed=42&version=Beta+1.7');
        expect(parseSeedPage('?seed=42&version=1.2&world=large').largeBiomes).toBe(false);
        expect(parseSeedPage('?seed=42&version=1.3&world=large').largeBiomes).toBe(true);
    });

    it('reads only world=large; anything else is Default', () => {
        expect(parseSeedPage('?seed=42&version=26.3&world=large').largeBiomes).toBe(true);
        for (const q of ['', '&world=', '&world=LARGE', '&world=amplified', '&world=1']) {
            expect(parseSeedPage(`?seed=42&version=26.3${q}`).largeBiomes, q).toBe(false);
        }
    });
});

describe('round trip', () => {
    it.each([
        { seed: '42', mcVersion: VERSIONS['1.18'], dimension: 0, largeBiomes: false },
        { seed: BIG, mcVersion: VERSIONS['26.3'], dimension: 0, largeBiomes: false },
        { seed: '-98765', mcVersion: VERSIONS['1.17'], dimension: -1, largeBiomes: false },
        { seed: '0', mcVersion: VERSIONS['Beta 1.7'], dimension: 1, largeBiomes: false },
        { seed: '42', mcVersion: VERSIONS['1.16.5'], dimension: 0, largeBiomes: true },
        { seed: BIG, mcVersion: VERSIONS['26.3'], dimension: -1, largeBiomes: true },
    ])('parse(build($seed, $mcVersion, $dimension)) is the same state', (state) => {
        const { fromLegacy, view, ...parsed } = parseSeedPage(new URL(buildSeedUrl(state), 'http://x').search);
        expect(parsed).toEqual(state);
        expect(fromLegacy).toBe(false);
        expect(view).toEqual({});
    });

    it('survives the absolute form too', () => {
        const state = { seed: BIG, mcVersion: VERSIONS['1.19.2'], dimension: 1, largeBiomes: false };
        const { fromLegacy, view, ...parsed } = parseSeedPage(new URL(buildSeedUrl(state, { absolute: true })).search);
        expect(parsed).toEqual(state);
    });
});

// The view params: the seed page writes them into its address bar and Share box, and reads them once at load.
const W = { seed: '42', mcVersion: VERSIONS['1.21.11'], dimension: 0 };
const viewOf = (url) => parseSeedPage(new URL(url, 'http://x').search).view;
const withView = (view) => buildSeedUrl(W, { view: { ...DEFAULT_VIEW, ...view } });

describe('buildSeedUrl without a view is the canonical URL, unchanged', () => {
    // Every URL this module wrote before the view params existed, byte for byte: the
    // address bar, saved worlds, finder links and the legacy redirect go through here.
    it.each([
        [{ seed: '42', mcVersion: VERSIONS['1.18'] }, {}, '/seed/?seed=42&version=1.18'],
        [{ seed: '42', mcVersion: '1.18', dimension: -1 }, {}, '/seed/?seed=42&version=1.18&dim=-1'],
        [{ seed: '42', mcVersion: 22, dimension: 1 }, {}, '/seed/?seed=42&version=1.18&dim=1'],
        [{ seed: BIG, mcVersion: 35 }, { absolute: true }, `https://mcseeder.com/seed/?seed=${BIG}&version=26.3`],
        [{ seed: '-9223372036854775808', mcVersion: VERSIONS['Beta 1.7'] }, {}, '/seed/?seed=-9223372036854775808&version=Beta+1.7'],
        [{ seed: '1', mcVersion: 999 }, {}, `/seed/?seed=1&version=${DEFAULT_VERSION}`],
    ])('%o %o', (state, options, url) => {
        expect(buildSeedUrl(state, options)).toBe(url);
        expect(buildSeedUrl(state, { ...options, view: null })).toBe(url);
    });

    it('drops view params and from= when no view is passed (saved worlds, finder links, the legacy redirect)', () => {
        const parsed = parseSeedPage('?seed=42&version=1.21.11&structs=5,11&coords=0&slime=1&grid=1&y=62&from=legacy');
        expect(buildSeedUrl(parsed)).toBe('/seed/?seed=42&version=1.21.11');
    });
});

describe('buildSeedUrl with a view', () => {
    it('writes nothing more for the default view', () => {
        expect(withView({})).toBe('/seed/?seed=42&version=1.21.11');
        expect(buildSeedUrl(W, { view: {} })).toBe('/seed/?seed=42&version=1.21.11');
    });

    it('writes each non-default value, after the canonical params', () => {
        expect(withView({ structures: [5, 11] })).toBe('/seed/?seed=42&version=1.21.11&structs=5,11');
        expect(withView({ showCoords: false })).toBe('/seed/?seed=42&version=1.21.11&coords=0');
        expect(withView({ slime: true })).toBe('/seed/?seed=42&version=1.21.11&slime=1');
        expect(withView({ grid: true })).toBe('/seed/?seed=42&version=1.21.11&grid=1');
        expect(withView({ yHeight: 62 })).toBe('/seed/?seed=42&version=1.21.11&y=62');
        expect(withView({ yHeight: DEFAULT_VIEW.yHeight })).toBe('/seed/?seed=42&version=1.21.11');
    });

    it('writes all of them in one fixed order, whatever order the view object has', () => {
        const url = '/seed/?seed=42&version=1.21.11&dim=-1&structs=18,19&coords=0&slime=1&grid=1&y=-70';
        expect(buildSeedUrl({ ...W, dimension: -1 }, { view: { yHeight: -70, grid: true, slime: true, showCoords: false, structures: [18, 19] } })).toBe(url);
        expect(buildSeedUrl({ ...W, dimension: -1 }, { absolute: true, view: { structures: [18, 19], showCoords: false, slime: true, grid: true, yHeight: -70 } }))
            .toBe(`https://mcseeder.com${url}`);
    });

    it('keeps the structures in pick order, with literal commas', () => {
        expect(withView({ structures: [11, 5, 9] })).toContain('&structs=11,5,9');
        expect(withView({ structures: [11, 5, 9] })).not.toContain('%2C');
    });

    it('leaves the height out before 1.18, where it has no effect and no control', () => {
        expect(buildSeedUrl({ ...W, mcVersion: VERSIONS['1.17'] }, { view: { ...DEFAULT_VIEW, yHeight: 62, slime: true } }))
            .toBe('/seed/?seed=42&version=1.17&slime=1');
        expect(buildSeedUrl({ ...W, mcVersion: '1.16.5' }, { view: { ...DEFAULT_VIEW, yHeight: 62 } })).toBe('/seed/?seed=42&version=1.16.5');
        expect(buildSeedUrl({ ...W, mcVersion: VERSIONS['1.18'] }, { view: { ...DEFAULT_VIEW, yHeight: 62 } })).toBe('/seed/?seed=42&version=1.18&y=62');
    });
});

describe('parseSeedPage - view', () => {
    it('sets only the keys the URL carries', () => {
        expect(parseSeedPage('?seed=1&version=1.21.11').view).toEqual({});
        expect(parseSeedPage('?seed=1&structs=5,11').view).toEqual({ structures: [5, 11] });
        expect(parseSeedPage('?seed=1&coords=0').view).toEqual({ showCoords: false });
        expect(parseSeedPage('?seed=1&slime=1').view).toEqual({ slime: true });
        expect(parseSeedPage('?seed=1&grid=1').view).toEqual({ grid: true });
        expect(parseSeedPage('?seed=1&y=62').view).toEqual({ yHeight: 62 });
    });

    it('tells an empty structs= (none shown) from an absent one (the default)', () => {
        expect(parseSeedPage('?seed=1&structs=').view).toEqual({ structures: [] });
        expect(parseSeedPage('?seed=1').view).not.toHaveProperty('structures');
    });

    it('drops unknown structure ids and duplicates, keeping the order', () => {
        expect(parseSeedPage('?structs=abc,999').view).toEqual({ structures: [] });
        expect(parseSeedPage('?structs=11,5,11,,-3,5.5,27,0,9').view).toEqual({ structures: [11, 5, 9] });
        expect(parseSeedPage('?structs=%205%20').view).toEqual({ structures: [5] });
    });

    it('accepts every structure the controls offer', () => {
        const ids = STRUCTURES_OPTIONS.map((o) => o.value);
        expect(parseSeedPage(`?structs=${ids.join(',')}`).view.structures).toEqual(ids);
    });

    it('turns an option on or off only with its exact value', () => {
        for (const junk of ['true', 'yes', '2', '', 'on', '01']) {
            expect(parseSeedPage(`?slime=${junk}&grid=${junk}`).view, junk).toEqual({});
        }
        for (const junk of ['false', 'no', '1', '', 'off', '00']) {
            expect(parseSeedPage(`?coords=${junk}`).view, junk).toEqual({});
        }
        // The defaults written out are no-ops: slime=0 is off, coords=1 is on.
        expect(parseSeedPage('?slime=0&grid=0&coords=1').view).toEqual({});
    });

    it('accepts only a height the select offers', () => {
        for (const { value } of HEIGHT_OPTIONS) expect(parseSeedPage(`?y=${value}`).view).toEqual({ yHeight: value });
        for (const junk of ['9999', '64', '-64', '62.0', '6e1', 'sea', '', '0x3e']) {
            expect(parseSeedPage(`?y=${junk}`).view, junk).toEqual({});
        }
    });

    it('never throws on junk', () => {
        expect(() => parseSeedPage('?structs=%%%&y=%&slime=%ZZ')).not.toThrow();
        expect(parseSeedPage('?seed=1&structs=abc,999&y=9999&slime=true&grid=yes&coords=off').view).toEqual({ structures: [] });
    });
});

describe('view round trip', () => {
    it.each([
        { structures: [5] },
        { structures: [11, 5] },
        { showCoords: false },
        { slime: true },
        { grid: true },
        { yHeight: 62 },
        { yHeight: -70 },
        { structures: [5, 11, 18], showCoords: false, slime: true, grid: true, yHeight: 320 },
    ])('parse(build(%o)) gives the same view', (view) => {
        expect(viewOf(withView(view))).toEqual(view);
        expect(viewOf(buildSeedUrl(W, { absolute: true, view: { ...DEFAULT_VIEW, ...view } }))).toEqual(view);
    });

    it('keeps the canonical state alongside the view', () => {
        const state = { seed: BIG, mcVersion: VERSIONS['26.3'], dimension: 1, largeBiomes: true };
        const { fromLegacy, view, ...parsed } = parseSeedPage(new URL(buildSeedUrl(state, { view: { ...DEFAULT_VIEW, structures: [21], grid: true } }), 'http://x').search);
        expect(parsed).toEqual(state);
        expect(view).toEqual({ structures: [21], grid: true });
    });
});
