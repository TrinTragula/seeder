// The finder's URL contract. Every shared search and every preset link is
// built here, so a change that breaks a pasted link has to break one of these first.
import { describe, it, expect } from 'vitest';
import { FINDER_PATH, buildFinderUrl, parseFinderUrl, parseSeed64 } from './finderUrl';
import { SITE_URL } from './seedUrl';
import { VERSIONS } from '../util/constants';
import { DEFAULT_CRITERIA } from '../pages/finder/criteria';

const BIG = '8091867987493326313';          // 19 digits: Number would round it

describe('parseFinderUrl', () => {
    it('reads every parameter', () => {
        const { criteria, seeds, start } = parseFinderUrl(
            `?version=1.21.11&dim=-1&biomes=185,132&any=12,140&exclude=0,24&structures=5,11&range=750&y=62&count=25&start=${BIG}&seeds=1,-2,${BIG}`);
        expect(criteria).toEqual({
            mcVersion: VERSIONS['1.21.11'], dimension: -1, largeBiomes: false, yHeight: 62, biomes: [185, 132], anyBiomes: [12, 140], excludeBiomes: [0, 24], structures: [5, 11],
            rangeBlocks: 750, count: 25, startingSeed: BigInt(BIG),
        });
        expect(start).toBe(BigInt(BIG));
        expect(seeds).toEqual(['1', '-2', BIG]);
    });

    it('gives the defaults for an empty query', () => {
        expect(parseFinderUrl('')).toEqual({ criteria: DEFAULT_CRITERIA, seeds: null, start: 0n });
    });

    it('drops malformed ints and falls back to the defaults, never throwing', () => {
        const { criteria, start } = parseFinderUrl('?range=abc&y=1e3&count=ten&dim=nether&start=12x&biomes=a,,1.5');
        expect(criteria).toEqual(DEFAULT_CRITERIA);
        expect(start).toBe(0n);
        expect(() => parseFinderUrl('?start=%&biomes=%E0')).not.toThrow();
    });

    it('drops unknown biome / structure ids and duplicates, keeping the order', () => {
        const { criteria } = parseFinderUrl('?biomes=185,999,1,185,176&structures=5,12,5,-3,22');
        expect(criteria.biomes).toEqual([185, 1]);          // 999 and 176 are no BiomeID in BIOMES
        expect(criteria.structures).toEqual([5, 22]);       // 12 (Ruined_Portal_N) is not offered
    });

    it('reads any= and exclude= like biomes=: unknown ids and duplicates dropped, order kept', () => {
        const { criteria } = parseFinderUrl('?any=140,999,12,140&exclude=24,x,0,176,24');
        expect(criteria.anyBiomes).toEqual([140, 12]);
        expect(criteria.excludeBiomes).toEqual([24, 0]);
    });

    it('keeps links made before any= / exclude= working: both lists empty', () => {
        const { criteria } = parseFinderUrl('?version=1.21.11&biomes=1&range=300');
        expect(criteria).toMatchObject({ biomes: [1], anyBiomes: [], excludeBiomes: [] });
    });

    it('resolves versions: labels, legacy numeric indexes, unknown -> default', () => {
        expect(parseFinderUrl('?version=1.12').criteria.mcVersion).toBe(VERSIONS['1.12']);
        expect(parseFinderUrl('?version=17').criteria.mcVersion).toBe(VERSIONS['1.17']);
        expect(parseFinderUrl('?version=Beta%201.7').criteria.mcVersion).toBe(VERSIONS['Beta 1.7']);
        for (const v of ['9.99', 'banana', '999', '']) {
            expect(parseFinderUrl(`?version=${v}`).criteria.mcVersion, v).toBe(DEFAULT_CRITERIA.mcVersion);
        }
    });

    it('keeps 19-digit seeds exactly and drops junk', () => {
        expect(parseFinderUrl(`?seeds=${BIG},abc,,1.5,-9223372036854775808,99999999999999999999999`).seeds)
            .toEqual([BIG, '-9223372036854775808']);
        expect(parseFinderUrl('?seeds=18446744073709551615,9223372036854775808').seeds)
            .toEqual(['-1', '-9223372036854775808']);
        expect(parseFinderUrl('?seeds=').seeds).toBeNull();
        expect(parseFinderUrl('?seeds=x,y').seeds).toBeNull();
    });

    it('parses start as a BigInt beyond 2^53', () => {
        const { start, criteria } = parseFinderUrl('?start=9007199254740993');
        expect(start).toBe(9007199254740993n);
        expect(criteria.startingSeed).toBe(9007199254740993n);
        expect(parseFinderUrl('?start=-42').start).toBe(-42n);
    });

    it('folds an unsigned start to the signed seed and drops one outside 64 bits', () => {
        expect(parseFinderUrl('?start=18446744073709551615').start).toBe(-1n);
        expect(parseFinderUrl('?start=18446744073709551615').criteria.startingSeed).toBe(-1n);
        expect(parseFinderUrl('?start=18446744073709551616').start).toBe(0n);
        expect(parseFinderUrl('?start=-9223372036854775809').start).toBe(0n);
    });

    it('falls back to the default count for a negative one', () => {
        expect(parseFinderUrl('?count=-10').criteria.count).toBe(DEFAULT_CRITERIA.count);
        expect(parseFinderUrl('?count=-1').criteria.count).toBe(DEFAULT_CRITERIA.count);
    });

    it('bounds the numbers: count 7 -> 10, dim 5 -> 0, range 9000 -> 300, y out of range -> 256', () => {
        expect(parseFinderUrl('?count=7').criteria.count).toBe(10);
        expect(parseFinderUrl('?dim=5').criteria.dimension).toBe(0);
        expect(parseFinderUrl('?range=9000').criteria.rangeBlocks).toBe(300);
        expect(parseFinderUrl('?range=0').criteria.rangeBlocks).toBe(300);
        expect(parseFinderUrl('?range=2048').criteria.rangeBlocks).toBe(2048);
        expect(parseFinderUrl('?range=1').criteria.rangeBlocks).toBe(1);
        expect(parseFinderUrl('?range=2049').criteria.rangeBlocks).toBe(300);
        expect(parseFinderUrl('?y=320').criteria.yHeight).toBe(320);
        expect(parseFinderUrl('?y=321').criteria.yHeight).toBe(256);
        expect(parseFinderUrl('?y=400').criteria.yHeight).toBe(256);
        expect(parseFinderUrl('?y=-64').criteria.yHeight).toBe(-64);
        // HEIGHT_OPTIONS' "Bedrock (Y=-64)" is -70: it must survive a round trip.
        expect(parseFinderUrl('?y=-70').criteria.yHeight).toBe(-70);
        expect(parseFinderUrl('?y=-71').criteria.yHeight).toBe(256);
    });
});

describe('buildFinderUrl', () => {
    it('writes every parameter in the fixed order, lists with plain commas', () => {
        const url = buildFinderUrl(
            { ...DEFAULT_CRITERIA, biomes: [185, 132], structures: [5, 11], count: 25 }, { seeds: ['1', BIG], start: 7n });
        expect(url).toBe(`/finder/?version=26.3&dim=0&range=300&y=256&count=25&start=7&biomes=185,132&structures=5,11&seeds=1,${BIG}`);
    });

    it('omits empty biomes, structures and seeds, never the rest', () => {
        expect(buildFinderUrl(DEFAULT_CRITERIA)).toBe('/finder/?version=26.3&dim=0&range=300&y=256&count=10&start=0');
    });

    it('takes the start from the criteria unless given', () => {
        expect(buildFinderUrl({ ...DEFAULT_CRITERIA, startingSeed: BigInt(BIG) })).toContain(`&start=${BIG}`);
        expect(buildFinderUrl({ ...DEFAULT_CRITERIA, startingSeed: 5n }, { start: 0n })).toContain('&start=0');
    });

    it('prefixes the production site when absolute', () => {
        expect(buildFinderUrl(DEFAULT_CRITERIA, { absolute: true })).toBe(`${SITE_URL}${FINDER_PATH}?version=26.3&dim=0&range=300&y=256&count=10&start=0`);
        expect(FINDER_PATH).toBe('/finder/');
    });

    it('writes any= and exclude= after biomes=, only when they are not empty', () => {
        const url = buildFinderUrl({ ...DEFAULT_CRITERIA, biomes: [14], anyBiomes: [12, 140], excludeBiomes: [0, 24] });
        expect(url).toBe('/finder/?version=26.3&dim=0&range=300&y=256&count=10&start=0&biomes=14&any=12,140&exclude=0,24');
        expect(buildFinderUrl({ ...DEFAULT_CRITERIA, excludeBiomes: [0] })).toBe('/finder/?version=26.3&dim=0&range=300&y=256&count=10&start=0&exclude=0');
    });

    it('writes world=large right after dim, only for a Large Biomes search from 1.3', () => {
        const large = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['1.21.1'], largeBiomes: true };
        expect(buildFinderUrl(large)).toBe('/finder/?version=1.21.1&dim=0&world=large&range=300&y=256&count=10&start=0');
        expect(buildFinderUrl({ ...large, largeBiomes: false })).toBe('/finder/?version=1.21.1&dim=0&range=300&y=256&count=10&start=0');
        expect(buildFinderUrl({ ...large, mcVersion: VERSIONS['1.2'] })).not.toContain('world=');
        expect(parseFinderUrl('?version=1.21.1&world=large').criteria.largeBiomes).toBe(true);
        expect(parseFinderUrl('?version=1.2&world=large').criteria.largeBiomes).toBe(false);
        expect(parseFinderUrl('?version=1.21.1&world=default').criteria.largeBiomes).toBe(false);
        // Links from before world types: Default.
        expect(parseFinderUrl('?version=1.21.1&dim=0&range=300').criteria.largeBiomes).toBe(false);
    });

    it('writes an unsigned start back as its signed seed after a parse', () => {
        const { criteria } = parseFinderUrl('?start=18446744073709551615&dim=-1');
        expect(buildFinderUrl(criteria)).toBe('/finder/?version=26.3&dim=-1&range=300&y=256&count=10&start=-1');
    });

    it('round-trips: parse(build(x)) equals x', () => {
        const states = [
            { criteria: DEFAULT_CRITERIA, seeds: null, start: 0n },
            {
                criteria: { mcVersion: VERSIONS['Beta 1.7'], dimension: 1, largeBiomes: false, yHeight: -70, biomes: [9], anyBiomes: [40, 42], excludeBiomes: [41], structures: [21, 22], rangeBlocks: 2048, count: 50, startingSeed: -(2n ** 63n) },
                seeds: [BIG, '-1'], start: -(2n ** 63n),
            },
            {
                criteria: { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['1.16.5'], dimension: -1, structures: [18, 19], rangeBlocks: 1, startingSeed: 2n ** 60n },
                seeds: null, start: 2n ** 60n,
            },
            {
                criteria: { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['1.12'], largeBiomes: true, biomes: [21] },
                seeds: null, start: 0n,
            },
        ];
        for (const x of states) {
            const url = buildFinderUrl(x.criteria, { seeds: x.seeds, start: x.start });
            expect(parseFinderUrl(url.slice(url.indexOf('?'))), url).toEqual(x);
        }
    });
});

describe('parseSeed64', () => {
    it('accepts signed and unsigned 64-bit decimals only, folding the unsigned form to the signed seed', () => {
        expect(parseSeed64(BIG)).toBe(BigInt(BIG));
        expect(parseSeed64(' -1 ')).toBe(-1n);
        expect(parseSeed64('9223372036854775807')).toBe(2n ** 63n - 1n);
        expect(parseSeed64('-9223372036854775808')).toBe(-(2n ** 63n));
        expect(parseSeed64('9223372036854775808')).toBe(-(2n ** 63n));
        expect(parseSeed64('18446744073709551615')).toBe(-1n);
        expect(parseSeed64('18446744073709551616')).toBeNull();
        expect(parseSeed64('-9223372036854775809')).toBeNull();
        for (const junk of ['', '1.5', 'abc', '1e3', null, undefined]) expect(parseSeed64(junk)).toBeNull();
    });
});
