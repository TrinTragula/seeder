// Regression snapshot: one fixed seed, every version x dimension, plus spawn and the
// first three strongholds. A cubiomes update must not change generation for existing
// versions. When it does intentionally (an upstream fix), review the diff and re-record:
//     npx vitest run --project engine -u
// A new version shows up as a missing key -> record it the same way.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadSeeder, sha1 } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const SEED = '8091867987493326313';
const AREA = [-64, -64, 128, 128];   // x, z, w, h in cells (512x512 blocks)
const Y = 320;

let seeder;
beforeAll(async () => { seeder = await loadSeeder(); });

describe('world generation for a fixed seed', () => {
    it('matches the recorded snapshot on every version and dimension', async () => {
        const versions = {};
        for (const [name, mc] of Object.entries(VERSIONS)) {
            versions[name] = {
                mc,
                overworld: await sha1(seeder.getArea(mc, SEED, ...AREA, 0, Y).ids),
                nether: await sha1(seeder.getArea(mc, SEED, ...AREA, -1, Y).ids),
                end: await sha1(seeder.getArea(mc, SEED, ...AREA, 1, Y).ids),
                spawn: Array.from(seeder.findSpawn(mc, SEED)),
                strongholds: seeder.findStrongholds(mc, SEED, 3).map((c) => Array.from(c)),
            };
        }
        const snapshot = { seed: SEED, area: AREA, y: Y, versions };
        await expect(JSON.stringify(snapshot, null, 2) + '\n').toMatchFileSnapshot('./__snapshots__/generation.json');
    });

    it('is deterministic across calls and across worker instances', async () => {
        const other = await loadSeeder();
        const mc = VERSIONS['26.3'];
        expect(seeder.getArea(mc, SEED, ...AREA, 0, Y).ids).toEqual(other.getArea(mc, SEED, ...AREA, 0, Y).ids);
        expect(seeder.getArea(mc, SEED, ...AREA, 0, Y).ids).toEqual(seeder.getArea(mc, SEED, ...AREA, 0, Y).ids);
    });
});
