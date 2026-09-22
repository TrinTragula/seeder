// Source-level enum sync: parse cubiomes' C headers and check constants.jsx / draw.js
// against them. Catches a mid-enum insertion (Nether_Fossil, Abandoned_Camp, ...) before
// a WASM rebuild. Skipped when the submodule is not checked out.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './harness.js';
import { VERSIONS, BIOMES, STRUCTURES_OPTIONS } from '../../src/util/constants';
import { STRUCTURE_ICONS } from '../../src/library/draw';

const BIOMES_H = path.join(REPO_ROOT, 'cubiomes', 'biomes.h');
const FINDERS_H = path.join(REPO_ROOT, 'cubiomes', 'finders.h');
const hasSubmodule = fs.existsSync(BIOMES_H) && fs.existsSync(FINDERS_H);

// Parse a C enum body into { name: value }, honouring implicit increments and
// initialisers of the form `123`, `other_name` or `other_name+128`.
function parseEnum(source, enumName) {
    const start = source.indexOf(`enum ${enumName}`);
    if (start < 0) throw new Error(`enum ${enumName} not found`);
    const open = source.indexOf('{', start);
    const close = source.indexOf('};', open);
    const body = source.slice(open + 1, close).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const values = {};
    let last = -1;
    for (const raw of body.split(',')) {
        const entry = raw.trim();
        if (!entry) continue;
        const [name, init] = entry.split('=').map((s) => s.trim());
        let value;
        if (init === undefined) value = last + 1;
        else if (/^-?\d+$/.test(init)) value = Number(init);
        else {
            const m = init.match(/^(\w+)\s*\+\s*(\d+)$/);
            value = m ? values[m[1]] + Number(m[2]) : values[init];
            if (value === undefined) throw new Error(`cannot evaluate ${entry}`);
        }
        values[name] = value;
        last = value;
    }
    return values;
}

const namesFor = (values, wanted) => Object.keys(values).filter((k) => values[k] === wanted);

// UI label -> C enum name. Labels are mostly the C name with spaces; the rest are here.
const versionName = (label) => 'MC_' + label.replace('Beta ', 'B').replaceAll('.', '_');
const STRUCTURE_ALIASES = { 'Trail Ruin': 'Trail_Ruins', 'Trial Chamber': 'Trial_Chambers' };
const structureName = (pureText) => STRUCTURE_ALIASES[pureText] ?? pureText.replaceAll(' ', '_');
const BIOME_ALIASES = { 'Basalt Delta': 'basalt_deltas' };
const biomeName = (label) => BIOME_ALIASES[label] ?? label.toLowerCase().replaceAll(' ', '_');

describe.skipIf(!hasSubmodule)('constants.jsx matches the cubiomes headers', () => {
    const biomesH = hasSubmodule ? fs.readFileSync(BIOMES_H, 'utf8') : '';
    const findersH = hasSubmodule ? fs.readFileSync(FINDERS_H, 'utf8') : '';
    const mcVersion = hasSubmodule ? parseEnum(biomesH, 'MCVersion') : {};
    const biomeId = hasSubmodule ? parseEnum(biomesH, 'BiomeID') : {};
    const structureType = hasSubmodule ? parseEnum(findersH, 'StructureType') : {};

    it('parses the enums sanely', () => {
        expect(mcVersion.MC_UNDEF).toBe(0);
        expect(mcVersion.MC_B1_7).toBe(1);
        expect(biomeId.plains).toBe(1);
        expect(biomeId.sunflower_plains).toBe(129);
        expect(structureType.Desert_Pyramid).toBe(1);
        expect(structureType.Jungle_Pyramid).toBe(structureType.Jungle_Temple);
    });

    it.each(Object.entries(VERSIONS))('VERSIONS["%s"] = %i equals enum MCVersion', (label, value) => {
        const name = versionName(label);
        expect(mcVersion, `${name} not in enum MCVersion`).toHaveProperty(name);
        expect(mcVersion[name]).toBe(value);
    });

    it('VERSIONS covers MC_NEWEST', () => {
        expect(Math.max(...Object.values(VERSIONS))).toBe(mcVersion.MC_NEWEST);
    });

    it.each(BIOMES)('BIOMES $label = $value equals enum BiomeID', ({ label, value }) => {
        const names = namesFor(biomeId, value);
        expect(names, `no BiomeID has value ${value}`).not.toHaveLength(0);
        expect(names, `${label} is not a name of BiomeID ${value} (${names.join(', ')})`).toContain(biomeName(label));
    });

    it.each(STRUCTURES_OPTIONS)('STRUCTURES_OPTIONS $pureText = $value equals enum StructureType', ({ pureText, value }) => {
        const name = structureName(pureText);
        expect(structureType, `${name} not in enum StructureType`).toHaveProperty(name);
        expect(structureType[name]).toBe(value);
    });

    it('every STRUCTURE_ICONS key is a valid StructureType', () => {
        for (const key of Object.keys(STRUCTURE_ICONS)) {
            expect(Number(key)).toBeGreaterThan(0);
            expect(Number(key)).toBeLessThan(structureType.FEATURE_NUM);
        }
    });
});

describe.skipIf(hasSubmodule)('cubiomes submodule', () => {
    it.skip('is not checked out - run `git submodule update --init` to enable the header sync checks', () => { });
});
