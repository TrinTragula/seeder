// Independent ground truth: the assertions from cubiomes' own test suite
// (cubiomes/tests/test_biomes.c), replayed through the app's marshaling code.
// Unlike the snapshot, these prove the engine is *correct*, not merely unchanged.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadSeeder } from './harness.js';
import { VERSIONS, BIOMES } from '../../src/util/constants';

const idOf = (label) => {
    const hit = BIOMES.find((b) => b.label === label);
    if (!hit) throw new Error(`no BIOMES entry labelled ${label}`);
    return hit.value;
};

let seeder;
beforeAll(async () => { seeder = await loadSeeder(); });

// Biome of one cell (1 cell = 4 blocks) at scale 4.
const cell = (mc, seed, cx, cz, dim = 0, y = 0) => seeder.getArea(mc, seed, cx, cz, 1, 1, dim, y).ids[0];
// Biomes present in the 3x3 cells around (cx, cz): for vectors written at block scale,
// where 1.15+ Voronoi jitter can move a block into a neighbouring cell.
const around = (mc, seed, cx, cz, dim = 0, y = 0) => new Set(seeder.getArea(mc, seed, cx - 1, cz - 1, 3, 3, dim, y).ids);

describe('1.16.5 (cubiomes test_biomes_1_16_5)', () => {
    const mc = VERSIONS['1.16.5'];
    const overworld = '1437905338718953247';
    it.each([
        ['Wooded Badlands', 3611 - 8, -141],
        ['Cold Ocean', -54 >> 2, -23 >> 2],
        ['Mushroom Fields', 68 >> 2, 47 >> 2],
        ['Frozen Ocean', 186 >> 2, 249 >> 2],
        ['Forest', 3256313 >> 2, -3265404 >> 2],
    ])('overworld cell has %s at (%i, %i)', (label, cx, cz) => {
        expect(cell(mc, overworld, cx, cz)).toBe(idOf(label));
    });

    const nether = '1551515151585454';
    it.each([
        ['Crimson Forest', 181 >> 2, 209 >> 2],
        ['Soul Sand Valley', 404 >> 2, 416 >> 2],
        ['Basalt Delta', 308 >> 2, 32 >> 2],
    ])('nether cell has %s at (%i, %i)', (label, cx, cz) => {
        expect(cell(mc, nether, cx, cz, -1)).toBe(idOf(label));
    });

    it('end has End Barrens around block (10000, 10000)', () => {
        expect(around(mc, nether, 10000 >> 2, 10000 >> 2, 1)).toContain(idOf('End Barrens'));
    });
});

describe('1.18 (cubiomes test_biomes_1_18_2)', () => {
    it('nether seed 12345 has Nether Wastes at the origin', () => {
        expect(cell(VERSIONS['1.18'], '12345', 0, 0, -1)).toBe(idOf('Nether Wastes'));
    });
});

describe('26.3 (cubiomes test_biomes_26_3)', () => {
    it('seed -3829811542736183482 has Dappled Forest around block (68148, y77, 80990)', () => {
        expect(around(VERSIONS['26.3'], '-3829811542736183482', 68148 >> 2, 80990 >> 2, 0, 77)).toContain(idOf('Dappled Forest'));
    });
});

describe('spawn and strongholds behave like the game', () => {
    it('spawn is at the origin for Beta 1.7 (no spawn search yet) and elsewhere later', () => {
        expect(Array.from(seeder.findSpawn(VERSIONS['Beta 1.7'], '8091867987493326313'))).toEqual([0, 0]);
        expect(Array.from(seeder.findSpawn(VERSIONS['26.3'], '8091867987493326313'))).toEqual([-32, 80]);
    });
    it('the first three strongholds lie in the first ring (1280..2816 blocks from the origin) on 1.9+', () => {
        for (const mc of [VERSIONS['1.9'], VERSIONS['1.16.5'], VERSIONS['26.3']]) {
            const coords = seeder.findStrongholds(mc, '8091867987493326313', 3);
            expect(coords).toHaveLength(3);
            for (const [x, z] of coords) {
                const d = Math.hypot(x, z);
                expect(d).toBeGreaterThan(1200);
                expect(d).toBeLessThan(2900);
            }
        }
    });
    it('Beta 1.7 has no strongholds', () => {
        expect(seeder.findStrongholds(VERSIONS['Beta 1.7'], '8091867987493326313', 3)).toEqual([]);
    });
});
