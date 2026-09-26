// find_seeds' "any of" and "none of" biome lists, against the real engine. Every hit is
// re-checked on the biome map itself: the same box, at the same Y, cell by cell, which is
// what the finder promises ("Checked at the biome height below, inside the whole range").
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness } from './harness.js';
import { VERSIONS, BIOMES, STRUCTURES_OPTIONS } from '../../src/util/constants';

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const VILLAGE = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Village').value;
// Every oceanic BiomeID (cubiomes/biomes.h): ocean, frozen, deep, warm, lukewarm, cold and their deep variants.
const OCEANS = [0, 10, 24, 44, 45, 46, 47, 48, 49, 50];
const PLAINS = biome('Plains');
const SNOWY = [biome('Snowy Plains'), biome('Ice Spikes')];
const TIMEOUT = 120_000;

let w, seeder;
beforeAll(async () => {
    w = await createWorkerHarness();
    seeder = w.seeder;
});

const search = (criteria) => {
    w.clear();
    const result = seeder.findSeeds({ dimension: 0, yHeight: 256, biomes: [], anyBiomes: [], excludeBiomes: [], structures: [], startingSeed: '1', ...criteria });
    return { result, found: w.drain('SEED_FOUND').map((m) => m.data) };
};
// The biome ids in the searched box [-range, +range]² at Y, as the map draws them.
const boxBiomes = (mc, seed, dim, y, range) => {
    const cells = Math.ceil(range / 4);
    return new Set(seeder.getArea(mc, seed, -cells, -cells, 2 * cells, 2 * cells, dim, y).ids);
};
const oceansOf = (mc) => seeder.getVersionSupport(mc, OCEANS, []).biomes;

describe('avoid these biomes', () => {
    for (const [label, y] of [['1.21.1', 62], ['1.16.5', 256]]) {
        it(`${label}: Plains with no ocean of any kind in the box - every hit, every cell`, () => {
            const mc = VERSIONS[label];
            const oceans = oceansOf(mc);
            const { result, found } = search({ mcVersion: mc, yHeight: y, biomes: [PLAINS], excludeBiomes: oceans, rangeBlocks: 100, maxSeedsToScan: 2000, maxResults: 3 });
            expect(result).toMatchObject({ hits: 3, error: null });
            for (const { seed } of found) {
                const ids = boxBiomes(mc, seed, 0, y, 100);
                expect(ids.has(PLAINS), String(seed)).toBe(true);
                expect(oceans.filter((id) => ids.has(id)), String(seed)).toEqual([]);
            }
        }, TIMEOUT);
    }

    it('1.21.1: the acceptance search - Plains, avoid Ocean + Deep Ocean, 300 blocks', () => {
        const mc = VERSIONS['1.21.1'];
        const { result, found } = search({ mcVersion: mc, yHeight: 62, biomes: [PLAINS], excludeBiomes: [0, 24], rangeBlocks: 300, maxSeedsToScan: 200, maxResults: 2 });
        expect(result).toMatchObject({ hits: 2, error: null });
        for (const { seed } of found) {
            const ids = boxBiomes(mc, seed, 0, 62, 300);
            expect(ids.has(PLAINS) && !ids.has(0) && !ids.has(24), String(seed)).toBe(true);
        }
    }, TIMEOUT);

    it('an avoid list is a criterion on its own, in the Nether too', () => {
        const mc = VERSIONS['1.21.1'];
        const wastes = biome('Nether Wastes');
        const { result, found } = search({ mcVersion: mc, dimension: -1, excludeBiomes: [wastes], rangeBlocks: 100, maxSeedsToScan: 2000, maxResults: 2 });
        expect(result).toMatchObject({ hits: 2, error: null });
        for (const { seed } of found) expect(boxBiomes(mc, seed, -1, 256, 100).has(wastes), String(seed)).toBe(false);
    }, TIMEOUT);

    it('with a structure: the biome check still runs after the structures are placed', () => {
        const mc = VERSIONS['1.21.1'];
        const oceans = oceansOf(mc);
        const { result, found } = search({ mcVersion: mc, yHeight: 62, structures: [VILLAGE], excludeBiomes: oceans, rangeBlocks: 150, maxSeedsToScan: 20_000, maxResults: 2 });
        expect(result).toMatchObject({ hits: 2, error: null });
        for (const { seed, structures } of found) {
            expect(structures[0].type).toBe(VILLAGE);
            expect(oceans.filter((id) => boxBiomes(mc, seed, 0, 62, 150).has(id)), String(seed)).toEqual([]);
        }
    }, TIMEOUT);
});

describe('any of these biomes', () => {
    for (const label of ['1.21.1', '1.16.5']) {
        it(`${label}: every hit has at least one of Snowy Plains, Ice Spikes`, () => {
            const mc = VERSIONS[label];
            const { result, found } = search({ mcVersion: mc, anyBiomes: SNOWY, rangeBlocks: 100, maxSeedsToScan: 5000, maxResults: 3 });
            expect(result).toMatchObject({ hits: 3, error: null });
            for (const { seed } of found) {
                const ids = boxBiomes(mc, seed, 0, 256, 100);
                expect(SNOWY.some((id) => ids.has(id)), String(seed)).toBe(true);
            }
        }, TIMEOUT);
    }

    it('an any-of list of one biome finds exactly what requiring it finds', () => {
        const mc = VERSIONS['1.16.5'];
        const run = (criteria) => search({ mcVersion: mc, rangeBlocks: 100, maxSeedsToScan: 3000, maxResults: 1e9, ...criteria }).found.map((f) => String(f.seed));
        const required = run({ biomes: [SNOWY[0]] });
        expect(required.length).toBeGreaterThan(0);
        expect(run({ anyBiomes: [SNOWY[0]] })).toEqual(required);
    }, TIMEOUT);
});

describe('argument errors', () => {
    const mc = VERSIONS['1.21.1'];
    const base = { mcVersion: mc, rangeBlocks: 100, maxSeedsToScan: 10, maxResults: 1 };
    const code = (criteria) => search({ ...base, ...criteria }).result.error?.code ?? null;

    it('a biome both wanted and avoided -> -7, in either wanted list', () => {
        expect(code({ biomes: [PLAINS], excludeBiomes: [0, PLAINS] })).toBe(-7);
        expect(code({ anyBiomes: [...SNOWY, 0], excludeBiomes: [0] })).toBe(-7);
        // Wanted in both "all of" and "any of" is redundant, not contradictory.
        expect(code({ biomes: [PLAINS], anyBiomes: [PLAINS, SNOWY[0]] })).toBeNull();
    });

    it('an avoided or alternative biome outside the dimension or the version -> -6', () => {
        expect(code({ excludeBiomes: [biome('Crimson Forest')] })).toBe(-6);
        expect(code({ anyBiomes: [PLAINS, biome('The End')] })).toBe(-6);
        expect(code({ mcVersion: VERSIONS['1.16.5'], excludeBiomes: [biome('Cherry Grove')] })).toBe(-6);
        // the_void (127) would make setupBiomeFilter exit(): refused before it.
        expect(code({ excludeBiomes: [127] })).toBe(-6);
    });

    it('all lists empty -> -7; the lists are capped at 32 / 32 / 64', () => {
        expect(code({})).toBe(-7);
        const overworld = seeder.getVersionSupport(mc, BIOMES.map((b) => b.value), []);
        const land = overworld.biomes.filter((id) => overworld.biomeDimensions[id] === 0 && !OCEANS.includes(id) && !(id & ~0xbf));
        expect(land.length).toBeGreaterThan(32);
        expect(code({ anyBiomes: land.slice(0, 33) })).toBe(-7);
        expect(code({ anyBiomes: land.slice(0, 32) })).toBeNull();
        expect(code({ excludeBiomes: land })).toBeNull();
        expect(code({ excludeBiomes: new Array(65).fill(PLAINS) })).toBe(-7);
    });
});
