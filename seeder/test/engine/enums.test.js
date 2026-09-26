// The JS enums in constants.jsx / draw.js mirror cubiomes' C enums by raw integer.
// These checks run the ints through the compiled WASM: a version the engine does not
// know, a biome id without a colour, a structure id that never yields positions or a
// missing icon all fail here. This is the first thing to run after a cubiomes update.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadSeeder, PUBLIC_DIR } from './harness.js';
import { VERSIONS, VERSIONS_OPTIONS, OLD_VERSIONS, BIOMES, STRUCTURES_OPTIONS, DIMENSIONS_OPTIONS, HEIGHT_OPTIONS } from '../../src/util/constants';
import { STRUCTURE_ICONS } from '../../src/library/draw';

const SEED = '8091867987493326313';
const SEEDS = [SEED, '12345', '777111', '246810', '13571113'];
const AREA = [-64, -64, 128, 128];   // x, z, w, h in cells (512x512 blocks around the origin)
const newestMc = Math.max(...Object.values(VERSIONS));
const newestLabel = Object.keys(VERSIONS).find((k) => VERSIONS[k] === newestMc);

// cubiomes paints The Void black.
const BLACK_BY_DESIGN = new Set([127]);

let seeder;
// The engine's own word on where each structure type generates on the newest version.
let support;
beforeAll(async () => {
    seeder = await loadSeeder();
    support = seeder.getVersionSupport(newestMc, [], STRUCTURES_OPTIONS.map((s) => s.value));
});

describe('constants.jsx is internally consistent', () => {
    it('VERSIONS has unique ints and VERSIONS_OPTIONS mirrors it', () => {
        const values = Object.values(VERSIONS);
        expect(new Set(values).size).toBe(values.length);
        expect(VERSIONS_OPTIONS).toEqual(Object.keys(VERSIONS).map((label) => ({ label, value: VERSIONS[label] })));
    });
    it('every OLD_VERSIONS label (legacy numeric share URLs) still exists in VERSIONS', () => {
        for (const label of Object.values(OLD_VERSIONS)) expect(VERSIONS, label).toHaveProperty(label);
    });
    it('BIOMES have unique ids and labels', () => {
        expect(new Set(BIOMES.map((b) => b.value)).size).toBe(BIOMES.length);
        expect(new Set(BIOMES.map((b) => b.label)).size).toBe(BIOMES.length);
    });
    it('STRUCTURES_OPTIONS have unique ids and a pureText label', () => {
        expect(new Set(STRUCTURES_OPTIONS.map((s) => s.value)).size).toBe(STRUCTURES_OPTIONS.length);
        for (const s of STRUCTURES_OPTIONS) expect(typeof s.pureText).toBe('string');
    });
    it('DIMENSIONS_OPTIONS are the Overworld, Nether and End ids cubiomes uses', () => {
        expect(DIMENSIONS_OPTIONS.map((d) => d.value).sort()).toEqual([-1, 0, 1]);
    });
    it('HEIGHT_OPTIONS include the world top and sea level', () => {
        const heights = HEIGHT_OPTIONS.map((h) => h.value);
        expect(heights).toContain(320);
        expect(heights).toContain(62);
    });
});

describe(`every VERSIONS entry is known to the engine`, () => {
    it.each(Object.entries(VERSIONS))('%s (%i) generates a plausible Overworld', (label, mc) => {
        const ids = new Set(seeder.getArea(mc, SEED, ...AREA, 0, 320).ids);
        expect(ids.size).toBeGreaterThan(1);
        for (const id of ids) expect(id).toBeGreaterThanOrEqual(0);
    });
});

describe('every BIOMES id is known to the engine', () => {
    it.each(BIOMES.filter((b) => !BLACK_BY_DESIGN.has(b.value)))('$label ($value) has a colour in cubiomes\' palette', ({ value }) => {
        const [r, g, b, a] = seeder.COLORS[value] ?? [0, 0, 0, 0];
        expect(a).toBe(255);
        expect(r + g + b, 'black means cubiomes does not know this id').toBeGreaterThan(0);
    });
    it.each(BIOMES)('$label ($value) exists on at least one supported version (biome_exists)', ({ value }) => {
        expect(Object.values(VERSIONS).some((mc) => seeder.WASMbiomeExists(mc, value) === 1)).toBe(true);
    });
});

describe('the engine and constants.jsx agree on the newest version', () => {
    it('mc_newest() equals the largest VERSIONS int', () => {
        expect(seeder.WASMmcNewest()).toBe(newestMc);
    });
});

describe(`every STRUCTURES_OPTIONS id is a real structure on ${newestLabel}`, () => {
    it.each(STRUCTURES_OPTIONS)('$pureText ($value) is supported by structure_info and yields positions in its dimension', ({ value, pureText }) => {
        const dim = support.structures[value];
        expect(dim, `${pureText} unsupported on ${newestLabel} - StructureType renumbered?`).not.toBe(-100);
        expect([-1, 0, 1]).toContain(dim);
        const found = [8, 40, 128].some((range) => SEEDS.some((seed) => seeder.getStructuresInRegions(newestMc, value, seed, range, dim).length > 0));
        expect(found, `${pureText} never found in dimension ${dim} - StructureType renumbered?`).toBe(true);
    });
    it.each(STRUCTURES_OPTIONS)('$pureText ($value) has an icon in draw.js that exists under public/', ({ value }) => {
        const icon = STRUCTURE_ICONS[value];
        expect(icon, 'no STRUCTURE_ICONS entry').toBeDefined();
        expect(fs.existsSync(path.join(PUBLIC_DIR, icon)), `${icon} missing`).toBe(true);
    });
    it('the option labels use the same icon files as the map', () => {
        for (const { value, label } of STRUCTURES_OPTIONS) {
            const src = label?.props?.children?.[0]?.props?.src;
            expect(src, `option ${value}`).toBe(STRUCTURE_ICONS[value]);
        }
    });
});
