// The Large Biomes world type through the real engine: the version argument packed as
// mc | 1 << 16 (engineVersion, src/util/seed.js; unpacked by api.c's unpackVersion).
// Default generation is pinned by generation.json and must never move; the Large Biomes
// output of the same fixed seed is recorded in its own snapshot, large-biomes.json.
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness, sha1 } from './harness.js';
import { VERSIONS, BIOMES } from '../../src/util/constants';
import { LARGE_BIOMES_FLAG, engineVersion } from '../../src/util/seed';

const SEED = '8091867987493326313';
const AREA = [-64, -64, 128, 128];   // x, z, w, h in cells (512x512 blocks), as snapshot.test.js
const Y = 320;
const TIMEOUT = 120_000;
const MONUMENT = 8, VILLAGE = 5;
// What engineVersion(mc, true) sends for a version that has the type.
const large = (label) => engineVersion(VERSIONS[label], true);
const biome = (label) => BIOMES.find((b) => b.label === label).value;
const JUNGLE = biome('Jungle');
const DEEP_OCEANS = [24, 49, 50, 48, 47]; // deep, deep_frozen, deep_cold, deep_lukewarm, deep_warm (biomes.h)

let w, seeder;
beforeAll(async () => {
    w = await createWorkerHarness();
    seeder = w.seeder;
});

const areaHash = (mc, dim, seed = SEED) => sha1(seeder.getArea(mc, seed, ...AREA, dim, Y).ids);
const spawnOf = (mc, seed = SEED) => Array.from(seeder.findSpawn(mc, seed));
const strongholdsOf = (mc, seed = SEED) => seeder.findStrongholds(mc, seed, 3).map((c) => Array.from(c));

describe('Large Biomes generation for a fixed seed', () => {
    for (const label of ['1.7', '1.16.5', '1.21.1']) {
        it(`${label}: the Overworld map, the spawn and the strongholds differ from Default`, async () => {
            expect(await areaHash(large(label), 0)).not.toBe(await areaHash(VERSIONS[label], 0));
            expect(spawnOf(large(label))).not.toEqual(spawnOf(VERSIONS[label]));
            expect(strongholdsOf(large(label))).not.toEqual(strongholdsOf(VERSIONS[label]));
        });
    }

    it('matches the recorded Large Biomes snapshot on every version that has the type', async () => {
        const versions = {};
        for (const [name, mc] of Object.entries(VERSIONS)) {
            if (mc < VERSIONS['1.3']) continue;
            versions[name] = {
                mc,
                overworld: await areaHash(mc | LARGE_BIOMES_FLAG, 0),
                spawn: spawnOf(mc | LARGE_BIOMES_FLAG),
                strongholds: strongholdsOf(mc | LARGE_BIOMES_FLAG),
            };
        }
        const snapshot = { seed: SEED, area: AREA, y: Y, versions };
        await expect(JSON.stringify(snapshot, null, 2) + '\n').toMatchFileSnapshot('./__snapshots__/large-biomes.json');
    });

    it('changes nothing where cubiomes ignores the type: Beta, before 1.3, the Nether and the End', async () => {
        for (const label of ['Beta 1.7', 'Beta 1.8', '1.0', '1.2']) {
            expect(await areaHash(large(label), 0), label).toBe(await areaHash(VERSIONS[label], 0));
            expect(spawnOf(large(label)), label).toEqual(spawnOf(VERSIONS[label]));
        }
        for (const label of ['1.16.5', '26.3']) {
            for (const dim of [-1, 1]) {
                expect(await areaHash(large(label), dim), `${label} ${dim}`).toBe(await areaHash(VERSIONS[label], dim));
            }
        }
    });

    it('the packed version reaches every generator export (the dashboard ones included)', async () => {
        const mc = VERSIONS['1.16.5'];
        const summary = (v) => seeder.seedSummary({ mcVersion: v, seed: SEED, dimension: 0, yHeight: Y });
        expect(summary(mc | LARGE_BIOMES_FLAG)).not.toEqual(summary(mc));
        const [sx, sz] = spawnOf(mc | LARGE_BIOMES_FLAG);
        expect(summary(mc | LARGE_BIOMES_FLAG)).toMatchObject({ spawnX: sx, spawnZ: sz });
        // The spawn biome is what the Large Biomes map paints there.
        const paint = seeder.getArea(mc | LARGE_BIOMES_FLAG, SEED, sx >> 2, sz >> 2, 1, 1, 0, Y).ids[0];
        expect(seeder.biomeAt({ mcVersion: mc | LARGE_BIOMES_FLAG, seed: SEED, dimension: 0, x: sx, y: Y, z: sz }).biome).toBe(paint);
        const list = (v) => seeder.strongholdsList({ mcVersion: v, seed: SEED, howMany: 3 }).strongholds.map((s) => [s.x, s.z]);
        expect(list(mc | LARGE_BIOMES_FLAG)).toEqual(strongholdsOf(mc | LARGE_BIOMES_FLAG));
    });

    it('the dashboard cache keys on the world type: Default, Large, Default again', () => {
        const mc = VERSIONS['1.21.1'];
        const summary = (v) => seeder.seedSummary({ mcVersion: v, seed: SEED, dimension: 0, yHeight: Y });
        const first = summary(mc);
        const largeOne = summary(mc | LARGE_BIOMES_FLAG);
        expect(largeOne).not.toEqual(first);
        expect(summary(mc)).toEqual(first);
        expect(summary(mc | LARGE_BIOMES_FLAG)).toEqual(largeOne);
    });
});

describe('the version probes and the world-type-free exports take a packed version as the plain one', () => {
    it('GET_VERSION_SUPPORT answers the same', () => {
        const ids = BIOMES.map((b) => b.value);
        const types = Array.from({ length: 30 }, (_, i) => i);
        for (const label of ['1.2', '1.16.5', '26.3']) {
            const { mcVersion, ...plain } = seeder.getVersionSupport(VERSIONS[label], ids, types);
            const { mcVersion: packedEcho, ...packed } = seeder.getVersionSupport(large(label), ids, types);
            expect(packed, label).toEqual(plain);
            expect(packed.biomes.length, label).toBeGreaterThan(0);
        }
    });

    it('stronghold_analyse, fortress_spawners and quad_huts answer as for the plain version', () => {
        const mc = VERSIONS['1.16.5'];
        const [sh] = seeder.strongholdsList({ mcVersion: mc, seed: SEED, howMany: 1 }).strongholds;
        expect(seeder.strongholdAnalyse({ mcVersion: mc | LARGE_BIOMES_FLAG, seed: SEED, x: sh.x, z: sh.z }))
            .toEqual(seeder.strongholdAnalyse({ mcVersion: mc, seed: SEED, x: sh.x, z: sh.z }));
        expect(seeder.fortressSpawners({ mcVersion: mc | LARGE_BIOMES_FLAG, seed: SEED, chunkX: 0, chunkZ: 0 }))
            .toEqual(seeder.fortressSpawners({ mcVersion: mc, seed: SEED, chunkX: 0, chunkZ: 0 }));
        expect(seeder.quadHuts({ mcVersion: mc | LARGE_BIOMES_FLAG, seed: SEED }).error).toBeUndefined();
    });
});

describe('find_seeds on Large Biomes worlds', () => {
    const search = (criteria) => {
        w.clear();
        const result = seeder.findSeeds({ dimension: 0, biomes: [], anyBiomes: [], excludeBiomes: [], structures: [], startingSeed: '1', ...criteria });
        return { result, found: w.drain('SEED_FOUND').map((m) => m.data) };
    };
    const box = (mc, seed, y, range) => {
        const c = Math.ceil(range / 4);
        return new Set(seeder.getArea(mc, seed, -c, -c, 2 * c, 2 * c, 0, y).ids);
    };

    // The layer stacks (<= 1.17) reject early on intermediate layers; with Large Biomes two
    // extra zooms sit below them. The shortcut must still find exactly what a cell-by-cell
    // scan finds: the same hits, none missed.
    for (const label of ['1.7', '1.12', '1.16.5']) {
        it(`${label}: Jungle within 128 - the hits are exactly the seeds whose Large Biomes box has one`, () => {
            const mc = large(label);
            const N = 600;
            const { result, found } = search({ mcVersion: mc, yHeight: Y, biomes: [JUNGLE], rangeBlocks: 128, maxSeedsToScan: N, maxResults: 10_000 });
            expect(result.error).toBeNull();
            const brute = [];
            for (let s = 1; s <= N; s++) if (box(mc, String(s), Y, 128).has(JUNGLE)) brute.push(String(s));
            expect(found.map((h) => String(h.seed))).toEqual(brute);
            expect(brute.length).toBeGreaterThan(0);
            // A plain run over the same seeds finds a different set: the flag reached the filter.
            const plain = search({ mcVersion: VERSIONS[label], yHeight: Y, biomes: [JUNGLE], rangeBlocks: 128, maxSeedsToScan: N, maxResults: 10_000 });
            expect(plain.found.map((h) => String(h.seed))).not.toEqual(brute);
        }, TIMEOUT);
    }

    it('1.21.1: every hit has the biome inside the box, by BIOME_AT on the Large Biomes world', () => {
        const mc = large('1.21.1');
        const { result, found } = search({ mcVersion: mc, yHeight: 62, biomes: [JUNGLE], rangeBlocks: 64, maxSeedsToScan: 60, maxResults: 2 });
        expect(result.error).toBeNull();
        expect(found.length).toBeGreaterThan(0);
        for (const { seed } of found) {
            let seen = false;
            for (let z = -64; z < 64 && !seen; z += 4) {
                for (let x = -64; x < 64 && !seen; x += 4) {
                    seen = seeder.biomeAt({ mcVersion: mc, seed: String(seed), dimension: 0, x, y: 62, z }).biome === JUNGLE;
                }
            }
            expect(seen, String(seed)).toBe(true);
        }
    }, TIMEOUT);

    it('a Nether hit carries the Large Biomes Overworld spawn (reportHit keeps the world type)', () => {
        const mc = large('1.16.5');
        const { result, found } = search({ mcVersion: mc, dimension: -1, structures: [18], rangeBlocks: 300, maxSeedsToScan: 50_000, maxResults: 2 });
        expect(result.error).toBeNull();
        expect(found.length).toBe(2);
        for (const hit of found) {
            // The top 16 bits of the reported seed decide the spawn: compare with find_spawn.
            expect([hit.spawnX, hit.spawnZ], String(hit.seed)).toEqual(spawnOf(mc, String(hit.seed)));
        }
        expect(found.some((hit) => String(spawnOf(mc, String(hit.seed))) !== String(spawnOf(VERSIONS['1.16.5'], String(hit.seed))))).toBe(true);
    }, TIMEOUT);

    it('a structure search sees Large Biomes viability: Village hits differ from Default', () => {
        const run = (mc) => search({ mcVersion: mc, yHeight: Y, structures: [VILLAGE], rangeBlocks: 300, maxSeedsToScan: 2000, maxResults: 5 }).found;
        const a = run(large('1.16.5')), b = run(VERSIONS['1.16.5']);
        expect(a.length).toBe(5);
        expect(a.map((h) => String(h.seed))).not.toEqual(b.map((h) => String(h.seed)));
    }, TIMEOUT);
});

// cubiomes' Monument check on 1.9-1.17 prechecks the fixed 1:16 shore layer, which is
// 1:64 in a Large Biomes stack; api.c reads the stack's own 1:16 layer instead.
describe('Monuments on Large Biomes worlds, 1.9-1.17', () => {
    const monuments = (mc, seed) => seeder.getStructuresInRegions(mc, MONUMENT, seed, 12, 0).map((p) => Array.from(p));

    for (const label of ['1.12', '1.16.5']) {
        it(`${label}: as many as a Default world has, each centred on a deep ocean`, () => {
            let plain = 0, largeCount = 0;
            for (let seed = 1; seed <= 12; seed++) {
                plain += monuments(VERSIONS[label], String(seed)).length;
                const found = monuments(large(label), String(seed));
                largeCount += found.length;
                for (const [x, z] of found) {
                    const id = seeder.biomeAt({ mcVersion: large(label), seed: String(seed), dimension: 0, x: (x & ~15) + 8, y: 63, z: (z & ~15) + 8 }).biome;
                    expect(DEEP_OCEANS, `${seed} ${x},${z}`).toContain(id);
                }
            }
            // Measured over 40 seeds on 1.12: 2177 Large vs 1540 Default monuments; upstream's check alone kept 431 Large ones.
            expect(largeCount).toBeGreaterThan(plain);
        }, TIMEOUT);
    }

    it('the fix leaves Default monuments and 1.18+ Large Biomes monuments alone', () => {
        // Default: pinned against the upstream check by generation.json and the dashboard tests;
        // here the Large Biomes path must not leak into a Default call made right after one.
        const before = monuments(VERSIONS['1.16.5'], SEED);
        monuments(large('1.16.5'), SEED);
        expect(monuments(VERSIONS['1.16.5'], SEED)).toEqual(before);
        expect(monuments(large('1.21.1'), SEED).length).toBeGreaterThan(0);
    });
});
