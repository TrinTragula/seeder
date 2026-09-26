// The seed finder must keep finding the newest content: that is what breaks on a version
// update (see UPDATING.MD). Calls the Seeder class directly, as worker.js does, and reads
// the SEED_FOUND messages it posts. Older versions, other dimensions, accounting and error
// codes have their own cases in multi.test.js.
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness } from './harness.js';
import { VERSIONS, BIOMES, STRUCTURES_OPTIONS } from '../../src/util/constants';

const newestMc = Math.max(...Object.values(VERSIONS));
const newestBiome = BIOMES.reduce((a, b) => (b.value > a.value ? b : a));
const newestStructure = STRUCTURES_OPTIONS.reduce((a, b) => (b.value > a.value ? b : a));
const SEEDS = ['8091867987493326313', '12345', '777111', '246810', '13571113'];
const FORTRESS = 18;

let w, seeder;
beforeAll(async () => {
    w = await createWorkerHarness();
    seeder = w.seeder;
});

const has = (mc, seed, dim, y, biomeId, cells) => Array.from(seeder.getArea(mc, seed, -cells, -cells, 2 * cells, 2 * cells, dim, y).ids).includes(biomeId);
// Run one search on the Seeder class and return its result with the hits it posted.
const search = (criteria) => {
    w.clear();
    const result = seeder.findSeeds(criteria);
    return { result, found: w.drain('SEED_FOUND').map((m) => m.data) };
};
const viable = (mc, type, seed, dim, range) => {
    const { regionBlocks } = seeder.getVersionSupport(mc, [], [type]);
    return seeder.getStructuresInRegions(mc, type, seed, Math.ceil(range / regionBlocks[type]) + 1, dim).map((c) => Array.from(c));
};

describe(`newest content (${newestBiome.label}, ${newestStructure.pureText})`, () => {
    it(`findSeeds finds ${newestBiome.label} within ±300 blocks`, () => {
        // Cave biomes never show at Y=320: search at the first Y where the biome appears in the sample seeds.
        const y = [320, 0].find((yy) => SEEDS.some((s) => has(newestMc, s, 0, yy, newestBiome.value, 75))) ?? 320;
        const { result, found } = search({ mcVersion: newestMc, dimension: 0, yHeight: y, biomes: [newestBiome.value], structures: [], rangeBlocks: 300, startingSeed: '1', maxSeedsToScan: 1000, maxResults: 1 });
        expect(result).toMatchObject({ hits: 1, error: null });
        expect(found).toHaveLength(1);
        expect(typeof found[0].seed).toBe('bigint');
        expect(has(newestMc, found[0].seed, 0, y, newestBiome.value, 75)).toBe(true);
    });

    it(`findSeeds finds ${newestStructure.pureText} within 600 blocks, at a position the engine calls viable`, () => {
        const support = seeder.getVersionSupport(newestMc, [], [newestStructure.value]);
        const dim = support.structures[newestStructure.value];
        expect(dim, `${newestStructure.pureText} unsupported on the newest version`).not.toBe(-100);
        const { result, found } = search({ mcVersion: newestMc, dimension: dim, yHeight: 256, biomes: [], structures: [newestStructure.value], rangeBlocks: 600, startingSeed: '5000', maxSeedsToScan: 50_000, maxResults: 1 });
        expect(result).toMatchObject({ hits: 1, error: null });
        const [{ type, x, z }] = found[0].structures;
        expect(type).toBe(newestStructure.value);
        expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(600);
        expect(viable(newestMc, type, found[0].seed, dim, 600)).toContainEqual([x, z]);
    });
});

describe('older generation eras', () => {
    it('1.16.5: a Fortress in the Nether within 600 blocks', () => {
        const mc = VERSIONS['1.16.5'];
        const { result, found } = search({ mcVersion: mc, dimension: -1, yHeight: 256, biomes: [], structures: [FORTRESS], rangeBlocks: 600, startingSeed: '1', maxSeedsToScan: 50_000, maxResults: 1 });
        expect(result).toMatchObject({ hits: 1, error: null });
        const [{ x, z }] = found[0].structures;
        expect(viable(mc, FORTRESS, found[0].seed, -1, 600)).toContainEqual([x, z]);
    });

    it('1.18: Plains near the origin on the first noise generator', () => {
        const mc = VERSIONS['1.18'];
        const { result, found } = search({ mcVersion: mc, dimension: 0, yHeight: 256, biomes: [1], structures: [], rangeBlocks: 100, startingSeed: '7', maxSeedsToScan: 1000, maxResults: 1 });
        expect(result).toMatchObject({ hits: 1, error: null });
        expect(has(mc, found[0].seed, 0, 256, 1, 25)).toBe(true);
    });
});
