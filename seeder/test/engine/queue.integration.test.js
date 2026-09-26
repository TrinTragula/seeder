// QueueManager against the real worker chain (worker.js + seeder.js + api.wasm),
// with vm-backed workers standing in for the browser's Worker. No browser needed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QueueManager } from '../../src/library/queue.js';
import { makeFakeWorkerClass, loadSeeder, WORKERS_DIR } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const MC = VERSIONS['26.3'];
const SEED = '8091867987493326313';
const PATH = '/workers/worker.js?v=it';
let VmWorker;

const loaded = (qm, n) => vi.waitFor(() => expect(qm.workers).toHaveLength(n), { timeout: 20_000 });
const colours = (qm) => vi.waitFor(() => expect(qm.COLORS).not.toBeNull(), { timeout: 20_000 });
const callback = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, fn: (...args) => resolve(args) }; };

beforeEach(() => {
    VmWorker = makeFakeWorkerClass();
    vi.stubGlobal('Worker', VmWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe.each([
    ['precompiled module', () => vi.stubGlobal('fetch', async () => new Response(fs.readFileSync(path.join(WORKERS_DIR, 'api.wasm')), { headers: { 'Content-Type': 'application/wasm' } }))],
    ['worker-side compile fallback', () => vi.stubGlobal('fetch', async () => { throw new Error('no network'); })],
])('pool boot via %s', (_, stubFetch) => {
    it('loads every worker and fetches the palette', async () => {
        stubFetch();
        const qm = new QueueManager(PATH, 2);
        await loaded(qm, 2);
        await colours(qm);
        expect(VmWorker.instances[0].posted?.length ?? 0).toBe(0);
        expect(qm.COLORS[1]).toEqual([141, 179, 96, 255]);
        qm.killAll();
    });
});

describe('real requests through the pool', () => {
    let qm, seeder;
    beforeEach(async () => {
        vi.stubGlobal('fetch', async () => { throw new Error('no network'); });
        qm = new QueueManager(PATH, 2);
        seeder = await loadSeeder();
        await loaded(qm, 2);
        await colours(qm);
    });
    afterEach(() => qm.killAll());

    it('draw() delivers the same tile the engine produces directly', async () => {
        const { promise, fn } = callback();
        qm.draw(MC, SEED, -75, 0, 75, 75, 0, 320, fn);
        const [{ rgba, ids }] = await promise;
        expect(ids).toEqual(seeder.getArea(MC, SEED, -75, 0, 75, 75, 0, 320).ids);
        expect(rgba.length).toBe(75 * 75 * 4);
        expect(qm.stats).toEqual({ areaRequests: 1, areaDone: 1 });
    });

    it('findSpawn / findStrongholds / getStructuresInRegions answer like the engine', async () => {
        const spawn = callback();
        qm.findSpawn(MC, SEED, spawn.fn);
        expect(await spawn.promise).toEqual([-32, 80]);

        const strongholds = callback();
        qm.findStrongholds(MC, SEED, 3, strongholds.fn);
        expect((await strongholds.promise)[0].coords.map((c) => Array.from(c))).toEqual([[-1356, 164], [644, -1484], [1108, 1524]]);

        const villages = callback();
        qm.getStructuresInRegions(MC, 5, SEED, 4, 0, villages.fn);
        expect((await villages.promise)[0].coords.map((c) => Array.from(c))).toEqual(seeder.getStructuresInRegions(MC, 5, SEED, 4, 0).map((c) => Array.from(c)));
    });

    it('request() resolves with the engine reply minus requestId, error included', async () => {
        const summary = await qm.request('SEED_SUMMARY', { mcVersion: MC, seed: SEED });
        expect(summary).toEqual({ spawnX: -32, spawnZ: 80, spawnBiome: expect.any(Number), approxHeight: expect.any(Number), error: null });
        expect(summary.spawnBiome).toBe(seeder.getArea(MC, SEED, -32 >> 2, 80 >> 2, 1, 1, 0, 256).ids[0]);
        // An engine error is an answer, not a rejection: the Nether has no biome centres (−2).
        const nether = await qm.request('BIOME_CENTERS', { mcVersion: MC, seed: SEED, dimension: -1, biomeId: 8, x: 0, z: 0, radiusBlocks: 500 });
        expect(nether).toEqual({ centers: [], error: { code: -2, message: expect.any(String) } });
    });

    it('a low-priority request issued right after 30 tiles resolves only after every tile has been delivered', async () => {
        const order = [];
        const tiles = [];
        for (let i = 0; i < 30; i++) {
            tiles.push(new Promise((resolve) => qm.draw(MC, SEED, i * 75, 0, 75, 75, 0, 320, () => { order.push(`tile ${i}`); resolve(); })));
        }
        const centers = qm.request('BIOME_CENTERS', { mcVersion: MC, seed: SEED, biomeId: 1, x: 0, z: 0, radiusBlocks: 1000 })
            .then((data) => { order.push('BIOME_CENTERS'); return data; });
        const [data] = await Promise.all([centers, ...tiles]);
        expect(data.error).toBeNull();
        expect(data.centers.length).toBeGreaterThan(0);
        expect(order).toHaveLength(31);
        expect(order.at(-1)).toBe('BIOME_CENTERS');
        expect(qm.stats.areaDone).toBe(30);
    });

    it('requestArea() answers a 500×500 area like the engine, after the tiles queued before it, off the tile counters', async () => {
        const order = [];
        const tiles = [];
        for (let i = 0; i < 20; i++) {
            tiles.push(new Promise((resolve) => qm.draw(MC, SEED, i * 75, 75, 75, 75, 0, 256, () => { order.push(`tile ${i}`); resolve(); })));
        }
        const params = { mcVersion: MC, seed: SEED, startX: -258, startY: -230, widthX: 500, widthY: 500, dimension: 0, yHeight: 256 };
        const area = qm.requestArea(params).then((data) => { order.push('area'); return data; });
        const [data] = await Promise.all([area, ...tiles]);
        expect(order).toHaveLength(21);
        expect(order.at(-1)).toBe('area');
        expect(data).toMatchObject(params);
        expect(data.ids).toHaveLength(500 * 500);
        expect(data.rgba).toHaveLength(500 * 500 * 4);
        expect(data.ids).toEqual(seeder.getArea(MC, SEED, -258, -230, 500, 500, 0, 256).ids);
        expect(qm.stats.areaDone).toBe(20);
        expect(qm.inFlight.size).toBe(0);
    });

    it('findSeeds() through the coordinator streams a verified hit, replaces only the shard worker, and the pool keeps serving tiles', async () => {
        // Pool of 2 → one shard at a time (the other worker is reserved for tiles).
        const mc = VERSIONS['1.17'];
        const hits = [];
        const done = new Promise((resolve) => qm.findSeeds(
            { mcVersion: mc, dimension: 0, yHeight: 256, biomes: [1], structures: [], rangeBlocks: 100, startingSeed: 0n, count: 1, maxSeedsToScan: 20_000n },
            { onHit: (h) => hits.push(h), onDone: (...args) => resolve(args) },
        ));
        const [doneHits, examined, reason, resumeSeed, extra] = await done;
        expect(reason).toBe('target');
        expect(doneHits).toHaveLength(1);
        expect(doneHits).toEqual(hits);
        expect(typeof hits[0].seed).toBe('bigint');
        expect(hits[0].index).toBe(0);
        expect(examined).toBeGreaterThan(0n);
        expect(resumeSeed).toBe(10_000n);                    // the one 10 000-seed shard dealt is skipped on resume
        expect(extra).toEqual({ tested: expect.any(Number), elapsedMs: expect.any(Number), error: null });
        expect(Array.from(seeder.getArea(mc, hits[0].seed, -25, -25, 50, 50, 0, 256).ids)).toContain(1);
        expect([hits[0].spawnX, hits[0].spawnZ]).toEqual(Array.from(seeder.findSpawn(mc, hits[0].seed)));
        // The shard worker was terminated and replaced; the reserved one never stopped answering.
        expect(VmWorker.instances.filter((w) => w.terminated)).toHaveLength(1);
        expect(qm.searching).toBe(false);
        const { promise, fn } = callback();
        qm.draw(MC, '1', 0, 0, 8, 8, 0, 320, fn);
        expect((await promise)[0].ids).toHaveLength(64);
        await loaded(qm, 2);
    });

    it('restartAll() replaces the pool and requests keep flowing', async () => {
        qm.restartAll();
        await loaded(qm, 2);
        const { promise, fn } = callback();
        qm.findSpawn(MC, SEED, fn);
        expect(await promise).toEqual([-32, 80]);
    });
});

// worker.js lets a trap escape without replying, and the pool deals the job again or fails
// it. Checked here against the real worker chain, where a reply sent before the crash
// would free the worker and get the job queued behind it blamed for the crash.
describe('a WASM trap inside a worker', () => {
    let qm;
    // The next `times` calls of this Seeder method trap, on every worker alive now
    // (replacements are new workers and never trap).
    const trapNext = (method, times = 1) => {
        let left = times;
        for (const vm of VmWorker.instances) {
            const seeder = vm.inner.context.seeder;
            if (!seeder) continue;
            const original = seeder[method];
            seeder[method] = function (...args) {
                if (left > 0) { left--; throw new WebAssembly.RuntimeError('unreachable'); }
                return original.apply(this, args);
            };
        }
    };
    const pool = async (n) => {
        vi.stubGlobal('fetch', async () => { throw new Error('no network'); });
        qm = new QueueManager(PATH, n);
        await loaded(qm, n);
        await colours(qm);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    };
    afterEach(() => qm.killAll());

    it('fails only the trapped job: the request queued behind it on the replacement gets its real answer', async () => {
        await pool(1);
        trapNext('findSpawn');
        const spawn = { cb: vi.fn(), onError: callback() };
        qm.findSpawn(MC, SEED, spawn.cb, spawn.onError.fn);
        const summary = qm.request('SEED_SUMMARY', { mcVersion: MC, seed: SEED });
        expect(await spawn.onError.promise).toEqual([{ code: 'WORKER_CRASH', message: expect.stringContaining('unreachable') }]);
        expect(spawn.cb).not.toHaveBeenCalled();
        await expect(summary).resolves.toMatchObject({ spawnX: -32, spawnZ: 80, error: null });
        expect(VmWorker.instances.filter((w) => w.terminated)).toHaveLength(1);
        await loaded(qm, 1);
    });

    it('a trapped dashboard request resolves WORKER_CRASH, and the replacement answers it next time', async () => {
        await pool(1);
        trapNext('seedSummary');
        await expect(qm.request('SEED_SUMMARY', { mcVersion: MC, seed: SEED }))
            .resolves.toEqual({ error: { code: 'WORKER_CRASH', message: expect.stringContaining('unreachable') } });
        await expect(qm.request('SEED_SUMMARY', { mcVersion: MC, seed: SEED })).resolves.toMatchObject({ spawnX: -32, error: null });
    });

    it('a trapped tile is generated again on another worker', async () => {
        await pool(2);
        const seeder = await loadSeeder();
        trapNext('getArea');
        const { promise, fn } = callback();
        qm.draw(MC, SEED, -75, 0, 75, 75, 0, 320, fn);
        const [{ ids }] = await promise;
        expect(ids).toEqual(seeder.getArea(MC, SEED, -75, 0, 75, 75, 0, 320).ids);
        expect(VmWorker.instances.filter((w) => w.terminated)).toHaveLength(1);
        expect(qm.inFlight.size).toBe(0);
    });

    it('a trapped search shard is dealt again and the search still reaches its target', async () => {
        await pool(2);
        trapNext('findSeeds');
        const done = new Promise((resolve) => qm.findSeeds(
            { mcVersion: VERSIONS['1.17'], dimension: 0, yHeight: 256, biomes: [1], structures: [], rangeBlocks: 100, startingSeed: 0n, count: 1, maxSeedsToScan: 20_000n },
            { onDone: (...args) => resolve(args) },
        ));
        const [hits, , reason, , { error }] = await done;
        expect(reason).toBe('target');
        expect(error).toBeNull();
        expect(hits).toHaveLength(1);
    });
});
