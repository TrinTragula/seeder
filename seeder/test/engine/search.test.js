// The seed finders: each search must return a seed that really satisfies the criteria.
// Newest content first (that is what breaks on a version update), then an old version
// and the Nether, since the search paths differ per generation era and dimension.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadSeeder } from './harness.js';
import { VERSIONS, BIOMES, STRUCTURES_OPTIONS } from '../../src/util/constants';

const newestMc = Math.max(...Object.values(VERSIONS));
const newestBiome = BIOMES.reduce((a, b) => (b.value > a.value ? b : a));
const newestStructure = STRUCTURES_OPTIONS.reduce((a, b) => (b.value > a.value ? b : a));
const AREA = [-64, -64, 128, 128];
const SEEDS = ['8091867987493326313', '12345', '777111', '246810', '13571113'];
const VILLAGE = 5, FORTRESS = 18, PLAINS = 1;

let seeder;
beforeAll(async () => { seeder = await loadSeeder(); });

const has = (mc, seed, dim, y, biomeId, [x, z, w, h] = AREA) => Array.from(seeder.getArea(mc, seed, x, z, w, h, dim, y).ids).includes(biomeId);
const within = (coords, range) => coords.some(([x, z]) => Math.abs(x) <= range && Math.abs(z) <= range);

describe(`newest content (${newestBiome.label}, ${newestStructure.pureText})`, () => {
    it(`find_biomes returns a seed whose area contains ${newestBiome.label}`, () => {
        // Cave biomes never show at Y=320: search at the first Y where the biome appears in the sample seeds.
        const y = [320, 0].find((yy) => SEEDS.some((s) => has(newestMc, s, 0, yy, newestBiome.value))) ?? 320;
        const seed = seeder.findBiomes(newestMc, [newestBiome.value], ...AREA, 1000, 0, y);
        expect(typeof seed).toBe('bigint');
        expect(has(newestMc, seed, 0, y, newestBiome.value)).toBe(true);
    });

    it(`find_structures returns a seed with ${newestStructure.pureText} within 600 blocks`, () => {
        const seed = seeder.findStructures(newestMc, newestStructure.value, 0, 0, 600, 5000, 0);
        expect(typeof seed).toBe('bigint');
        expect(within(seeder.getStructuresInRegions(newestMc, newestStructure.value, seed, 4, 0), 600)).toBe(true);
    });

    it('find_biomes_with_structure returns a seed with a Village and Plains within 500 blocks', () => {
        const seed = seeder.findBiomesWithStructures(newestMc, VILLAGE, [PLAINS], 0, 0, 500, 1, 0, 256);
        expect(typeof seed).toBe('bigint');
        expect(within(seeder.getStructuresInRegions(newestMc, VILLAGE, seed, 4, 0), 500)).toBe(true);
        expect(has(newestMc, seed, 0, 256, PLAINS, [-125, -125, 250, 250])).toBe(true);
    });
});

describe('older generation and other dimensions', () => {
    it('1.16.5: find_biomes finds Plains near the origin', () => {
        const mc = VERSIONS['1.16.5'];
        const seed = seeder.findBiomes(mc, [PLAINS], -25, -25, 50, 50, 42, 0, 0);
        expect(has(mc, seed, 0, 0, PLAINS, [-25, -25, 50, 50])).toBe(true);
    });
    it('1.16.5: find_structures finds a Fortress in the Nether within 600 blocks', () => {
        const mc = VERSIONS['1.16.5'];
        const seed = seeder.findStructures(mc, FORTRESS, 0, 0, 600, 1, -1);
        expect(within(seeder.getStructuresInRegions(mc, FORTRESS, seed, 4, -1), 600)).toBe(true);
    });
    it('1.18: find_biomes finds Plains near the origin on the noise generator', () => {
        const mc = VERSIONS['1.18'];
        const seed = seeder.findBiomes(mc, [PLAINS], -25, -25, 50, 50, 7, 0, 256);
        expect(has(mc, seed, 0, 256, PLAINS, [-25, -25, 50, 50])).toBe(true);
    });
});

describe('search resumes from the starting seed', () => {
    it('never returns a seed below startingSeed for a biome search', () => {
        const seed = seeder.findBiomes(newestMc, [PLAINS], -25, -25, 50, 50, 1_000_000, 0, 256);
        expect(seed).toBeGreaterThanOrEqual(1_000_000n);
    });
});
