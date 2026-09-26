import { describe, it, expect } from 'vitest';
import { previewTarget, summaryOf, toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { STRUCTURE_ICONS } from '../../library/draw';

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');
const PORTAL = structure('Ruined Portal');

const criteria = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE, PORTAL], yHeight: 64 };

describe('toHitView', () => {
    const hit = {
        seed: 9007199254740993n, spawnX: -32, spawnZ: 80, index: 3,
        structures: [{ type: PORTAL, x: 200, z: -150 }, { type: VILLAGE, x: -48, z: 16 }],
    };

    it('holds the seed as its exact decimal string and copies the world', () => {
        const view = toHitView(hit, criteria);
        expect(view.seed).toBe('9007199254740993');
        expect(view).toMatchObject({ mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 64, spawn: { x: -32, z: 80 }, index: 3 });
    });

    it('keeps negative 64-bit seeds exact', () => {
        expect(toHitView({ ...hit, seed: -9223372036854775808n }, criteria).seed).toBe('-9223372036854775808');
    });

    it('names and icons come from the constants, distances from the origin, nearest first', () => {
        const { structures } = toHitView(hit, criteria);
        expect(structures).toEqual([
            { type: VILLAGE, name: 'Village', icon: STRUCTURE_ICONS[VILLAGE], x: -48, z: 16, distance: 51, verified: true },
            { type: PORTAL, name: 'Ruined Portal', icon: STRUCTURE_ICONS[PORTAL], x: 200, z: -150, distance: 250, verified: true },
        ]);
    });

    it('an unverified row keeps verified: false and null coordinates, and sorts after every found one', () => {
        const MANSION = structure('Mansion');
        const { structures } = toHitView({
            seed: 1n, spawnX: 0, spawnZ: 0, index: 0,
            structures: [
                { type: MANSION, x: null, z: null, verified: false },
                { type: PORTAL, x: 200, z: -150 },
                { type: VILLAGE, x: null, z: null, verified: false },
                { type: VILLAGE, x: -48, z: 16 },
            ],
        }, criteria);
        expect(structures.map((s) => [s.type, s.distance, s.verified])).toEqual([
            [VILLAGE, 51, true],
            [PORTAL, 250, true],
            [MANSION, null, false],
            [VILLAGE, null, false],
        ]);
        expect(structures[2]).toMatchObject({ name: 'Mansion', icon: STRUCTURE_ICONS[MANSION], x: null, z: null });
    });

    it('a row without coordinates is never verified, whatever it claims', () => {
        const [row] = toHitView({ seed: 1n, spawnX: 0, spawnZ: 0, index: 0, structures: [{ type: VILLAGE, x: null, z: 5 }] }, criteria).structures;
        expect(row).toMatchObject({ x: null, z: null, distance: null, verified: false });
    });

    it('builds a seeds-mode hit (string seed from the URL, SEED_SUMMARY spawn) like a search hit', () => {
        const view = toHitView({
            seed: '8091867987493326313', spawnX: -32, spawnZ: 80, index: 1,
            structures: [{ type: VILLAGE, x: 96, z: -80 }, { type: PORTAL, x: null, z: null, verified: false }],
        }, { ...criteria, dimension: 0 });
        expect(view).toMatchObject({ seed: '8091867987493326313', spawn: { x: -32, z: 80 }, index: 1, mcVersion: VERSIONS['26.3'] });
        expect(view.structures.map((s) => s.verified)).toEqual([true, false]);
    });

    it('a biome-only hit has no structures', () => {
        expect(toHitView({ seed: 1n, spawnX: 0, spawnZ: 0, index: 0 }, criteria).structures).toEqual([]);
    });

    it('takes the dimension from the criteria', () => {
        expect(toHitView(hit, { ...criteria, dimension: -1 }).dimension).toBe(-1);
    });
});

describe('previewTarget', () => {
    it('is the nearest structure, with its name, in any dimension', () => {
        for (const dimension of [0, -1]) {
            const view = toHitView({
                seed: 5n, spawnX: 400, spawnZ: -300, index: 0,
                structures: [{ type: PORTAL, x: 200, z: -150 }, { type: VILLAGE, x: -48, z: 16 }],
            }, { ...criteria, dimension });
            expect(previewTarget(view)).toEqual({ x: -48, z: 16, label: 'Village' });
        }
    });

    it('without a structure: the spawn in the Overworld, the origin elsewhere', () => {
        const at = (dimension) => previewTarget(toHitView({ seed: 5n, spawnX: 400, spawnZ: -300, index: 0 }, { ...criteria, dimension }));
        expect(at(0)).toEqual({ x: 400, z: -300, label: 'Spawn' });
        expect(at(-1)).toEqual({ x: 0, z: 0, label: 'Origin' });
        expect(at(1)).toEqual({ x: 0, z: 0, label: 'Origin' });
    });
});

describe('summaryOf', () => {
    it('structures, biomes, range, version, dimension', () => {
        expect(summaryOf({ ...criteria, structures: [VILLAGE], biomes: [biome('Cherry Grove')], rangeBlocks: 300 }))
            .toBe('Village · Cherry Grove · 300 blocks · 26.3 · Overworld');
    });

    it('uses the short range label and the dimension name', () => {
        expect(summaryOf({ ...criteria, structures: [structure('Fortress')], biomes: [], rangeBlocks: 1000, dimension: -1, mcVersion: VERSIONS['1.17'] }))
            .toBe('Fortress · 1k blocks · 1.17 · Nether');
    });
});
