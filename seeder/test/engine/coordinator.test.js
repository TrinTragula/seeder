// The search coordinator (QueueManager.findSeeds, src/library/queue.js) driving the
// real worker chain (worker.js + seeder.js + api.wasm) through vm-backed workers.
// The unit tests in src/library/queue.test.js script every message by hand; here the
// engine produces them, so shard tiling, hit accounting, STOP and the tile
// reservation are checked against what the WASM really streams.
//
// The vm workers run one at a time on this thread and deliver their messages
// afterwards, in order: two shards dealt together both finish before either one's
// first message is seen. Timing assertions below are chosen with that in mind.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QueueManager, shardLenFor, DEFAULT_MAX_SCAN, MASK48 } from '../../src/library/queue.js';
import { makeFakeWorkerClass, loadSeeder, WORKERS_DIR } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const MC = VERSIONS['26.3'];
const MC_1_17 = VERSIONS['1.17'];
const MC_1_12 = VERSIONS['1.12'];
const NEWEST = Math.max(...Object.values(VERSIONS));
// StructureType ints (cubiomes/finders.h) and BiomeID ints (cubiomes/biomes.h).
const VILLAGE = 5, MANSION = 9, ANCIENT_CITY = 13, TRIAL_CHAMBERS = 25;
const PLAINS = 1, ICE_SPIKES = 140, CHERRY_GROVE = 185;
const PATH = '/workers/worker.js?v=coordinator';

let VmWorker, qm, posts;
const loaded = (pool, n) => vi.waitFor(() => expect(pool.workers).toHaveLength(n), { timeout: 20_000 });
const colours = (pool) => vi.waitFor(() => expect(pool.COLORS).not.toBeNull(), { timeout: 20_000 });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const findSeedsPosts = () => posts.filter((p) => p.message.kind === 'FIND_SEEDS');
const shards = () => findSeedsPosts().map((p) => p.message.data);

// Record everything the pool posts; for FIND_SEEDS also how many shards were live.
function spyPosts(Cls) {
    const original = Cls.prototype.postMessage;
    const recorded = [];
    vi.spyOn(Cls.prototype, 'postMessage').mockImplementation(function (message) {
        recorded.push({ worker: this, message, liveShards: qm?.search?.live.size ?? 0 });
        return original.call(this, message);
    });
    return recorded;
}

const village = (over = {}) => ({ mcVersion: MC, dimension: 0, yHeight: 256, biomes: [], structures: [VILLAGE], rangeBlocks: 300, startingSeed: 1000n, count: 5, ...over });
const iceSpikes = (over = {}) => ({ mcVersion: MC_1_17, dimension: 0, yHeight: 256, biomes: [ICE_SPIKES], structures: [], rangeBlocks: 100, startingSeed: 12_345n, count: 1e9, maxSeedsToScan: 30_000n, ...over });
const ancientCity = () => ({ mcVersion: MC_1_12, dimension: 0, yHeight: 256, biomes: [], structures: [ANCIENT_CITY], rangeBlocks: 300, startingSeed: 0n, count: 5 });

// Start a search and collect everything it reports; `done` resolves with onDone's arguments.
function run(pool, criteria, hooks = {}) {
    const search = { hits: [], progress: [], doneAt: null, handle: null };
    search.done = new Promise((resolve) => {
        search.handle = pool.findSeeds(criteria, {
            onHit: (h) => { search.hits.push(h); hooks.onHit?.(h, search); },
            onProgress: (p) => { search.progress.push(p); hooks.onProgress?.(p, search); },
            onDone: (hits, examined, reason, resumeSeed, extra) => {
                search.doneAt = performance.now();
                resolve({ hits, examined, reason, resumeSeed, ...extra });
            },
        });
    });
    return search;
}
const tile = (pool) => {
    const t = { at: null };
    t.done = new Promise((resolve) => pool.draw(MC, '1', 0, 0, 8, 8, 0, 320, (r) => { t.at = performance.now(); resolve(r); }));
    return t;
};

beforeEach(() => {
    VmWorker = makeFakeWorkerClass();
    vi.stubGlobal('Worker', VmWorker);
    // The precompiled-module path QueueManager uses in the browser.
    vi.stubGlobal('fetch', async () => new Response(fs.readFileSync(path.join(WORKERS_DIR, 'api.wasm')), { headers: { 'Content-Type': 'application/wasm' } }));
    posts = spyPosts(VmWorker);
    qm = null;
});
afterEach(() => {
    qm?.killAll();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('findSeeds through the pool', () => {
    it('target: Village ±300, count 5, pool of 3 → 5 unique verified hits from at most 2 live shards while a tile is served by the reserved worker', async () => {
        qm = new QueueManager(PATH, 3);
        await loaded(qm, 3);
        await colours(qm);
        const seeder = await loadSeeder();
        const search = run(qm, village());
        // The reserved worker takes the tile at once: it is not queued behind the shards
        // and it goes to a worker that holds no shard.
        const t = tile(qm);
        expect(qm.pending).toHaveLength(0);
        const tilePost = posts.find((p) => p.message.kind === 'GET_AREA');
        expect(tilePost).toBeDefined();
        expect(findSeedsPosts().map((p) => p.worker)).not.toContain(tilePost.worker);
        expect(findSeedsPosts()).toHaveLength(2);

        const result = await search.done;
        expect(result.reason).toBe('target');
        expect(result.error).toBeNull();
        expect(result.hits).toHaveLength(5);
        expect(result.hits).toEqual(search.hits);
        expect(new Set(result.hits.map((h) => String(h.seed))).size).toBe(5);
        for (const [i, h] of result.hits.entries()) {
            expect(typeof h.seed).toBe('bigint');
            expect(h.index).toBe(i);
            expect(h.structures).toEqual([{ type: VILLAGE, x: expect.any(Number), z: expect.any(Number) }]);
            const [{ x, z }] = h.structures;
            expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(300);
            // The engine's own list of viable villages around the origin (34-chunk regions on 26.3) contains it.
            expect(seeder.getStructuresInRegions(MC, VILLAGE, h.seed, 2, 0).map((c) => Array.from(c))).toContainEqual([x, z]);
            expect([h.spawnX, h.spawnZ]).toEqual(Array.from(seeder.findSpawn(MC, h.seed)));
        }
        expect(result.examined).toBeGreaterThan(0n);
        expect(result.tested).toBeGreaterThanOrEqual(5);
        expect(result.resumeSeed).toBeGreaterThanOrEqual(1000n);
        expect(result.resumeSeed).toBe(1000n + 2n * 250_000n);          // both dealt shards are skipped on resume
        expect(typeof result.elapsedMs).toBe('number');
        for (const p of findSeedsPosts()) expect(p.liveShards).toBeLessThanOrEqual(2);
        expect(new Set(findSeedsPosts().map((p) => p.worker)).size).toBe(2);
        expect(shards().map((s) => s.maxResults)).toEqual([5, 5]);
        expect((await t.done).ids).toHaveLength(64);
        expect(qm.searching).toBe(false);
        await loaded(qm, 3);                                                // the two shard workers were replaced
    });

    it('stop is synchronous: onDone fires inside stopSearch(), exactly the live shard workers are replaced, tiles keep flowing, no hit arrives later', async () => {
        qm = new QueueManager(PATH, 3);
        await loaded(qm, 3);
        await colours(qm);
        const instancesBefore = VmWorker.instances.length;
        const shardWorkers = () => [...VmWorker.instances].filter((w) => findSeedsPosts().some((p) => p.worker === w));
        let liveAtStop = null, doneInsideStop = false, hitsAtStop = null, progressAtStop = null;
        // Mansion ±100: stage 1 rejects ~212 000 families/s, so a 250 000-family shard runs
        // over a second and posts several time-paced SEED_UPDATEs (and a few hits).
        const search = run(qm, { mcVersion: MC, dimension: 0, yHeight: 256, biomes: [], structures: [MANSION], rangeBlocks: 100, startingSeed: 0n, count: 1e9 }, {
            onProgress: (p, s) => {
                if (liveAtStop !== null) return;
                liveAtStop = qm.search.live.size;
                progressAtStop = p;
                qm.stopSearch();
                doneInsideStop = s.doneAt !== null;
                hitsAtStop = s.hits.length;
            },
        });
        const result = await search.done;
        expect(doneInsideStop).toBe(true);
        expect(result.reason).toBe('stopped');
        expect(result.error).toBeNull();
        expect(liveAtStop).toBe(2);
        expect(VmWorker.instances).toHaveLength(instancesBefore + liveAtStop);
        for (const w of shardWorkers()) expect(w.terminated).toBe(true);
        expect(VmWorker.instances.filter((w) => w.terminated)).toHaveLength(2);
        expect(result.hits).toHaveLength(hitsAtStop);
        expect(result.examined).toBe(progressAtStop.examined);
        expect(result.examined).toBeGreaterThan(0n);
        expect(result.resumeSeed).toBe(2n * 250_000n);                      // the two shards' tails are skipped
        expect(qm.searching).toBe(false);
        qm.stopSearch();                                                    // idle: no-op, onDone not repeated
        await loaded(qm, 3);
        expect((await tile(qm).done).ids).toHaveLength(64);
        await tick(300);
        expect(search.hits).toHaveLength(hitsAtStop);
        expect(search.progress.filter((p) => p !== progressAtStop).every((p) => p.examined <= progressAtStop.examined)).toBe(true);
    });

    it('exhausted: 1.17 Ice Spikes ±100 over 30 000 seeds tiles the space with contiguous shards, monotonic progress, and a tile answered mid-search', async () => {
        qm = new QueueManager(PATH, 3);
        await loaded(qm, 3);
        await colours(qm);
        const seeder = await loadSeeder();
        const start = 12_345n;
        const search = run(qm, iceSpikes({ startingSeed: start }));
        const t = tile(qm);
        const result = await search.done;
        expect(result.reason).toBe('exhausted');
        expect(result.error).toBeNull();
        expect(result.examined).toBe(30_000n);
        expect(result.tested).toBe(30_000);                                 // biome-only: one seed per candidate
        expect(result.resumeSeed).toBe(start + 30_000n);
        expect(result.hits.length).toBeGreaterThan(0);
        expect(new Set(result.hits.map((h) => String(h.seed))).size).toBe(result.hits.length);
        expect(result.hits.map((h) => h.index)).toEqual(result.hits.map((_, i) => i));
        for (const h of result.hits) {
            expect(h.seed >= start && h.seed < start + 30_000n).toBe(true);
            expect(Array.from(seeder.getArea(MC_1_17, h.seed, -25, -25, 50, 50, 0, 256).ids)).toContain(ICE_SPIKES);
        }
        // Three 10 000-seed shards, contiguous, summing to the scan.
        expect(shards().map((s) => s.startingSeed)).toEqual(['12345', '22345', '32345']);
        expect(shards().reduce((n, s) => n + s.maxSeedsToScan, 0)).toBe(30_000);
        for (const s of shards()) expect(s.maxResults).toBeGreaterThanOrEqual(1);
        const examined = search.progress.map((p) => p.examined);
        expect(examined.length).toBeGreaterThan(0);
        for (const e of examined) expect(typeof e).toBe('bigint');
        for (let i = 1; i < examined.length; i++) expect(examined[i] >= examined[i - 1]).toBe(true);
        expect(examined.at(-1)).toBe(30_000n);
        expect(search.progress.at(-1).hits).toBe(result.hits.length);
        // The tile requested right after findSeeds() came back while the search was still running.
        expect((await t.done).ids).toHaveLength(64);
        expect(t.at).toBeLessThan(search.doneAt);
        expect(VmWorker.instances).toHaveLength(3);                         // exhausted ends with no live shard: nothing replaced
        expect(VmWorker.instances.every((w) => !w.terminated)).toBe(true);
    });

    it('error: Ancient City on 1.12 ends with reason error and code -3, no worker terminated, pool reusable at once', async () => {
        qm = new QueueManager(PATH, 2);                                     // N-1 = 1: the erroring shard is the only live one
        await loaded(qm, 2);
        await colours(qm);
        const search = run(qm, ancientCity());
        const result = await search.done;
        expect(result.reason).toBe('error');
        expect(result.error).toEqual({ code: -3, message: expect.stringMatching(/does not exist in this Minecraft version/) });
        expect(result.hits).toEqual([]);
        expect(result.examined).toBe(0n);
        expect(result.tested).toBe(0);
        expect(result.resumeSeed).toBe(250_000n);
        expect(VmWorker.instances).toHaveLength(2);
        expect(VmWorker.instances.every((w) => !w.terminated)).toBe(true);
        expect(qm.workers).toHaveLength(2);
        expect(qm.workers.every((w) => !w.busy)).toBe(true);
        expect(qm.searching).toBe(false);
        const again = run(qm, village({ count: 1 }));
        expect((await again.done).reason).toBe('target');
    });

    it('error with a sibling shard live (pool of 3): the first error ends the search, the sibling is replaced and the pool heals', async () => {
        qm = new QueueManager(PATH, 3);
        await loaded(qm, 3);
        await colours(qm);
        const result = await run(qm, ancientCity()).done;
        expect(result.reason).toBe('error');
        expect(result.error.code).toBe(-3);
        expect(VmWorker.instances.filter((w) => w.terminated)).toHaveLength(1);
        await loaded(qm, 3);
        expect((await tile(qm).done).ids).toHaveLength(64);
    });

    it('N = 1: the single worker alternates shards and tiles - a tile asked for after the first DONE_FIND_SEEDS is answered before onDone', async () => {
        qm = new QueueManager(PATH, 1);
        await loaded(qm, 1);
        await colours(qm);
        let t = null;
        const search = run(qm, iceSpikes({ startingSeed: 0n }), {
            onProgress: () => {
                // The first DONE_FIND_SEEDS folds its 10 000 seeds into the completed totals.
                if (!t && qm.search.completedExamined >= 10_000n) t = tile(qm);
            },
        });
        const result = await search.done;
        expect(result.reason).toBe('exhausted');
        expect(result.examined).toBe(30_000n);
        expect(result.resumeSeed).toBe(30_000n);
        expect(t).not.toBeNull();
        expect((await t.done).ids).toHaveLength(64);
        expect(t.at).toBeLessThan(search.doneAt);
        expect(shards().map((s) => s.startingSeed)).toEqual(['0', '10000', '20000']);
        // Tiles go first: the tile was posted between the first and the second shard.
        const order = posts.map((p) => p.message.kind).filter((k) => k === 'FIND_SEEDS' || k === 'GET_AREA');
        expect(order).toEqual(['FIND_SEEDS', 'GET_AREA', 'FIND_SEEDS', 'FIND_SEEDS']);
        expect(VmWorker.instances).toHaveLength(1);
    });

    it('late loading: a search started before any worker has loaded completes once they arrive', async () => {
        qm = new QueueManager(PATH, 2);
        expect(qm.workers).toHaveLength(0);
        const search = run(qm, village({ count: 3 }));
        expect(findSeedsPosts()).toHaveLength(0);
        const result = await search.done;
        expect(result.reason).toBe('target');
        expect(result.hits).toHaveLength(3);
        await loaded(qm, 2);
        await colours(qm);
    });

    it('getVersionSupport(1.12, [Plains, Cherry Grove], [Village, Trial Chambers]) resolves like the engine, also before the pool has loaded', async () => {
        qm = new QueueManager(PATH, 2);
        const support = await qm.getVersionSupport(MC_1_12, [PLAINS, CHERRY_GROVE], [VILLAGE, TRIAL_CHAMBERS]);
        expect(support).toEqual({
            mcVersion: MC_1_12, newest: NEWEST,
            biomes: [PLAINS], biomeDimensions: { [PLAINS]: 0, [CHERRY_GROVE]: 0 },
            structures: { [VILLAGE]: 0, [TRIAL_CHAMBERS]: -100 },
            regionBlocks: { [VILLAGE]: 512, [TRIAL_CHAMBERS]: 0 },
            minDistance: { [VILLAGE]: 0, [TRIAL_CHAMBERS]: 0 },
        });
        await loaded(qm, 2);
        expect(qm.workers.every((w) => !w.busy)).toBe(true);
    });
});

describe('shardLenFor against the measured engine', () => {
    it('structure → 250 000; 1.17 biome → 10 000; 26.3 ±300 biome → 8..40; Nether ±300 → 342; End ±300 → 26', () => {
        expect(shardLenFor(village())).toBe(250_000);
        expect(shardLenFor({ mcVersion: MC_1_17, dimension: 0, biomes: [PLAINS], structures: [], rangeBlocks: 100 })).toBe(10_000);
        const overworld = shardLenFor({ mcVersion: MC, dimension: 0, biomes: [PLAINS], structures: [], rangeBlocks: 300 });
        expect(overworld).toBeGreaterThanOrEqual(8);
        expect(overworld).toBeLessThanOrEqual(40);
        expect(shardLenFor({ mcVersion: MC, dimension: -1, biomes: [8], structures: [], rangeBlocks: 300 })).toBe(342);
        expect(shardLenFor({ mcVersion: MC, dimension: 1, biomes: [9], structures: [], rangeBlocks: 300 })).toBe(26);
    });

    it('a full End biome check really costs tens of milliseconds, so an End shard is ~26 seeds, not the 7 000 the pre-measurement model said', async () => {
        const seeder = await loadSeeder();
        const len = shardLenFor({ mcVersion: MC, dimension: 1, biomes: [9], structures: [], rangeBlocks: 300 });
        const t0 = performance.now();
        // the_end + small_end_islands never share ±300 (only the_end exists within ~1000
        // blocks), so no hit ends the shard early and every seed pays the full generation.
        const r = seeder.findSeeds({ mcVersion: MC, dimension: 1, yHeight: 256, biomes: [9, 40], structures: [], rangeBlocks: 300, startingSeed: '0', maxSeedsToScan: len, maxResults: 1e9 });
        const ms = performance.now() - t0;
        expect(r).toMatchObject({ examined: len, hits: 0, error: null });
        expect(ms).toBeGreaterThan(200);
        expect(ms).toBeLessThan(10_000);
    });

    it('a 26.3 ±300 biome shard really takes about a second on one worker', async () => {
        const seeder = await loadSeeder();
        const len = shardLenFor({ mcVersion: MC, dimension: 0, biomes: [PLAINS], structures: [], rangeBlocks: 300 });
        const t0 = performance.now();
        // A biome set that never occurs together, so no hit ends the shard early.
        const r = seeder.findSeeds({ mcVersion: MC, dimension: 0, yHeight: 256, biomes: [PLAINS, 14, 140, 21, CHERRY_GROVE], structures: [], rangeBlocks: 300, startingSeed: '0', maxSeedsToScan: len, maxResults: 1e9 });
        const ms = performance.now() - t0;
        expect(r.examined).toBe(len);
        expect(ms).toBeGreaterThan(200);
        expect(ms).toBeLessThan(10_000);
    });

    it('exports the candidate-space constants the finder UI shares', () => {
        expect(DEFAULT_MAX_SCAN).toBe(50_000_000n);
        expect(MASK48).toBe((1n << 48n) - 1n);
    });
});
