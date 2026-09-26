// The dashboard exports through the real worker protocol. Every result is checked against
// the engine itself (GET_AREA, GET_SPAWN, GET_STRONGHOLDS, GET_STRUCTURES_IN_REGIONS,
// FIND_SEEDS) or against the known test vectors - never against seeds found while
// developing. Beta 1.7 is never used with GET_AREA as an oracle.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness, sha1 } from './harness.js';
import { VERSIONS, STRUCTURES_OPTIONS } from '../../src/util/constants';
import { shadowSeed } from '../../src/shared/format';

const MC = VERSIONS['26.3'];
const MC_1_17 = VERSIONS['1.17'];
const MC_1_16_5 = VERSIONS['1.16.5'];
const MC_1_12 = VERSIONS['1.12'];
const MC_1_8 = VERSIONS['1.8'];
const MC_1_7 = VERSIONS['1.7'];
const SEED = '8091867987493326313';
const NEG_SEED = '-8091867987493326313';
const TIMEOUT = 120_000;

// StructureType ints (cubiomes/finders.h) and BiomeID ints (cubiomes/biomes.h).
const SWAMP_HUT = 3, VILLAGE = 5, SHIPWRECK = 7, MANSION = 9, RUINED_PORTAL = 11, FORTRESS = 18, BASTION = 19,
    END_CITY = 21, END_GATEWAY = 22, STRONGHOLD = 27;
const PLAINS = 1, NETHER_WASTES = 8;
const VILLAGE_BIOMES = [1, 2, 35, 5, 12]; // plains, desert, savanna, taiga, snowy_plains (meadow reports plains)
const ALL_TYPES = STRUCTURES_OPTIONS.map((o) => o.value);
const INT_MIN = -2147483648;

let w;
beforeAll(async () => { w = await createWorkerHarness(); });

// Post one dashboard request and return its reply's data, after checking that the reply
// echoes requestId verbatim (the pool matches replies by it).
let nextId = 0;
async function ask(kind, data) {
    const requestId = `req-${++nextId}`;
    const reply = await w.call(kind, { requestId, ...data });
    expect(reply.data.requestId).toBe(requestId);
    return reply.data;
}
async function ok(kind, data) {
    const reply = await ask(kind, data);
    expect(reply.error, JSON.stringify(reply.error)).toBeNull();
    return reply;
}

// The biome of the 1:4 cell containing block (x, z), as the map paints it.
async function cellAt(mc, seed, dim, x, z, y = 256, w0 = 1) {
    const { ids } = (await w.call('GET_AREA', { mcVersion: mc, seed, startX: x >> 2, startY: z >> 2, widthX: w0, widthY: w0, dimension: dim, yHeight: y })).data;
    return w0 === 1 ? ids[0] : Array.from(ids);
}

// Viable positions of `type` the engine lists in the regions [-range, range)^2.
const regionBlocksCache = new Map();
async function regionBlocks(mc, type) {
    const key = `${mc}:${type}`;
    if (!regionBlocksCache.has(key)) {
        const { regionBlocks: rb } = (await w.call('GET_VERSION_SUPPORT', { mcVersion: mc, biomeIds: [], structTypes: [type] })).data;
        regionBlocksCache.set(key, rb[type]);
    }
    return regionBlocksCache.get(key);
}
async function oraclePositions(mc, type, seed, dim, reachBlocks) {
    const rb = await regionBlocks(mc, type);
    const regionsRange = Math.ceil(reachBlocks / rb) + 1;
    const { coords } = (await w.call('GET_STRUCTURES_IN_REGIONS', { mcVersion: mc, structType: type, seed, regionsRange, dimension: dim })).data;
    return coords.map((c) => Array.from(c));
}
const dist = (x0, z0, x1, z1) => Math.hypot(x1 - x0, z1 - z0);

describe('SEED_SUMMARY', () => {
    it('reports the known spawn, the map biome there and a surface height on 26.3', async () => {
        const s = await ok('SEED_SUMMARY', { mcVersion: MC, seed: SEED, dimension: 0, yHeight: 256 });
        expect([s.spawnX, s.spawnZ]).toEqual([-32, 80]);
        expect(s.spawnBiome).toBe(await cellAt(MC, SEED, 0, -32, 80, 256));
        expect(Number.isInteger(s.approxHeight)).toBe(true);
        expect(s.approxHeight).toBeGreaterThanOrEqual(40);
        expect(s.approxHeight).toBeLessThanOrEqual(200);
    });

    it('matches GET_SPAWN on 1.12 and has no height there', async () => {
        const s = await ok('SEED_SUMMARY', { mcVersion: MC_1_12, seed: SEED, dimension: 0, yHeight: 256 });
        const { x, z } = (await w.call('GET_SPAWN', { mcVersion: MC_1_12, seed: SEED })).data;
        expect([s.spawnX, s.spawnZ]).toEqual([x, z]);
        expect(s.spawnBiome).toBe(await cellAt(MC_1_12, SEED, 0, x, z, 256));
        expect(s.approxHeight).toBeNull();
    });

    it('centres on the origin in the Nether and the End', async () => {
        const nether = await ok('SEED_SUMMARY', { mcVersion: MC, seed: SEED, dimension: -1, yHeight: 256 });
        expect([nether.spawnX, nether.spawnZ, nether.approxHeight]).toEqual([0, 0, null]);
        expect(nether.spawnBiome).toBe(await cellAt(MC, SEED, -1, 0, 0, 256));
        const end = await ok('SEED_SUMMARY', { mcVersion: MC, seed: SEED, dimension: 1, yHeight: 256 });
        expect([end.spawnX, end.spawnZ]).toEqual([0, 0]);
        expect(end.spawnBiome).toBe(await cellAt(MC, SEED, 1, 0, 0, 256));
        expect(Number.isInteger(end.approxHeight)).toBe(true);
    });

    it('leaves the shared generator usable after a dimension switch (union re-setup)', async () => {
        const snapshot = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '__snapshots__', 'generation.json'), 'utf8'));
        const [x, z, width, height] = snapshot.area;
        for (const label of ['1.16.5', '26.3']) {
            const mc = VERSIONS[label];
            await ok('SEED_SUMMARY', { mcVersion: mc, seed: SEED, dimension: -1, yHeight: 256 });
            const { ids } = (await w.call('GET_AREA', { mcVersion: mc, seed: SEED, startX: x, startY: z, widthX: width, widthY: height, dimension: 0, yHeight: snapshot.y })).data;
            expect(await sha1(ids), label).toBe(snapshot.versions[label].overworld);
            // and the dashboard's own cached generator: Nether, then Overworld point queries
            await ok('BIOME_AT', { mcVersion: mc, seed: SEED, dimension: -1, x: 0, y: 64, z: 0 });
            for (const [bx, bz] of [[0, 0], [-500, 300], [1200, -900]]) {
                const { biome } = await ok('BIOME_AT', { mcVersion: mc, seed: SEED, dimension: 0, x: bx, y: 256, z: bz });
                expect(biome, `${label} (${bx}, ${bz})`).toBe(await cellAt(mc, SEED, 0, bx, bz, 256));
            }
        }
    }, TIMEOUT);
});

// The Spawn section's shadow-seed sentence is a claim about the engine: pin it. getShadow mirrors the layer stack's seed step, so the shadow
// seed shares the Overworld biome layers up to 1.17; ocean temperature (1.13+) is its own
// noise, and the 1.18+ climate noise is unrelated.
describe('shadow seed', () => {
    // Every oceanic BiomeID (cubiomes/biomes.h): ocean, frozen, deep, warm, lukewarm, cold and their deep variants.
    const OCEANS = new Set([0, 10, 24, 44, 45, 46, 47, 48, 49, 50]);
    const compare = async (label) => {
        const mc = VERSIONS[label];
        const [a, b] = await Promise.all([SEED, shadowSeed(SEED)].map((seed) => cellAt(mc, seed, 0, -256, -256, 256, 128)));
        const differ = a.map((id, i) => [id, b[i]]).filter(([x, y]) => x !== y);
        return { differ, total: a.length, oceanOnly: differ.every(([x, y]) => OCEANS.has(x) && OCEANS.has(y)) };
    };

    it('has exactly the same biomes up to 1.12', async () => {
        expect((await compare('1.12')).differ).toEqual([]);
        expect((await compare('1.0')).differ).toEqual([]);
    });

    it('differs only between ocean variants on 1.13 - 1.17', async () => {
        for (const label of ['1.13', '1.16.5', '1.17']) {
            const { differ, oceanOnly } = await compare(label);
            expect(differ.length, label).toBeGreaterThan(0);
            expect(oceanOnly, label).toBe(true);
        }
    });

    it('is unrelated from 1.18', async () => {
        for (const label of ['1.18', '26.3']) {
            const { differ, total } = await compare(label);
            expect(differ.length / total, label).toBeGreaterThan(0.5);
        }
    });
});

describe('STRONGHOLDS_LIST', () => {
    it('lists the known first ring in generation order, like GET_STRONGHOLDS', async () => {
        const { strongholds } = await ok('STRONGHOLDS_LIST', { mcVersion: MC, seed: SEED, howMany: 3 });
        expect(strongholds.map((s) => [s.x, s.z])).toEqual([[-1356, 164], [644, -1484], [1108, 1524]]);
        const { coords } = (await w.call('GET_STRONGHOLDS', { mcVersion: MC, seed: SEED, howMany: 3 })).data;
        expect(strongholds.map((s) => [s.x, s.z])).toEqual(coords.map((c) => Array.from(c)));
        expect(strongholds.map((s) => s.ring)).toEqual([0, 0, 0]);
        expect(strongholds.map((s) => s.index)).toEqual([0, 1, 2]);
    });

    it('returns all 128 with non-decreasing rings and the same positions as GET_STRONGHOLDS', async () => {
        const { strongholds } = await ok('STRONGHOLDS_LIST', { mcVersion: MC, seed: SEED, howMany: 128 });
        expect(strongholds).toHaveLength(128);
        strongholds.forEach((s, i) => expect(s.index).toBe(i));
        for (let i = 1; i < 128; i++) expect(strongholds[i].ring).toBeGreaterThanOrEqual(strongholds[i - 1].ring);
        expect(strongholds.at(-1).ring).toBe(7); // 3 + 6 + 10 + 15 + 21 + 28 + 36 + 9 = 128
        const { coords } = (await w.call('GET_STRONGHOLDS', { mcVersion: MC, seed: SEED, howMany: 12 })).data;
        expect(strongholds.slice(0, 12).map((s) => [s.x, s.z])).toEqual(coords.map((c) => Array.from(c)));
    }, TIMEOUT);

    it('approx mode keeps count and rings (positions are only approximate)', async () => {
        const exact = (await ok('STRONGHOLDS_LIST', { mcVersion: MC, seed: SEED, howMany: 128 })).strongholds;
        const approx = (await ok('STRONGHOLDS_LIST', { mcVersion: MC, seed: SEED, howMany: 128, approx: true })).strongholds;
        expect(approx).toHaveLength(128);
        expect(approx.map((s) => s.ring)).toEqual(exact.map((s) => s.ring));
    }, TIMEOUT);

    it('clamps to 3 strongholds before 1.9 and matches GET_STRONGHOLDS there', async () => {
        const { strongholds } = await ok('STRONGHOLDS_LIST', { mcVersion: MC_1_8, seed: SEED, howMany: 128 });
        expect(strongholds).toHaveLength(3);
        const { coords } = (await w.call('GET_STRONGHOLDS', { mcVersion: MC_1_8, seed: SEED, howMany: 3 })).data;
        expect(strongholds.map((s) => [s.x, s.z])).toEqual(coords.map((c) => Array.from(c)));
    });
});

describe('STRONGHOLD_ANALYSE', () => {
    it('finds the portal room, its eyes and the libraries of the first stronghold', async () => {
        const a = await ok('STRONGHOLD_ANALYSE', { mcVersion: MC, seed: SEED, x: -1356, z: 164 });
        expect(a.eyes).toBeGreaterThanOrEqual(0);
        expect(a.eyes).toBeLessThanOrEqual(12);
        expect(a.libraries).toBeGreaterThanOrEqual(0);
        expect(a.pieces).toBeGreaterThan(10);
        expect(dist(-1356, 164, a.portalX, a.portalZ)).toBeLessThan(200);
    });

    it('reports eyes as unknown before 1.13 (no loot salt) and nothing before 1.8', async () => {
        const [first] = (await ok('STRONGHOLDS_LIST', { mcVersion: MC_1_12, seed: SEED, howMany: 1 })).strongholds;
        const old = await ok('STRONGHOLD_ANALYSE', { mcVersion: MC_1_12, seed: SEED, x: first.x, z: first.z });
        expect(old.eyes).toBe(-1);
        // up to 1.12 the generator stops once the portal room is placed, so a few pieces can be all
        expect(old.pieces).toBeGreaterThan(0);
        expect(dist(first.x, first.z, old.portalX, old.portalZ)).toBeLessThan(200);
        const ancient = await ok('STRONGHOLD_ANALYSE', { mcVersion: MC_1_7, seed: SEED, x: first.x, z: first.z });
        expect(ancient).toMatchObject({ eyes: -1, libraries: -1, portalX: 0, portalZ: 0, pieces: 0 });
    });
});

describe('NEAREST_STRUCTURES', () => {
    // For each found entry: inside the radius, and the closest position the engine itself
    // calls viable (exactly, for types without the 1.18+ terrain heuristic; otherwise no
    // closer than the engine's closest). found 0 means the engine has none in reach.
    async function expectNearest(mc, dim, cx, cz, radius, results, seed = SEED) {
        const terrainTypes = mc >= VERSIONS['1.18'] && dim === 0 ? [1, 2, MANSION] : [];
        for (const r of results.filter((q) => q.found >= 0)) {
            const rb = await regionBlocks(mc, r.type === RUINED_PORTAL && dim === -1 ? 12 : r.type);
            if (rb < 64) continue; // chunk-scale: GET_STRUCTURES_IN_REGIONS works per region only
            const reach = Math.max(Math.abs(cx), Math.abs(cz)) + radius;
            const inReach = (await oraclePositions(mc, r.type, seed, dim, reach))
                .map(([x, z]) => ({ x, z, d: dist(cx, cz, x, z) }))
                .filter((p) => p.d <= radius)
                .sort((a, b) => a.d - b.d);
            const label = `type ${r.type} dim ${dim} mc ${mc}`;
            if (r.found === 1) {
                expect(dist(cx, cz, r.x, r.z), label).toBeLessThanOrEqual(radius);
                expect(inReach.some((p) => p.x === r.x && p.z === r.z), `${label} (${r.x}, ${r.z}) not viable`).toBe(true);
                if (terrainTypes.includes(r.type)) expect(dist(cx, cz, r.x, r.z)).toBeGreaterThanOrEqual(inReach[0].d);
                else expect(dist(cx, cz, r.x, r.z), label).toBe(inReach[0].d);
            } else if (!terrainTypes.includes(r.type)) {
                expect(inReach, `${label} says none`).toEqual([]);
            }
        }
    }

    it('finds every Overworld type around spawn within 4096 on 26.3, verified by the engine', async () => {
        const t0 = performance.now();
        const { results } = await ok('NEAREST_STRUCTURES', { mcVersion: MC, seed: SEED, dimension: 0, x: -32, z: 80, types: ALL_TYPES, maxRadiusBlocks: 4096 });
        expect(performance.now() - t0).toBeLessThan(5_000);
        expect(results.map((r) => r.type)).toEqual(ALL_TYPES);
        for (const r of results) expect([-1, 0, 1]).toContain(r.found);
        // Nether- and End-only types do not exist in the Overworld
        for (const t of [FORTRESS, BASTION, END_CITY, END_GATEWAY]) expect(results.find((r) => r.type === t).found).toBe(-1);
        expect(results.find((r) => r.type === VILLAGE).found).toBe(1);
        await expectNearest(MC, 0, -32, 80, 4096, results);
    }, TIMEOUT);

    it('finds fortresses, bastions and ruined portals in the Nether', async () => {
        const types = [RUINED_PORTAL, FORTRESS, BASTION, VILLAGE, END_CITY];
        const { results } = await ok('NEAREST_STRUCTURES', { mcVersion: MC, seed: SEED, dimension: -1, x: 0, z: 0, types, maxRadiusBlocks: 4096 });
        expect(results.map((r) => r.found)).toEqual([1, 1, 1, -1, -1]);
        await expectNearest(MC, -1, 0, 0, 4096, results);
    }, TIMEOUT);

    it('handles the End, including the chunk-scale End Gateway', async () => {
        const { results } = await ok('NEAREST_STRUCTURES', { mcVersion: MC, seed: SEED, dimension: 1, x: 0, z: 0, types: [END_CITY, END_GATEWAY, VILLAGE], maxRadiusBlocks: 4096 });
        expect(results[0].found).toBe(1);
        expect(dist(0, 0, results[0].x, results[0].z)).toBeGreaterThanOrEqual(1008);
        expect([0, 1]).toContain(results[1].found);
        expect(results[2].found).toBe(-1);
        await expectNearest(MC, 1, 0, 0, 4096, results.slice(0, 1));
    }, TIMEOUT);

    it('works on 1.12 and 1.16.5, from an off-origin centre with negative coordinates', async () => {
        for (const mc of [MC_1_12, MC_1_16_5]) {
            const { results } = await ok('NEAREST_STRUCTURES', { mcVersion: mc, seed: SEED, dimension: 0, x: -3000, z: -2500, types: ALL_TYPES, maxRadiusBlocks: 3000 });
            expect(results.filter((r) => r.found === 1).length).toBeGreaterThan(3);
            await expectNearest(mc, 0, -3000, -2500, 3000, results);
        }
    }, TIMEOUT);

    it('rejects unknown types by value, without killing the worker', async () => {
        const { results } = await ok('NEAREST_STRUCTURES', { mcVersion: MC, seed: SEED, dimension: 0, x: 0, z: 0, types: [0, STRONGHOLD, 28, 99, -5], maxRadiusBlocks: 4096 });
        expect(results.map((r) => r.found)).toEqual([-1, -1, -1, -1, -1]);
        const bad = await ok('NEAREST_STRUCTURES', { mcVersion: 999, seed: SEED, dimension: 0, x: 0, z: 0, types: [VILLAGE], maxRadiusBlocks: 4096 });
        expect(bad.results[0].found).toBe(-1);
        expect((await ok('BIOME_AT', { mcVersion: MC, seed: SEED, x: 0, y: 64, z: 0 })).biome).toBeGreaterThanOrEqual(0);
    });
});

describe('STRUCTURE_VARIANT', () => {
    it('describes the nearest village with the biome it was validated in', async () => {
        const [v] = (await ok('NEAREST_STRUCTURES', { mcVersion: MC, seed: SEED, dimension: 0, x: -32, z: 80, types: [VILLAGE], maxRadiusBlocks: 4096 })).results;
        const { variant } = await ok('STRUCTURE_VARIANT', { mcVersion: MC, seed: SEED, dimension: 0, type: VILLAGE, x: v.x, z: v.z });
        expect(variant.supported).toBe(1);
        expect(VILLAGE_BIOMES).toContain(variant.biome);
        expect([0, 1]).toContain(variant.abandoned);
        expect(variant.sx).toBeGreaterThan(0);
        expect(variant.sz).toBeGreaterThan(0);
        expect(variant.start).toBeGreaterThanOrEqual(0);
        expect(variant.endShip).toBe(0);
    });

    it('supports 1.12 villages (abandoned flag only) and Nether bastions and portals', async () => {
        const [v] = (await ok('NEAREST_STRUCTURES', { mcVersion: MC_1_12, seed: SEED, dimension: 0, x: 0, z: 0, types: [VILLAGE], maxRadiusBlocks: 4096 })).results;
        const old = (await ok('STRUCTURE_VARIANT', { mcVersion: MC_1_12, seed: SEED, dimension: 0, type: VILLAGE, x: v.x, z: v.z })).variant;
        expect(old.supported).toBe(1);
        expect([0, 1]).toContain(old.abandoned);
        const nether = (await ok('NEAREST_STRUCTURES', { mcVersion: MC, seed: SEED, dimension: -1, x: 0, z: 0, types: [BASTION, RUINED_PORTAL], maxRadiusBlocks: 4096 })).results;
        const bastion = (await ok('STRUCTURE_VARIANT', { mcVersion: MC, seed: SEED, dimension: -1, type: BASTION, x: nether[0].x, z: nether[0].z })).variant;
        expect(bastion.supported).toBe(1);
        expect([0, 1, 2, 3]).toContain(bastion.start);
        const portal = (await ok('STRUCTURE_VARIANT', { mcVersion: MC, seed: SEED, dimension: -1, type: RUINED_PORTAL, x: nether[1].x, z: nether[1].z })).variant;
        expect(portal.supported).toBe(1);
        expect(portal.biome).toBe(NETHER_WASTES); // every Nether biome is the nether_wastes portal category
        expect([0, 1]).toContain(portal.giant);
    });

    it('returns supported 0 for types without variants or outside the gate', async () => {
        for (const type of [STRONGHOLD, 0, 99, FORTRESS]) {
            const { variant } = await ok('STRUCTURE_VARIANT', { mcVersion: MC, seed: SEED, dimension: 0, type, x: 100, z: 100 });
            expect(variant.supported, `type ${type}`).toBe(0);
        }
    });

    it('reports the End ship of an End city found by FIND_SEEDS', async () => {
        w.clear();
        const done = (await w.call('FIND_SEEDS', { shardId: 'dash', mcVersion: MC, dimension: 1, yHeight: 256, biomes: [], structures: [END_CITY],
            rangeBlocks: 1500, startingSeed: '1', maxSeedsToScan: 50_000, maxResults: 1 })).data;
        expect(done.error).toBeNull();
        const [hit] = w.drain('SEED_FOUND').map((m) => m.data);
        const city = hit.structures[0];
        const { variant } = await ok('STRUCTURE_VARIANT', { mcVersion: MC, seed: String(hit.seed), dimension: 1, type: END_CITY, x: city.x, z: city.z });
        expect([0, 1]).toContain(variant.supported);
        expect([0, 1]).toContain(variant.endShip);
    }, TIMEOUT);
});

describe('BIOME_AT / APPROX_HEIGHT', () => {
    it('BIOME_AT equals the map cell in every dimension and at negative coordinates', async () => {
        for (const [dim, x, y, z] of [[0, -32, 256, 80], [0, -1234, 62, -5678], [0, 3001, 0, -17], [-1, -300, 64, 777], [1, 1500, 64, -1500]]) {
            const { biome } = await ok('BIOME_AT', { mcVersion: MC, seed: SEED, dimension: dim, x, y, z });
            expect(biome, `${dim} (${x}, ${y}, ${z})`).toBe(await cellAt(MC, SEED, dim, x, z, y));
        }
        const old = await ok('BIOME_AT', { mcVersion: MC_1_12, seed: SEED, dimension: 0, x: -999, y: 64, z: 444 });
        expect(old.biome).toBe(await cellAt(MC_1_12, SEED, 0, -999, 444, 64));
    });

    it('APPROX_HEIGHT at spawn equals the summary; null where the engine cannot tell', async () => {
        const s = await ok('SEED_SUMMARY', { mcVersion: MC, seed: SEED, dimension: 0, yHeight: 256 });
        expect((await ok('APPROX_HEIGHT', { mcVersion: MC, seed: SEED, dimension: 0, x: -32, z: 80 })).height).toBe(s.approxHeight);
        expect((await ok('APPROX_HEIGHT', { mcVersion: MC_1_12, seed: SEED, dimension: 0, x: -32, z: 80 })).height).toBeNull();
        expect((await ok('APPROX_HEIGHT', { mcVersion: MC, seed: SEED, dimension: -1, x: 0, z: 0 })).height).toBeNull();
        const end = await ok('APPROX_HEIGHT', { mcVersion: MC, seed: SEED, dimension: 1, x: 0, z: 0 });
        expect(end.height).toBe((await ok('SEED_SUMMARY', { mcVersion: MC, seed: SEED, dimension: 1 })).approxHeight);
        expect(end.height).not.toBe(INT_MIN);
    });
});

// Java's slime-chunk rule, straight from the game code, in BigInt.
function javaSlime(seed, x, z) {
    const i32 = (v) => BigInt.asIntN(32, v);
    const X = BigInt(x), Z = BigInt(z);
    const mixed = BigInt.asIntN(64, BigInt(seed) + i32(X * X * 0x4c1906n) + i32(X * 0x5ac0dbn) + i32(Z * Z) * 0x4307a7n + i32(Z * 0x5f24fn)) ^ 0x3ad8025fn;
    const MASK = (1n << 48n) - 1n;
    let s = (mixed ^ 0x5deece66dn) & MASK;
    const next31 = () => { s = (s * 0x5deece66dn + 0xbn) & MASK; return Number(s >> 17n); };
    let bits, val;
    do { bits = next31(); val = bits % 10; } while (bits - val + 9 > 0x7fffffff);
    return val === 0 ? 1 : 0;
}

describe('SLIME_CHUNKS', () => {
    it('matches the Java rule around the origin and far out (int overflow) for two seeds', async () => {
        for (const seed of [SEED, '12345']) {
            for (const [cx0, cz0] of [[-8, -8], [100_000, -123_456]]) {
                const reply = await ok('SLIME_CHUNKS', { seed, cx0, cz0, w: 16, h: 16 });
                expect(reply).toMatchObject({ cx0, cz0, w: 16, h: 16 });
                expect(reply.cells).toBeInstanceOf(Uint8Array);
                const expected = [];
                for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) expected.push(javaSlime(seed, cx0 + dx, cz0 + dz));
                expect(Array.from(reply.cells), `${seed} @ ${cx0},${cz0}`).toEqual(expected);
                expect(expected.includes(1)).toBe(true);
            }
        }
    });

    it('transfers the cells buffer and returns all zero beyond 64 wide', async () => {
        const requestId = 'slime-transfer';
        w.send('SLIME_CHUNKS', { requestId, seed: SEED, cx0: 0, cz0: 0, w: 8, h: 8 });
        const message = await w.next('DONE_SLIME_CHUNKS');
        expect(w.transferOf(message)).toEqual([message.data.cells.buffer]);
        const wide = await ok('SLIME_CHUNKS', { seed: SEED, cx0: 0, cz0: 0, w: 65, h: 16 });
        expect(wide.cells).toHaveLength(65 * 16);
        expect(wide.cells.every((c) => c === 0)).toBe(true);
    });
});

describe('BIOME_CENTERS', () => {
    it('locates Plains patches within 1000 of spawn, each backed by the map', async () => {
        const radius = 1000, [cx, cz] = [-32, 80], minSizeCells = 4;
        const { centers } = await ok('BIOME_CENTERS', { mcVersion: MC, seed: SEED, dimension: 0, biomeId: PLAINS, x: cx, z: cz, radiusBlocks: radius, yHeight: 256, minSizeCells });
        expect(centers.length).toBeGreaterThan(0);
        const cells = radius / 4, x0 = (cx >> 2) - cells, z0 = (cz >> 2) - cells;
        const { ids } = (await w.call('GET_AREA', { mcVersion: MC, seed: SEED, startX: x0, startY: z0, widthX: 2 * cells, widthY: 2 * cells, dimension: 0, yHeight: 256 })).data;
        const plainsInBox = ids.filter((id) => id === PLAINS).length;
        const idAt = (cellX, cellZ) => ids[(cellZ - z0) * 2 * cells + (cellX - x0)];
        let total = 0;
        for (const c of centers) {
            expect(c.size).toBeGreaterThanOrEqual(minSizeCells);
            expect(Math.abs(c.x - cx)).toBeLessThanOrEqual(radius + 4);
            expect(Math.abs(c.z - cz)).toBeLessThanOrEqual(radius + 4);
            const near = [];
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) near.push(idAt((c.x >> 2) + dx, (c.z >> 2) + dz));
            expect(near, `centre (${c.x}, ${c.z})`).toContain(PLAINS);
            total += c.size;
        }
        // each cell belongs to at most one patch, so the patches never hold more Plains than the map
        expect(total).toBeLessThanOrEqual(plainsInBox);
        // unsorted but deterministic: the same set on a second call
        const again = (await ok('BIOME_CENTERS', { mcVersion: MC, seed: SEED, dimension: 0, biomeId: PLAINS, x: cx, z: cz, radiusBlocks: radius, yHeight: 256, minSizeCells })).centers;
        const key = (c) => `${c.x},${c.z},${c.size}`;
        expect(new Set(again.map(key))).toEqual(new Set(centers.map(key)));
    }, TIMEOUT);

    it('runs the 2000-block radius the UI offers on 1.18+', async () => {
        const t0 = performance.now();
        const { centers } = await ok('BIOME_CENTERS', { mcVersion: MC, seed: SEED, dimension: 0, biomeId: PLAINS, x: -32, z: 80, radiusBlocks: 2000 });
        expect(performance.now() - t0).toBeLessThan(30_000);
        expect(centers.length).toBeGreaterThan(0);
        for (const c of centers) expect(Math.max(Math.abs(c.x + 32), Math.abs(c.z - 80))).toBeLessThanOrEqual(2004);
    }, TIMEOUT);

    it('answers -8 when the box cannot fit the heap (1.17 at 2048) and the worker survives', async () => {
        const reply = await ask('BIOME_CENTERS', { mcVersion: MC_1_17, seed: SEED, dimension: 0, biomeId: PLAINS, x: 0, z: 0, radiusBlocks: 2048 });
        expect(reply.error.code).toBe(-8);
        expect(reply.centers).toEqual([]);
        const small = await ok('BIOME_CENTERS', { mcVersion: MC_1_17, seed: SEED, dimension: 0, biomeId: PLAINS, x: 0, z: 0, radiusBlocks: 1000 });
        expect(small.centers.length).toBeGreaterThan(0);
        expect((await ok('BIOME_AT', { mcVersion: MC_1_17, seed: SEED, x: 0, y: 64, z: 0 })).biome).toBe(await cellAt(MC_1_17, SEED, 0, 0, 0, 64));
    }, TIMEOUT);

    it('rejects other dimensions, foreign biomes and bad radii by code', async () => {
        const codeOf = async (over) => (await ask('BIOME_CENTERS', { mcVersion: MC, seed: SEED, dimension: 0, biomeId: PLAINS, x: 0, z: 0, radiusBlocks: 1000, ...over })).error?.code;
        expect(await codeOf({ dimension: -1, biomeId: NETHER_WASTES })).toBe(-2);
        expect(await codeOf({ dimension: 1 })).toBe(-2);
        expect(await codeOf({ biomeId: NETHER_WASTES })).toBe(-6);
        expect(await codeOf({ biomeId: 127 })).toBe(-6);   // the_void: setupBiomeFilter would exit()
        expect(await codeOf({ biomeId: 999 })).toBe(-6);
        expect(await codeOf({ radiusBlocks: 2 })).toBe(-7);
        expect(await codeOf({ mcVersion: VERSIONS['Beta 1.7'] })).toBe(-1);
    });
});

describe('QUAD_HUTS', () => {
    // Found with cubiomes' own quad-hut search (README "Quad-Witch-Huts": searchAll48 over
    // low20QuadIdeal, then the upper 16 bits walked until all four huts pass the biome
    // check on 26.3): huts at (-144, -160), (-144, 16), (0, -160), (16, 0).
    const QUAD_SEED = '122723573472276867';

    it('finds the quad witch farm of a known seed: the centre of its four huts', async () => {
        const { farms } = await ok('QUAD_HUTS', { mcVersion: MC, seed: QUAD_SEED });
        expect(farms).toEqual([{ x: -68, z: -76 }]);
        // The four huts really are where the engine lists witch huts.
        const listed = await oraclePositions(MC, SWAMP_HUT, QUAD_SEED, 0, 1024);
        for (const [x, z] of [[-144, -160], [-144, 16], [0, -160], [16, 0]]) {
            expect(listed, `${x}, ${z}`).toContainEqual([x, z]);
        }
    }, TIMEOUT);

    it('takes a negative 64-bit seed (BigInt discipline): same huts, same farm', async () => {
        // Found the same way, with the upper 16 bits walked from 0x8000.
        const { farms } = await ok('QUAD_HUTS', { mcVersion: MC, seed: '-9211831079183208061' });
        expect(farms).toEqual([{ x: -68, z: -76 }]);
        const big = await ok('QUAD_HUTS', { mcVersion: MC, seed: -9211831079183208061n });
        expect(big.farms).toEqual([{ x: -68, z: -76 }]);
    }, TIMEOUT);

    it('ignores the upper 16 bits for the constellation but not for the biomes', async () => {
        // Same lower 48 bits, other upper bits: the huts are placed alike, but on 26.3 at
        // least one of them lands in a biome without huts for almost every choice.
        const base = BigInt(QUAD_SEED) & ((1n << 48n) - 1n);
        let without = 0;
        for (let high = 1n; high <= 8n; high++) {
            const { farms } = await ok('QUAD_HUTS', { mcVersion: MC, seed: String(base | (high << 48n)) });
            if (farms.length === 0) without++;
        }
        expect(without).toBeGreaterThan(0);
    }, TIMEOUT);

    it('answers no farm for ordinary seeds, quickly', async () => {
        for (const seed of [SEED, '1', '2', '-7']) {
            const t0 = performance.now();
            const { farms } = await ok('QUAD_HUTS', { mcVersion: MC, seed });
            expect(performance.now() - t0, seed).toBeLessThan(2_000);
            expect(farms, seed).toEqual([]);
        }
    }, TIMEOUT);

    it('reports -3 on a version without witch huts', async () => {
        // Witch huts arrive in 1.4.
        const reply = await ask('QUAD_HUTS', { mcVersion: VERSIONS['1.3'], seed: SEED });
        expect(reply.error.code).toBe(-3);
        expect(reply.farms).toEqual([]);
    });
});

describe('FORTRESS_SPAWNERS', () => {
    it('lists the blaze spawners of a fortress found by FIND_SEEDS', async () => {
        for (const mc of [MC, MC_1_16_5]) {
            w.clear();
            const done = (await w.call('FIND_SEEDS', { shardId: 'fort', mcVersion: mc, dimension: -1, yHeight: 256, biomes: [], structures: [FORTRESS],
                rangeBlocks: 300, startingSeed: '1', maxSeedsToScan: 50_000, maxResults: 1 })).data;
            expect(done.error).toBeNull();
            const [hit] = w.drain('SEED_FOUND').map((m) => m.data);
            const f = hit.structures[0];
            const reply = await ok('FORTRESS_SPAWNERS', { mcVersion: mc, seed: String(hit.seed), chunkX: f.x >> 4, chunkZ: f.z >> 4 });
            expect(reply.wartRooms).toBeGreaterThanOrEqual(0);
            for (const s of reply.spawners) {
                expect(s.y).toBeGreaterThanOrEqual(48);
                expect(s.y).toBeLessThanOrEqual(100);
                expect(dist(f.x, f.z, s.x, s.z)).toBeLessThanOrEqual(400);
            }
        }
    }, TIMEOUT);

    it('answers -3 on a version without fortresses', async () => {
        const reply = await ask('FORTRESS_SPAWNERS', { mcVersion: VERSIONS['Beta 1.7'], seed: SEED, chunkX: 0, chunkZ: 0 });
        expect(reply.error.code).toBe(-3);
        expect(reply.spawners).toEqual([]);
    });
});

describe('protocol', () => {
    it('every export takes a 19-digit negative seed (BigInt discipline)', async () => {
        const requests = {
            SEED_SUMMARY: { mcVersion: MC, seed: NEG_SEED, dimension: 0, yHeight: 256 },
            STRONGHOLDS_LIST: { mcVersion: MC, seed: NEG_SEED, howMany: 3 },
            STRONGHOLD_ANALYSE: { mcVersion: MC, seed: NEG_SEED, x: 1000, z: 1000 },
            NEAREST_STRUCTURES: { mcVersion: MC, seed: NEG_SEED, dimension: 0, x: 0, z: 0, types: [VILLAGE, SHIPWRECK], maxRadiusBlocks: 2000 },
            STRUCTURE_VARIANT: { mcVersion: MC, seed: NEG_SEED, dimension: 0, type: VILLAGE, x: 0, z: 0 },
            BIOME_AT: { mcVersion: MC, seed: NEG_SEED, dimension: 0, x: 0, y: 64, z: 0 },
            APPROX_HEIGHT: { mcVersion: MC, seed: NEG_SEED, dimension: 0, x: 0, z: 0 },
            SLIME_CHUNKS: { seed: NEG_SEED, cx0: 0, cz0: 0, w: 4, h: 4 },
            BIOME_CENTERS: { mcVersion: MC, seed: NEG_SEED, dimension: 0, biomeId: PLAINS, x: 0, z: 0, radiusBlocks: 300 },
            QUAD_HUTS: { mcVersion: MC, seed: NEG_SEED },
            FORTRESS_SPAWNERS: { mcVersion: MC, seed: NEG_SEED, chunkX: 0, chunkZ: 0 },
        };
        for (const [kind, data] of Object.entries(requests)) await ok(kind, data);
        // the negative seed is its own world: spawn and BigInt seeds agree with GET_SPAWN
        const s = await ok('SEED_SUMMARY', requests.SEED_SUMMARY);
        const { x, z } = (await w.call('GET_SPAWN', { mcVersion: MC, seed: NEG_SEED })).data;
        expect([s.spawnX, s.spawnZ]).toEqual([x, z]);
        const big = await ok('SEED_SUMMARY', { ...requests.SEED_SUMMARY, seed: BigInt(NEG_SEED) });
        expect([big.spawnX, big.spawnZ]).toEqual([x, z]);
        const slime = await ok('SLIME_CHUNKS', requests.SLIME_CHUNKS);
        expect(Array.from(slime.cells)).toEqual([0, 1, 2, 3].flatMap((dz) => [0, 1, 2, 3].map((dx) => javaSlime(NEG_SEED, dx, dz))));
    }, TIMEOUT);

    it('a malformed request still gets its reply, with an error', async () => {
        const reply = await ask('SEED_SUMMARY', { mcVersion: MC, seed: 'not a seed' });
        expect(reply.error.code).toBe(-7);
        const numeric = await w.call('BIOME_AT', { requestId: 42, mcVersion: MC, seed: SEED, x: 0, y: 64, z: 0 });
        expect(numeric.data.requestId).toBe(42);
    });
});
