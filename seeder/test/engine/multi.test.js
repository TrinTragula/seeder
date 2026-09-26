// The streaming FIND_SEEDS search against the real WASM. Every hit is checked with the
// engine itself (GET_STRUCTURES_IN_REGIONS, GET_AREA, GET_SPAWN) - never against seeds
// found while developing - so a cubiomes bump that moves a structure fails here.
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const MC = VERSIONS['26.3'];
const MC_1_17 = VERSIONS['1.17'];
const MC_1_12 = VERSIONS['1.12'];
const MASK48 = (1n << 48n) - 1n;

// StructureType ints (cubiomes/finders.h) and BiomeID ints (cubiomes/biomes.h).
const VILLAGE = 5, MANSION = 9, RUINED_PORTAL = 11, RUINED_PORTAL_N = 12, ANCIENT_CITY = 13, FORTRESS = 18, BASTION = 19,
    END_CITY = 21, END_GATEWAY = 22, TRIAL_CHAMBERS = 25;
const PLAINS = 1, MUSHROOM_FIELDS = 14, JUNGLE = 21, ICE_SPIKES = 140, DRIPSTONE_CAVES = 174, CHERRY_GROVE = 185;

let w;
beforeAll(async () => { w = await createWorkerHarness(); });

const criteria = (over = {}) => ({
    shardId: 'test', mcVersion: MC, dimension: 0, yHeight: 256, biomes: [], structures: [],
    rangeBlocks: 300, startingSeed: '1', maxSeedsToScan: 50_000, maxResults: 10, ...over,
});

// Post one FIND_SEEDS shard, await its DONE_FIND_SEEDS and collect what streamed meanwhile.
async function runShard(data) {
    w.clear();
    const t0 = performance.now();
    const done = (await w.call('FIND_SEEDS', data)).data;
    const elapsedMs = performance.now() - t0;
    const found = w.drain('SEED_FOUND').map((m) => m.data);
    const updates = w.drain('SEED_UPDATE').map((m) => m.data);
    return { done, found, updates, elapsedMs };
}

// The engine's own list of viable positions of `type` around the origin for `seed`.
async function viablePositions(mc, type, seed, dim, range) {
    const { regionBlocks } = (await w.call('GET_VERSION_SUPPORT', { mcVersion: mc, biomeIds: [], structTypes: [type] })).data;
    const regionsRange = Math.ceil(range / regionBlocks[type]) + 1;
    const { coords } = (await w.call('GET_STRUCTURES_IN_REGIONS', { mcVersion: mc, structType: type, seed, regionsRange, dimension: dim })).data;
    return coords.map((c) => Array.from(c));
}
const viableAt = async (mc, type, seed, dim, range, x, z) => (await viablePositions(mc, type, seed, dim, range)).some(([px, pz]) => px === x && pz === z);

const inBox = (s, range) => Math.abs(s.x) <= range && Math.abs(s.z) <= range;
const seedsOf = (found) => found.map((h) => h.seed);
const area = async (mc, seed, cells, dim, y) => Array.from((await w.call('GET_AREA', { mcVersion: mc, seed, startX: -cells, startY: -cells, widthX: 2 * cells, widthY: 2 * cells, dimension: dim, yHeight: y })).data.ids);

// Every hit is a BigInt seed carrying exactly `types`, each inside the box and at a
// position the engine itself calls viable. `oracleTypes` maps a UI type to the type the
// engine generates in that dimension (Ruined Portal -> Ruined_Portal_N in the Nether).
async function expectVerifiedHits(found, { mc = MC, dim = 0, range = 300, types, oracleTypes = {} }) {
    for (const hit of found) {
        expect(typeof hit.seed).toBe('bigint');
        expect(hit.structures.map((s) => s.type).sort()).toEqual([...types].sort());
        for (const s of hit.structures) {
            expect(inBox(s, range), `${JSON.stringify(s)} outside ±${range}`).toBe(true);
            const viable = await viableAt(mc, oracleTypes[s.type] ?? s.type, hit.seed, dim, range, s.x, s.z);
            expect(viable, `type ${s.type} at (${s.x}, ${s.z}) is not viable for seed ${hit.seed}`).toBe(true);
        }
    }
}

describe('structure searches', () => {
    it('Village ±300 on 26.3 streams exactly maxResults verified hits, some at negative coordinates', async () => {
        const { done, found } = await runShard(criteria({ structures: [VILLAGE], maxResults: 10, maxSeedsToScan: 50_000, startingSeed: '1' }));
        expect(found).toHaveLength(10);
        expect(done).toEqual({ shardId: 'test', examined: expect.any(Number), tested: expect.any(Number), hits: 10, error: null });
        expect(done.examined).toBeLessThanOrEqual(50_000);
        expect(done.tested).toBeGreaterThanOrEqual(10);
        await expectVerifiedHits(found, { types: [VILLAGE] });
        // The old finder only ever looked at region (0,0), so negative coordinates were unreachable.
        expect(found.some((h) => h.structures[0].x < 0 || h.structures[0].z < 0)).toBe(true);
        // hits carry the running counters, in order
        for (let i = 1; i < found.length; i++) expect(found[i].examined).toBeGreaterThan(found[i - 1].examined);
        expect(found.at(-1).examined).toBe(done.examined);
    });

    it('Village + Ruined Portal ±300: both present, each inside the box and viable', async () => {
        const { found } = await runShard(criteria({ structures: [VILLAGE, RUINED_PORTAL], maxResults: 3 }));
        expect(found).toHaveLength(3);
        await expectVerifiedHits(found, { types: [VILLAGE, RUINED_PORTAL] });
    });

    it('Nether: Fortress + Bastion ±500 in dimension -1, both viable there', async () => {
        const { found } = await runShard(criteria({ dimension: -1, structures: [FORTRESS, BASTION], rangeBlocks: 500, maxResults: 3 }));
        expect(found).toHaveLength(3);
        await expectVerifiedHits(found, { dim: -1, range: 500, types: [FORTRESS, BASTION] });
    });

    it('Ruined Portal (11) in the Nether searches the Nether portal config and reports the UI type', async () => {
        const { found } = await runShard(criteria({ dimension: -1, structures: [RUINED_PORTAL], maxResults: 2 }));
        expect(found).toHaveLength(2);
        await expectVerifiedHits(found, { dim: -1, types: [RUINED_PORTAL], oracleTypes: { [RUINED_PORTAL]: RUINED_PORTAL_N } });
    });

    it('GET_STRUCTURES_IN_REGIONS places Ruined Portal (11) with the Nether config in dimension -1 (1.17: 25-chunk regions)', async () => {
        const seed = '8091867987493326313';
        const at = async (type) => (await w.call('GET_STRUCTURES_IN_REGIONS', { mcVersion: MC_1_17, structType: type, seed, regionsRange: 4, dimension: -1 })).data.coords.map((c) => Array.from(c));
        const portals = await at(RUINED_PORTAL);
        expect(portals.length).toBeGreaterThan(0);
        expect(portals).toEqual(await at(RUINED_PORTAL_N));
        // Regions -4..3 of 400 blocks each => positions in [-1600, 1600); the Overworld
        // config (640-block regions) would reach [-2560, 2560).
        for (const [x, z] of portals) {
            expect(x).toBeGreaterThanOrEqual(-1600);
            expect(x).toBeLessThan(1600);
            expect(z).toBeGreaterThanOrEqual(-1600);
            expect(z).toBeLessThan(1600);
        }
    });

    it('End City ±1100 in the End: every hit is at least 1008 blocks out and viable', async () => {
        const { found } = await runShard(criteria({ dimension: 1, structures: [END_CITY], rangeBlocks: 1100, maxResults: 2 }));
        expect(found).toHaveLength(2);
        await expectVerifiedHits(found, { dim: 1, range: 1100, types: [END_CITY] });
        for (const [{ x, z }] of found.map((h) => h.structures)) expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(1008);
    });

    it('1.12 Village ±300 (32-chunk regions) is verified the same way', async () => {
        const { found } = await runShard(criteria({ mcVersion: MC_1_12, structures: [VILLAGE], maxResults: 3 }));
        expect(found).toHaveLength(3);
        await expectVerifiedHits(found, { mc: MC_1_12, types: [VILLAGE] });
    });

    it('reports the spawn the seed page shows (GET_SPAWN) for every hit', async () => {
        const { found } = await runShard(criteria({ structures: [VILLAGE], maxResults: 3, startingSeed: '777' }));
        expect(found).toHaveLength(3);
        for (const hit of found) {
            const { data } = await w.call('GET_SPAWN', { mcVersion: MC, seed: hit.seed });
            expect({ x: hit.spawnX, z: hit.spawnZ }).toEqual(data);
        }
    });
});

describe('biome searches', () => {
    it('Village + Plains ±300 at yHeight 256: the village is viable and the box contains plains', async () => {
        const { found } = await runShard(criteria({ structures: [VILLAGE], biomes: [PLAINS], maxResults: 2 }));
        expect(found).toHaveLength(2);
        await expectVerifiedHits(found, { types: [VILLAGE] });
        for (const hit of found) expect(await area(MC, hit.seed, 75, 0, 256)).toContain(PLAINS);
    });

    it('honours yHeight: Dripstone Caves ±100 at Y 0 is found, and the box really has it at Y 0', async () => {
        const { done, found } = await runShard(criteria({ biomes: [DRIPSTONE_CAVES], yHeight: 0, rangeBlocks: 100, maxResults: 1, maxSeedsToScan: 3000 }));
        expect(done.hits).toBe(1);
        expect(found[0].structures).toEqual([]);
        expect(await area(MC, found[0].seed, 25, 0, 0)).toContain(DRIPSTONE_CAVES);
    });

    it('biome-only hits carry the spawn too', async () => {
        const { found } = await runShard(criteria({ mcVersion: MC_1_17, biomes: [PLAINS], rangeBlocks: 100, maxResults: 2, maxSeedsToScan: 1000 }));
        expect(found).toHaveLength(2);
        for (const hit of found) {
            expect(await area(MC_1_17, hit.seed, 25, 0, 256)).toContain(PLAINS);
            expect({ x: hit.spawnX, z: hit.spawnZ }).toEqual((await w.call('GET_SPAWN', { mcVersion: MC_1_17, seed: hit.seed })).data);
        }
    });

    it('layered generator: 1.12 Plains ±100 is found and the box really has plains', async () => {
        const { done, found } = await runShard(criteria({ mcVersion: MC_1_12, biomes: [PLAINS], rangeBlocks: 100, maxResults: 2, maxSeedsToScan: 1000 }));
        expect(done.error).toBeNull();
        expect(done.hits).toBe(2);
        for (const hit of found) expect(await area(MC_1_12, hit.seed, 25, 0, 256)).toContain(PLAINS);
    });

    it('beta generator: Beta 1.7 Plains ±100 searches and reports hits with a spawn', async () => {
        // No GET_AREA oracle here: Beta 1.7 rendering depends on which version the worker
        // generated before (an upstream quirk), so the same seed can differ between the search
        // and a later GET_AREA. This pins the Beta code path (setBetaBiomeSeed, estimateSpawn).
        const { done, found } = await runShard(criteria({ mcVersion: VERSIONS['Beta 1.7'], biomes: [PLAINS], rangeBlocks: 100, maxResults: 2, maxSeedsToScan: 1000 }));
        expect(done.error).toBeNull();
        expect(done.hits).toBe(2);
        for (const hit of found) {
            expect(typeof hit.seed).toBe('bigint');
            expect(hit.structures).toEqual([]);
            expect(Number.isInteger(hit.spawnX) && Number.isInteger(hit.spawnZ)).toBe(true);
        }
    });
});

describe('candidate accounting (what the coordinator tiles on)', () => {
    it('a shard consumes exactly maxSeedsToScan candidates when the target is not reached', async () => {
        const { done, found } = await runShard(criteria({ mcVersion: MC_1_17, biomes: [PLAINS], rangeBlocks: 100, maxSeedsToScan: 1000, maxResults: 1e9 }));
        expect(done.examined).toBe(1000);
        expect(done.tested).toBe(1000);            // biome-only: one seed per candidate
        expect(done.hits).toBe(found.length);
        expect(done.hits).toBeGreaterThanOrEqual(1);
        expect(done.hits).toBeLessThan(1001);
        expect(done.error).toBeNull();
    });

    it.each([
        ['biome-only (1.17 Plains ±100)', () => criteria({ mcVersion: MC_1_17, biomes: [PLAINS], rangeBlocks: 100 })],
        ['structure (26.3 Mansion ±300)', () => criteria({ structures: [MANSION] })],
    ])('adjacent shards concatenate to one shard - same seeds, same order, no duplicates: %s', async (_, make) => {
        const a = await runShard({ ...make(), startingSeed: '0', maxSeedsToScan: 300, maxResults: 1e9 });
        const b = await runShard({ ...make(), startingSeed: '300', maxSeedsToScan: 300, maxResults: 1e9 });
        const all = await runShard({ ...make(), startingSeed: '0', maxSeedsToScan: 600, maxResults: 1e9 });
        expect([a.done.examined, b.done.examined, all.done.examined]).toEqual([300, 300, 600]);
        const joined = seedsOf(a.found).concat(seedsOf(b.found));
        expect(joined.length).toBeGreaterThan(0);
        expect(joined).toEqual(seedsOf(all.found));
        expect(new Set(joined.map(String)).size).toBe(joined.length);
        expect(a.done.tested + b.done.tested).toBe(all.done.tested);
        expect(a.done.hits + b.done.hits).toBe(all.done.hits);
    });

    it('never reports a seed below startingSeed (biome-only) or a family below it (structures)', async () => {
        const bio = await runShard(criteria({ mcVersion: MC_1_17, biomes: [PLAINS], rangeBlocks: 100, startingSeed: '5000000', maxSeedsToScan: 1000, maxResults: 5 }));
        expect(bio.found).toHaveLength(5);
        for (const h of bio.found) {
            expect(h.seed).toBeGreaterThanOrEqual(5_000_000n);
            expect(h.seed).toBeLessThan(5_001_000n);
        }
        const str = await runShard(criteria({ structures: [VILLAGE], startingSeed: '123456', maxResults: 5 }));
        expect(str.found).toHaveLength(5);
        for (const h of str.found) expect(h.seed & MASK48).toBeGreaterThanOrEqual(123456n);
    });

    it('starting seeds are 64-bit: a start beyond 2^53 is not rounded', async () => {
        const start = 9_223_372_036_854_775_000n;
        const { done, found } = await runShard(criteria({ mcVersion: MC_1_17, biomes: [PLAINS], rangeBlocks: 100, startingSeed: String(start), maxSeedsToScan: 100, maxResults: 1e9 }));
        expect(done.examined).toBe(100);
        expect(found.length).toBeGreaterThan(0);
        for (const h of found) {
            expect(h.seed).toBeGreaterThanOrEqual(start);
            expect(h.seed).toBeLessThan(start + 100n);
        }
    });

    it('a structure hit counts the family, not the 65 536 seeds behind it: tested >= hits, examined = families', async () => {
        const { done, found } = await runShard(criteria({ structures: [MANSION], startingSeed: '0', maxSeedsToScan: 300, maxResults: 1e9 }));
        expect(done.examined).toBe(300);
        expect(done.tested).toBeGreaterThanOrEqual(done.hits);
        expect(done.hits).toBe(found.length);
        for (const h of found) expect(h.tested).toBeGreaterThanOrEqual(h.examined);
    });
});

describe('progress (SEED_UPDATE is paced by time: at most ~10 per second per worker)', () => {
    // Loose upper bound on how many updates a run of `elapsedMs` may post at 100 ms pacing.
    const maxUpdates = (elapsedMs) => Math.ceil(elapsedMs / 100) + 1;

    it('biome-only on 26.3 ±300 (a check costs ~100 ms) ticks after nearly every check, with increasing counters', async () => {
        // A combination that never occurs within ±300, so no hit ends the shard early.
        const { updates, done, elapsedMs } = await runShard(criteria({ biomes: [PLAINS, MUSHROOM_FIELDS, ICE_SPIKES, JUNGLE, CHERRY_GROVE], maxSeedsToScan: 40, maxResults: 1e9 }));
        expect(done.examined).toBe(40);
        expect(updates.length).toBeGreaterThanOrEqual(2);
        expect(updates.length).toBeLessThanOrEqual(maxUpdates(elapsedMs));
        for (let i = 1; i < updates.length; i++) expect(updates[i].examined).toBeGreaterThan(updates[i - 1].examined);
        for (const u of updates) {
            expect(u.examined).toBeLessThanOrEqual(40);
            expect(u.tested).toBe(u.examined);
        }
    });

    it('structure mode ticks about every 100 ms with non-decreasing counters', async () => {
        const { updates, done, elapsedMs } = await runShard(criteria({ structures: [MANSION], rangeBlocks: 100, startingSeed: '0', maxSeedsToScan: 200_000, maxResults: 1e9 }));
        expect(done.examined).toBe(200_000);
        expect(elapsedMs).toBeGreaterThan(200);                  // otherwise the case proves nothing
        expect(updates.length).toBeGreaterThanOrEqual(2);
        expect(updates.length).toBeLessThanOrEqual(maxUpdates(elapsedMs));
        for (let i = 1; i < updates.length; i++) {
            expect(updates[i].examined).toBeGreaterThanOrEqual(updates[i - 1].examined);
            expect(updates[i].tested).toBeGreaterThanOrEqual(updates[i - 1].tested);
        }
        expect(updates.at(-1).examined).toBeLessThanOrEqual(200_000);
        expect(updates.at(-1).tested).toBeLessThanOrEqual(done.tested);
    });

    it('the fast 1.17 reject path (100 000+ seeds/s) does not flood the main thread', async () => {
        // Mushroom Fields + Ice Spikes + Jungle + Bamboo Jungle never share a ±100 box: the
        // layer pre-filter rejects each seed in microseconds.
        const { updates, done, elapsedMs } = await runShard(criteria({ mcVersion: MC_1_17, biomes: [PLAINS, MUSHROOM_FIELDS, ICE_SPIKES, JUNGLE, 168], rangeBlocks: 100, maxSeedsToScan: 50_000, maxResults: 1e9 }));
        expect(done.examined).toBe(50_000);
        expect(updates.length).toBeLessThanOrEqual(maxUpdates(elapsedMs));
    });

    it('a shard shorter than 100 ms posts no progress at all (DONE_FIND_SEEDS carries the totals)', async () => {
        const { updates, done } = await runShard(criteria({ mcVersion: MC_1_12, structures: [VILLAGE], maxResults: 3 }));
        expect(done.hits).toBe(3);
        expect(updates).toEqual([]);
    });
});

describe('errors are reported in DONE_FIND_SEEDS, never thrown', () => {
    it.each([
        ['unknown version', { mcVersion: 999, biomes: [PLAINS] }, -1],
        ['unknown dimension', { dimension: 2, biomes: [PLAINS] }, -2],
        ['structure missing on the version: Ancient City on 1.12', { mcVersion: MC_1_12, structures: [ANCIENT_CITY] }, -3],
        ['structure of another dimension: Fortress in the Overworld', { structures: [FORTRESS] }, -4],
        ['chunk-scale feature: End Gateway ±300', { dimension: 1, structures: [END_GATEWAY] }, -5],
        ['biome missing on the version: Cherry Grove on 1.12', { mcVersion: MC_1_12, biomes: [CHERRY_GROVE] }, -6],
        ['biome of another dimension: Plains in the Nether', { dimension: -1, biomes: [PLAINS] }, -6],
        ['range above 2048', { biomes: [PLAINS], rangeBlocks: 5000 }, -7],
        ['no criteria at all', {}, -7],
        ['maxResults 0', { biomes: [PLAINS], maxResults: 0 }, -7],
        ['too many structures', { structures: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, -7],
        ['biome box too large for the fixed 16 MB heap: ±2048 on 26.3', { biomes: [PLAINS], rangeBlocks: 2048 }, -8],
        ['End City inside its minimum distance: ±500', { dimension: 1, structures: [END_CITY], rangeBlocks: 500 }, -9],
    ])('%s -> error %i with zero counters', async (_, over, code) => {
        const { done, found, updates } = await runShard(criteria(over));
        expect(found).toEqual([]);
        expect(updates).toEqual([]);
        expect(done).toEqual({ shardId: 'test', examined: 0, tested: 0, hits: 0, error: { code, message: expect.any(String) } });
    });

    it('a malformed starting seed is an argument error, not an exception', async () => {
        const { done } = await runShard(criteria({ biomes: [PLAINS], startingSeed: 'not-a-seed' }));
        expect(done).toMatchObject({ examined: 0, hits: 0, error: { code: -7 } });
    });

    it('the worker is still alive after every error, and a biome box that fits (±1000 on 26.3) runs', async () => {
        expect((await w.call('GET_SPAWN', { mcVersion: MC, seed: '8091867987493326313' })).data).toEqual({ x: -32, z: 80 });
        const { done } = await runShard(criteria({ biomes: [PLAINS], rangeBlocks: 1000, maxSeedsToScan: 1, maxResults: 1 }));
        expect(done.error).toBeNull();
        expect(done.examined).toBe(1);
    });
});

describe('GET_VERSION_SUPPORT', () => {
    it('1.12: which of the requested biomes exist, each structure\'s dimension (-100 = none) and region size', async () => {
        const { data } = await w.call('GET_VERSION_SUPPORT', { mcVersion: MC_1_12, biomeIds: [PLAINS, CHERRY_GROVE], structTypes: [VILLAGE, TRIAL_CHAMBERS, FORTRESS] });
        expect(data.mcVersion).toBe(MC_1_12);
        expect(data.newest).toBe(Math.max(...Object.values(VERSIONS)));
        expect(data.biomes).toEqual([PLAINS]);
        expect(data.biomeDimensions).toEqual({ [PLAINS]: 0, [CHERRY_GROVE]: 0 });
        expect(data.structures).toEqual({ [VILLAGE]: 0, [TRIAL_CHAMBERS]: -100, [FORTRESS]: -1 });
        expect(data.regionBlocks[VILLAGE]).toBe(512);            // 32 chunks before 1.18
        expect(data.regionBlocks[TRIAL_CHAMBERS]).toBe(0);       // unsupported
    });

    it('26.3: village regions grew to 34 chunks, End cities need 1008 blocks, End gateways are chunk-scale', async () => {
        const { data } = await w.call('GET_VERSION_SUPPORT', { mcVersion: MC, biomeIds: [PLAINS, CHERRY_GROVE, 8, 9], structTypes: [VILLAGE, END_CITY, END_GATEWAY] });
        expect(data.biomes).toEqual([PLAINS, CHERRY_GROVE, 8, 9]);
        expect(data.biomeDimensions).toEqual({ [PLAINS]: 0, [CHERRY_GROVE]: 0, 8: -1, 9: 1 });
        expect(data.regionBlocks[VILLAGE]).toBe(544);
        expect(data.minDistance[END_CITY]).toBe(1008);
        expect(data.minDistance[VILLAGE]).toBe(0);
        expect(data.structures[END_CITY]).toBe(1);
        expect(data.regionBlocks[END_GATEWAY]).toBeLessThan(64); // the finder excludes chunk-scale types on this
    });
});
