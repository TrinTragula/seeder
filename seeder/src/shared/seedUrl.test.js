// The one URL contract of the seed page. Every share link, the address
// bar and the legacy redirect are built here, so a change that breaks a pre-1.0
// bookmark has to break one of these cases first.
import { describe, it, expect } from 'vitest';
import { SEED_PATH, SITE_URL, buildSeedUrl, parseSeedPage, versionLabelOf } from './seedUrl';
import { DEFAULT_VERSION, seedFromString } from '../util/seed';
import { VERSIONS } from '../util/constants';

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
            seed: '42', mcVersion: VERSIONS['1.18'], dimension: 0, fromLegacy: false,
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

describe('round trip', () => {
    it.each([
        { seed: '42', mcVersion: VERSIONS['1.18'], dimension: 0 },
        { seed: BIG, mcVersion: VERSIONS['26.3'], dimension: 0 },
        { seed: '-98765', mcVersion: VERSIONS['1.17'], dimension: -1 },
        { seed: '0', mcVersion: VERSIONS['Beta 1.7'], dimension: 1 },
    ])('parse(build($seed, $mcVersion, $dimension)) is the same state', (state) => {
        const { fromLegacy, ...parsed } = parseSeedPage(new URL(buildSeedUrl(state), 'http://x').search);
        expect(parsed).toEqual(state);
        expect(fromLegacy).toBe(false);
    });

    it('survives the absolute form too', () => {
        const state = { seed: BIG, mcVersion: VERSIONS['1.19.2'], dimension: 1 };
        const { fromLegacy, ...parsed } = parseSeedPage(new URL(buildSeedUrl(state, { absolute: true })).search);
        expect(parsed).toEqual(state);
    });
});
