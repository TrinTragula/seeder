// QueueManager: the Web Worker pool. Workers are scripted fakes here, so these tests
// pin down the scheduling contract (dispatch, dedup, queueing, sharding, restart)
// independently of the WASM. test/engine/queue.integration.test.js runs the same
// class against the real worker chain.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueManager, shardLenFor, DEFAULT_MAX_SCAN } from './queue';
import { FakeWorker, FAKE_COLORS } from '../test/fakes';

const PATH = '/workers/worker.js?v=1.2.3';
const fakeModule = { fake: 'WebAssembly.Module' };

// Boot a pool: workers spawned, INIT delivered, every worker reports DONE_LOADING,
// and the constructor's GET_COLORS round trip completed. (The palette request is
// queued by the constructor and posted to the first worker that loads.)
async function readyPool(n = 2, { colors = true } = {}) {
    const qm = new QueueManager(PATH, n);
    await vi.advanceTimersByTimeAsync(1);                    // _modulePromise resolves -> INIT posted
    for (const w of FakeWorker.live()) w.emit('DONE_LOADING');
    if (colors) {
        const w = FakeWorker.live().find((x) => x.lastPosted('GET_COLORS'));
        w.emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
        await vi.advanceTimersByTimeAsync(0);                // the palette lands in a .then()
    }
    return qm;
}
const area = (over = {}) => ({ mcVersion: 35, seed: '123', startX: 0, startY: 0, widthX: 75, widthY: 75, dimension: 0, yHeight: 320, ...over });
const areaArgs = (a) => [a.mcVersion, a.seed, a.startX, a.startY, a.widthX, a.widthY, a.dimension, a.yHeight];

beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.reset();
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Uint8Array([0, 97, 115, 109])))));
    vi.spyOn(WebAssembly, 'compileStreaming').mockResolvedValue(fakeModule);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('boot', () => {
    it('spawns the requested number of workers from the given path', () => {
        const qm = new QueueManager(PATH, 3);
        expect(FakeWorker.instances).toHaveLength(3);
        expect(FakeWorker.instances.map((w) => w.path)).toEqual([PATH, PATH, PATH]);
        expect(qm.numberOfWorkers).toBe(3);
    });

    it('defaults the pool size to navigator.hardwareConcurrency', () => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { value: 5, configurable: true });
        expect(new QueueManager(PATH).numberOfWorkers).toBe(5);
    });

    it('compiles api.wasm once (next to worker.js, same cache-buster) and hands the module to every worker', async () => {
        new QueueManager(PATH, 2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('/workers/api.wasm?v=1.2.3');
        for (const w of FakeWorker.instances) expect(w.posted[0]).toEqual({ kind: 'INIT', module: fakeModule });
    });

    it('falls back to compiling from an ArrayBuffer when compileStreaming is unavailable', async () => {
        vi.stubGlobal('WebAssembly', { compile: vi.fn().mockResolvedValue(fakeModule) });
        new QueueManager(PATH, 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(WebAssembly.compile).toHaveBeenCalledTimes(1);
        expect(FakeWorker.instances[0].posted[0]).toEqual({ kind: 'INIT', module: fakeModule });
    });

    it('sends INIT with module: null when the wasm cannot be compiled, so workers compile it themselves', async () => {
        WebAssembly.compileStreaming.mockRejectedValue(new Error('bad magic'));
        fetch.mockRejectedValue(new Error('offline'));
        new QueueManager(PATH, 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(FakeWorker.instances[0].posted[0]).toEqual({ kind: 'INIT', module: null });
    });

    it('adds a worker to the pool only once it reports DONE_LOADING', async () => {
        const qm = new QueueManager(PATH, 2);
        await vi.advanceTimersByTimeAsync(1);
        expect(qm.workers).toHaveLength(0);
        FakeWorker.instances[0].emit('DONE_LOADING');
        expect(qm.workers).toHaveLength(1);
        // The first worker to load is handed the palette request the constructor queued.
        expect(FakeWorker.instances[0].postedKinds()).toEqual(['INIT', 'GET_COLORS']);
        FakeWorker.instances[0].emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
        expect(qm.workers[0].busy).toBe(false);
    });

    it('asks a worker for the palette as soon as one is free and stores it in COLORS', async () => {
        const qm = await readyPool(2, { colors: false });
        const asked = FakeWorker.live().filter((w) => w.lastPosted('GET_COLORS'));
        expect(asked).toHaveLength(1);
        expect(qm.COLORS).toBeNull();
        asked[0].emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
        await vi.advanceTimersByTimeAsync(0);
        expect(qm.COLORS).toBe(FAKE_COLORS);
        expect(asked[0].busy).toBeFalsy();
    });
});

describe('tile requests (draw)', () => {
    it('posts GET_AREA with the exact payload to a free worker', async () => {
        const qm = await readyPool(1);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        expect(FakeWorker.live()[0].lastPosted('GET_AREA')).toEqual({ kind: 'GET_AREA', data: a });
        expect(qm.stats.areaRequests).toBe(1);
    });

    it('delivers { rgba, ids } to the callback and frees the worker', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        const a = area();
        qm.draw(...areaArgs(a), cb);
        const rgba = new Uint8ClampedArray(4), ids = new Int32Array(1);
        FakeWorker.live()[0].emit('DONE_GET_AREA', { ...a, rgba, ids });
        expect(cb).toHaveBeenCalledWith({ rgba, ids });
        expect(qm.stats.areaDone).toBe(1);
        expect(qm.workers[0].busy).toBe(false);
    });

    it('drops a duplicate request for a tile that is already in flight', async () => {
        const qm = await readyPool(2);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        qm.draw(...areaArgs(a), vi.fn());
        expect(FakeWorker.live().flatMap((w) => w.postedKinds()).filter((k) => k === 'GET_AREA')).toHaveLength(1);
        expect(qm.pending).toHaveLength(0);
    });

    it('queues requests when every worker is busy and drains them as workers free up', async () => {
        const qm = await readyPool(1);
        const first = area({ startX: 0 }), second = area({ startX: 75 }), third = area({ startX: 150 });
        qm.draw(...areaArgs(first), vi.fn());
        qm.draw(...areaArgs(second), vi.fn());
        qm.draw(...areaArgs(third), vi.fn());
        const w = FakeWorker.live()[0];
        expect(w.postedKinds().filter((k) => k === 'GET_AREA')).toHaveLength(1);
        expect(qm.pending.map((j) => j.startX)).toEqual([75, 150]);
        w.emit('DONE_GET_AREA', { ...first, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });
        expect(w.lastPosted('GET_AREA').data).toEqual(second);
        expect(qm.pending.map((j) => j.startX)).toEqual([150]);
    });

    it('allows the same tile to be requested again once its result arrived', async () => {
        const qm = await readyPool(1);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        FakeWorker.live()[0].emit('DONE_GET_AREA', { ...a, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });
        qm.draw(...areaArgs(a), vi.fn());
        expect(FakeWorker.live()[0].postedKinds().filter((k) => k === 'GET_AREA')).toHaveLength(2);
    });
});

describe('seed searches (findSeeds)', () => {
    // Structure mode: 250 000-family shards; startingSeed 1000 → shards at 1000, 251000, 501000 …
    const CRITERIA = { mcVersion: 35, dimension: 0, yHeight: 256, biomes: [], structures: [5], rangeBlocks: 300, startingSeed: 1000n, count: 3 };
    const hit = (seed, over = {}) => ({ seed, spawnX: 8, spawnZ: -24, structures: [{ type: 5, x: 100, z: -200 }], examined: 1, tested: 1, ...over });
    const cbs = () => ({ onHit: vi.fn(), onProgress: vi.fn(), onDone: vi.fn() });
    const shardWorkers = () => FakeWorker.live().filter((w) => w.lastPosted('FIND_SEEDS'));
    const shardPosts = () => FakeWorker.instances.flatMap((w) => w.posted.filter((m) => m.kind === 'FIND_SEEDS').map((m) => m.data));
    // Reply DONE_FIND_SEEDS for the shard the worker is running.
    const done = (w, over = {}) => w.emit('DONE_FIND_SEEDS', { shardId: w.lastPosted('FIND_SEEDS').data.shardId, examined: 0, tested: 0, hits: 0, error: null, ...over });
    const blank = (a) => ({ ...a, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });

    it('passes the any-of and avoid lists to every shard; with no structure the search stays in biome mode', async () => {
        const qm = await readyPool(3);
        qm.findSeeds({ ...CRITERIA, structures: [], anyBiomes: [12, 140], excludeBiomes: [0, 24] }, cbs());
        const posts = shardPosts();
        expect(posts).toHaveLength(2);
        for (const post of posts) expect(post).toMatchObject({ biomes: [], anyBiomes: [12, 140], excludeBiomes: [0, 24], structures: [] });
        // Biome mode: 64-bit seeds, so the start is not folded to its lower 48 bits.
        expect(posts[0].startingSeed).toBe('1000');
        expect(BigInt(posts[1].startingSeed) - BigInt(posts[0].startingSeed)).toBe(BigInt(posts[0].maxSeedsToScan));
    });

    it('deals disjoint, consecutive shards to at most N-1 workers and keeps one free for tiles', async () => {
        const qm = await readyPool(3);
        const c = cbs();
        const handle = qm.findSeeds(CRITERIA, c);
        expect(handle).toEqual({ id: 1, stop: expect.any(Function) });
        expect(qm.searching).toBe(true);
        const posts = shardPosts();
        expect(posts).toHaveLength(2);
        expect(posts[0]).toEqual({ shardId: '1-0', mcVersion: 35, dimension: 0, yHeight: 256, biomes: [], anyBiomes: [], excludeBiomes: [], structures: [5], rangeBlocks: 300, startingSeed: '1000', maxSeedsToScan: 250_000, maxResults: 3 });
        expect(posts[1]).toMatchObject({ shardId: '1-1', startingSeed: '251000', maxSeedsToScan: 250_000, maxResults: 3 });
        expect(qm.workers.filter((w) => w.busy)).toHaveLength(2);
        // The reserved worker takes a tile at once instead of queueing it behind the search.
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        expect(qm.pending).toHaveLength(0);
        const tileWorker = FakeWorker.live().find((w) => w.lastPosted('GET_AREA'));
        expect(tileWorker.lastPosted('FIND_SEEDS')).toBeUndefined();
        expect(c.onDone).not.toHaveBeenCalled();
    });

    it('sends a Large Biomes search packed (engineVersion) to every shard; the cost model reads the plain version', async () => {
        const qm = await readyPool(3);
        qm.findSeeds({ ...CRITERIA, mcVersion: 20, largeBiomes: true, structures: [], biomes: [21] }, cbs());
        const posts = shardPosts();
        expect(posts).toHaveLength(2);
        for (const post of posts) expect(post.mcVersion).toBe(20 | (1 << 16));
        // 1.16.5 biome-only is a layer-stack shard (10 000 seeds), not the 1.18+ noise one.
        expect(posts[0].maxSeedsToScan).toBe(10_000);
        expect(posts[0]).not.toHaveProperty('largeBiomes');
    });

    it('a Default search sends the plain version; a Nether search of a Large Biomes world the packed one', async () => {
        const qm = await readyPool(2);
        qm.findSeeds({ ...CRITERIA, largeBiomes: false }, cbs());
        expect(shardPosts().at(-1).mcVersion).toBe(35);
        qm.stopSearch();
        qm.findSeeds({ ...CRITERIA, dimension: -1, structures: [18], largeBiomes: true }, cbs());
        // The hits' Overworld spawn is the Large Biomes world's.
        expect(shardPosts().at(-1)).toMatchObject({ dimension: -1, mcVersion: 35 | (1 << 16) });
    });

    it('GET_AREA keys separate Default and Large Biomes tiles', async () => {
        const qm = await readyPool(1);
        expect(qm.getAreaKey(35 | (1 << 16), '1', 0, 0, 75, 75, 0, 256)).not.toBe(qm.getAreaKey(35, '1', 0, 0, 75, 75, 0, 256));
    });

    it('refuses a second search while one is running', async () => {
        const qm = await readyPool(2);
        qm.findSeeds(CRITERIA, cbs());
        expect(() => qm.findSeeds(CRITERIA, cbs())).toThrow(/already running/);
    });

    it('SEED_FOUND: onHit once per distinct seed with a running index; a duplicate is ignored', async () => {
        const qm = await readyPool(3);
        const c = cbs();
        qm.findSeeds({ ...CRITERIA, count: 10 }, c);
        const [a, b] = shardWorkers();
        a.emit('SEED_FOUND', hit(5n, { examined: 3, tested: 3 }));
        b.emit('SEED_FOUND', hit(7n));
        a.emit('SEED_FOUND', hit(5n, { examined: 4, tested: 4 }));      // same seed again
        expect(c.onHit).toHaveBeenCalledTimes(2);
        expect(c.onHit.mock.calls[0][0]).toEqual({ ...hit(5n, { examined: 3, tested: 3 }), index: 0 });
        expect(c.onHit.mock.calls[1][0]).toEqual({ ...hit(7n), index: 1 });
        expect(c.onProgress).toHaveBeenCalledTimes(3);
        expect(c.onProgress).toHaveBeenLastCalledWith({ examined: 5n, tested: 5, hits: 2, elapsedMs: expect.any(Number) });
        expect(c.onDone).not.toHaveBeenCalled();
    });

    it('reaching count ends with target: only the shard workers are terminated and respawned; tiles and reset listeners are untouched', async () => {
        const qm = await readyPool(3);
        const onReset = vi.fn();
        qm.addResetListener(onReset);
        const c = cbs();
        qm.findSeeds(CRITERIA, c);                                        // count 3
        const tile = area();
        const tileCb = vi.fn();
        qm.draw(...areaArgs(tile), tileCb);                               // occupies the reserved worker
        const [a, b] = shardWorkers();
        const tileWorker = FakeWorker.live().find((w) => w.lastPosted('GET_AREA'));
        a.emit('SEED_FOUND', hit(1n, { examined: 10, tested: 20 }));
        a.emit('SEED_FOUND', hit(2n, { examined: 11, tested: 22 }));
        expect(c.onDone).not.toHaveBeenCalled();
        b.emit('SEED_FOUND', hit(3n, { examined: 4, tested: 8 }));
        expect(c.onDone).toHaveBeenCalledTimes(1);
        const [hits, examined, reason, resumeSeed, extra] = c.onDone.mock.calls[0];
        expect(hits.map((h) => h.seed)).toEqual([1n, 2n, 3n]);
        expect(examined).toBe(15n);
        expect(reason).toBe('target');
        expect(resumeSeed).toBe(501_000n);                                // start of the first shard never dealt
        expect(extra).toEqual({ tested: 30, elapsedMs: expect.any(Number), error: null });
        expect(a.terminated).toBe(true);
        expect(b.terminated).toBe(true);
        expect(tileWorker.terminated).toBe(false);
        expect(qm.searching).toBe(false);
        expect(qm.workers).toEqual([tileWorker]);                         // replacements join once loaded
        expect(FakeWorker.live()).toHaveLength(3);
        expect(onReset).not.toHaveBeenCalled();
        expect(qm.inFlight.has(qm.getAreaKey(...areaArgs(tile)))).toBe(true);
        // Late messages from the replaced workers are ignored …
        a.emit('SEED_FOUND', hit(9n));
        done(a);
        expect(c.onHit).toHaveBeenCalledTimes(3);
        expect(c.onDone).toHaveBeenCalledTimes(1);
        // … the tile still lands, and the replacements boot like any other worker.
        tileWorker.emit('DONE_GET_AREA', blank(tile));
        expect(tileCb).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        for (const w of FakeWorker.live()) expect(w.posted[0]).toEqual({ kind: 'INIT', module: fakeModule });
        for (const w of FakeWorker.live()) if (w !== tileWorker) w.emit('DONE_LOADING');
        expect(qm.workers).toHaveLength(3);
    });

    it('SEED_UPDATE and DONE_FIND_SEEDS both drive a monotonic onProgress with a BigInt examined', async () => {
        const qm = await readyPool(3);
        const c = cbs();
        qm.findSeeds({ ...CRITERIA, maxSeedsToScan: 600_000n }, c);
        const [a, b] = shardWorkers();
        a.emit('SEED_UPDATE', { examined: 100, tested: 1000 });
        b.emit('SEED_UPDATE', { examined: 50, tested: 700 });
        a.emit('SEED_UPDATE', { examined: 120, tested: 1300 });
        done(a, { examined: 250_000, tested: 3000 });                     // folded into the completed totals
        expect(a.lastPosted('FIND_SEEDS').data).toMatchObject({ startingSeed: '501000', maxSeedsToScan: 100_000 });
        const seen = c.onProgress.mock.calls.map(([p]) => p.examined);
        expect(seen).toEqual([100n, 150n, 170n, 250_050n]);
        for (const [p] of c.onProgress.mock.calls) expect(typeof p.examined).toBe('bigint');
        expect(c.onProgress).toHaveBeenLastCalledWith({ examined: 250_050n, tested: 3700, hits: 0, elapsedMs: expect.any(Number) });
    });

    it('refills shards on the same worker until the space is exhausted, then reports exhausted with resumeSeed = end', async () => {
        const qm = await readyPool(2);                                    // N-1 = 1 shard at a time
        const c = cbs();
        qm.findSeeds({ ...CRITERIA, count: 1e9, maxSeedsToScan: 600_000n }, c);
        const [w] = shardWorkers();
        expect(shardWorkers()).toHaveLength(1);
        done(w, { examined: 250_000, tested: 250_000 });
        done(w, { examined: 250_000, tested: 250_000 });
        expect(c.onDone).not.toHaveBeenCalled();
        done(w, { examined: 100_000, tested: 100_000 });
        expect(shardPosts().map((p) => [p.startingSeed, p.maxSeedsToScan])).toEqual([['1000', 250_000], ['251000', 250_000], ['501000', 100_000]]);
        expect(c.onDone).toHaveBeenCalledWith([], 600_000n, 'exhausted', 601_000n, { tested: 600_000, elapsedMs: expect.any(Number), error: null });
        expect(w.terminated).toBe(false);                                 // nothing was running: no worker replaced
        expect(FakeWorker.instances).toHaveLength(2);
        expect(qm.searching).toBe(false);
    });

    it('with one worker the search still runs (maxWorkers 1) and tiles are drained between shards', async () => {
        const qm = await readyPool(1);
        const c = cbs();
        qm.findSeeds({ ...CRITERIA, count: 1e9, maxSeedsToScan: 500_000n }, c);
        const [w] = FakeWorker.live();
        expect(w.lastPosted('FIND_SEEDS')).toBeDefined();
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        expect(qm.pending).toHaveLength(1);
        done(w, { examined: 250_000, tested: 250_000 });
        // The tile goes first …
        expect(w.posted.at(-1)).toEqual({ kind: 'GET_AREA', data: a });
        expect(w.postedKinds().filter((k) => k === 'FIND_SEEDS')).toHaveLength(1);
        // … and the next shard follows as soon as the tile is done: nothing stalls.
        w.emit('DONE_GET_AREA', blank(a));
        expect(w.posted.at(-1)).toMatchObject({ kind: 'FIND_SEEDS', data: { startingSeed: '251000', maxSeedsToScan: 250_000 } });
        done(w, { examined: 250_000, tested: 250_000 });
        expect(c.onDone).toHaveBeenCalledWith([], 500_000n, 'exhausted', 501_000n, expect.anything());
    });

    it('an engine error in DONE_FIND_SEEDS ends the search with reason error and the code', async () => {
        const qm = await readyPool(2);
        const c = cbs();
        qm.findSeeds(CRITERIA, c);
        const [w] = shardWorkers();
        done(w, { error: { code: -3, message: 'nope' } });
        expect(c.onDone).toHaveBeenCalledWith([], 0n, 'error', 251_000n, { tested: 0, elapsedMs: expect.any(Number), error: { code: -3, message: 'nope' } });
        expect(w.terminated).toBe(false);
        expect(w.busy).toBe(false);
        expect(shardPosts()).toHaveLength(1);
        expect(qm.searching).toBe(false);
    });

    it('stopSearch is synchronous: shard workers terminated and respawned, the tile worker and its queue survive, no reset', async () => {
        const qm = await readyPool(3);
        const onReset = vi.fn();
        qm.addResetListener(onReset);
        const c = cbs();
        qm.findSeeds(CRITERIA, c);
        const [a, b] = shardWorkers();
        const tileWorker = FakeWorker.live().find((w) => !w.lastPosted('FIND_SEEDS'));
        const first = area({ startX: 0 }), second = area({ startX: 75 });
        qm.draw(...areaArgs(first), vi.fn());
        qm.draw(...areaArgs(second), vi.fn());                            // queued: the reserved worker is busy
        a.emit('SEED_UPDATE', { examined: 40, tested: 40 });
        qm.stopSearch();
        expect(c.onDone).toHaveBeenCalledTimes(1);
        expect(c.onDone).toHaveBeenCalledWith([], 40n, 'stopped', 501_000n, { tested: 40, elapsedMs: expect.any(Number), error: null });
        expect(a.terminated).toBe(true);
        expect(b.terminated).toBe(true);
        expect(tileWorker.terminated).toBe(false);
        expect(tileWorker.lastPosted('GET_AREA').data).toEqual(first);
        expect(qm.pending.map((j) => j.startX)).toEqual([75]);
        expect(qm.inFlight.size).toBe(2);
        expect(onReset).not.toHaveBeenCalled();
        expect(FakeWorker.live()).toHaveLength(3);
        expect(FakeWorker.instances).toHaveLength(5);
        expect(qm.searching).toBe(false);
        qm.stopSearch();                                                  // idle: no-op
        expect(c.onDone).toHaveBeenCalledTimes(1);
    });

    it('the stop() handle only stops its own search', async () => {
        const qm = await readyPool(2);
        const c1 = cbs(), c2 = cbs();
        const first = qm.findSeeds(CRITERIA, c1);
        first.stop();
        expect(c1.onDone).toHaveBeenCalledWith([], 0n, 'stopped', 251_000n, expect.anything());
        qm.findSeeds(CRITERIA, c2);
        first.stop();                                                     // stale handle
        expect(c2.onDone).not.toHaveBeenCalled();
        expect(qm.searching).toBe(true);
    });

    it('killAll during a search reports stopped and spawns no replacements', async () => {
        const qm = await readyPool(2);
        const c = cbs();
        qm.findSeeds(CRITERIA, c);
        qm.killAll();
        expect(c.onDone).toHaveBeenCalledWith([], 0n, 'stopped', 251_000n, expect.anything());
        expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
        expect(FakeWorker.instances).toHaveLength(2);
        expect(qm.workers).toEqual([]);
        expect(qm.searching).toBe(false);
    });

    it('a worker that finishes loading during a search is given a shard, within the reservation', async () => {
        const qm = new QueueManager(PATH, 3);
        await vi.advanceTimersByTimeAsync(1);                             // INIT posted, nobody loaded yet
        const c = cbs();
        qm.findSeeds(CRITERIA, c);
        expect(shardPosts()).toHaveLength(0);
        FakeWorker.instances[0].emit('DONE_LOADING');
        // Requests go before shards: the first worker takes the queued palette request …
        expect(FakeWorker.instances[0].postedKinds()).toEqual(['INIT', 'GET_COLORS']);
        expect(shardPosts()).toHaveLength(0);
        FakeWorker.instances[0].emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
        expect(shardPosts()).toHaveLength(1);                             // … then its first shard
        FakeWorker.instances[1].emit('DONE_LOADING');
        expect(shardPosts()).toHaveLength(2);
        FakeWorker.instances[2].emit('DONE_LOADING');
        expect(shardPosts()).toHaveLength(2);                             // the third stays free for tiles
        expect(qm.workers.filter((w) => !w.busy)).toHaveLength(1);
    });

    it('clips the candidate space: structure starts are 48-bit families ending at 2^48, biome scans cap at DEFAULT_MAX_SCAN', async () => {
        const qm = await readyPool(2);
        const c = cbs();
        const high = (1n << 48n) - 100_000n;
        qm.findSeeds({ ...CRITERIA, startingSeed: (7n << 48n) | high, count: 1e9 }, c);
        expect(shardPosts().at(-1)).toMatchObject({ startingSeed: String(high), maxSeedsToScan: 100_000 });
        done(shardWorkers()[0], { examined: 100_000, tested: 100_000 });
        expect(c.onDone).toHaveBeenCalledWith([], 100_000n, 'exhausted', 1n << 48n, expect.anything());
        // Biome mode: signed 64-bit seeds counted upwards from the start, at most DEFAULT_MAX_SCAN of them.
        qm.findSeeds({ mcVersion: 21, dimension: 0, yHeight: 256, biomes: [1], structures: [], rangeBlocks: 100, startingSeed: '-5', count: 1e9, maxSeedsToScan: 10n ** 12n }, cbs());
        expect(shardPosts().at(-1)).toMatchObject({ startingSeed: '-5', maxSeedsToScan: 10_000 });
        expect(qm.search.end).toBe(DEFAULT_MAX_SCAN - 5n);
    });

    it('getVersionSupport posts GET_VERSION_SUPPORT, resolves with the reply and is queued until a worker is free', async () => {
        const qm = await readyPool(1);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        const promise = qm.getVersionSupport(15, [1, 185], [5, 25]);
        expect(FakeWorker.live()[0].lastPosted('GET_VERSION_SUPPORT')).toBeUndefined();
        expect(qm.highQueue).toHaveLength(1);
        FakeWorker.live()[0].emit('DONE_GET_AREA', blank(a));
        const posted = FakeWorker.live()[0].lastPosted('GET_VERSION_SUPPORT');
        expect(posted).toEqual({ kind: 'GET_VERSION_SUPPORT', data: { mcVersion: 15, biomeIds: [1, 185], structTypes: [5, 25], requestId: expect.any(Number) } });
        const reply = { mcVersion: 15, newest: 35, biomes: [1], biomeDimensions: { 1: 0, 185: 0 }, structures: { 5: 0, 25: -100 }, regionBlocks: { 5: 512, 25: 0 }, minDistance: { 5: 0, 25: 0 } };
        FakeWorker.live()[0].emit('DONE_GET_VERSION_SUPPORT', reply);
        await expect(promise).resolves.toEqual(reply);
        expect(qm.workers[0].busy).toBe(false);
    });
});

describe('shardLenFor (about one second of work per shard)', () => {
    const biome = (over) => ({ mcVersion: 35, dimension: 0, biomes: [1], structures: [], rangeBlocks: 300, ...over });

    it('structure modes always use 250 000 families', () => {
        expect(shardLenFor(biome({ structures: [5] }))).toBe(250_000);
        expect(shardLenFor(biome({ structures: [9], biomes: [14], rangeBlocks: 2000, mcVersion: 15 }))).toBe(250_000);
    });

    it('layer-stack Overworld (up to 1.17) uses 10 000 seeds', () => {
        expect(shardLenFor(biome({ mcVersion: 21 }))).toBe(10_000);
        expect(shardLenFor(biome({ mcVersion: 1, rangeBlocks: 1000 }))).toBe(10_000);
    });

    it('1.18+ Overworld scales with the box (cells² × 2.7 µs): ±100 ≈ 150, ±300 ≈ 16, ±500 floored to 8', () => {
        expect(shardLenFor(biome({ rangeBlocks: 100 }))).toBe(148);
        expect(shardLenFor(biome({ rangeBlocks: 300 }))).toBe(16);
        expect(shardLenFor(biome({ rangeBlocks: 500 }))).toBe(8);
        expect(shardLenFor(biome({ mcVersion: 22, rangeBlocks: 1000 }))).toBe(8);
    });

    it('Nether and End follow their own per-cell cost, on every version that has that generator', () => {
        expect(shardLenFor(biome({ dimension: -1, biomes: [8] }))).toBe(342);
        expect(shardLenFor(biome({ dimension: -1, biomes: [8], mcVersion: 20 }))).toBe(342);     // 1.16.5: same Nether noise
        expect(shardLenFor(biome({ dimension: 1, biomes: [9] }))).toBe(26);                       // a full End check costs ~38 ms at ±300
        expect(shardLenFor(biome({ dimension: 1, biomes: [9], mcVersion: 12 }))).toBe(26);       // 1.9: same End generator
        expect(shardLenFor(biome({ dimension: 1, biomes: [9], rangeBlocks: 1000 }))).toBe(8);
    });
});

describe('one-shot helpers (delegate to request)', () => {
    it('findSpawn posts GET_SPAWN (high priority) and calls back with (x, z)', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.findSpawn(35, '123', cb);
        expect(FakeWorker.live()[0].lastPosted('GET_SPAWN')).toEqual({ kind: 'GET_SPAWN', data: { mcVersion: 35, seed: '123', requestId: expect.any(Number) } });
        expect(qm.workers[0].request).toMatchObject({ kind: 'GET_SPAWN', priority: 'high' });
        FakeWorker.live()[0].emit('DONE_GET_SPAWN', { x: -32, z: 80 });
        expect(qm.workers[0].busy).toBe(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(cb).toHaveBeenCalledWith(-32, 80);
    });

    it('findSpawn is queued until a worker is free (no polling)', async () => {
        const qm = await readyPool(1);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        const cb = vi.fn();
        qm.findSpawn(35, '123', cb);
        expect(FakeWorker.live()[0].lastPosted('GET_SPAWN')).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
        FakeWorker.live()[0].emit('DONE_GET_AREA', { ...a, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });
        expect(FakeWorker.live()[0].lastPosted('GET_SPAWN')).toBeDefined();
        FakeWorker.live()[0].emit('DONE_GET_SPAWN', { x: 1, z: 2 });
        await vi.advanceTimersByTimeAsync(0);
        expect(cb).toHaveBeenCalledWith(1, 2);
    });

    it('findStrongholds posts GET_STRONGHOLDS and calls back with the reply data', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.findStrongholds(35, '123', 150, cb);
        expect(FakeWorker.live()[0].lastPosted('GET_STRONGHOLDS')).toEqual({ kind: 'GET_STRONGHOLDS', data: { mcVersion: 35, seed: '123', howMany: 150, requestId: expect.any(Number) } });
        FakeWorker.live()[0].emit('DONE_GET_STRONGHOLDS', { coords: [[1, 2]] });
        await vi.advanceTimersByTimeAsync(0);
        expect(cb).toHaveBeenCalledWith({ coords: [[1, 2]] });
    });

    it('getStructuresInRegions posts GET_STRUCTURES_IN_REGIONS and calls back with the reply data', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.getStructuresInRegions(35, 5, '123', 50, 0, cb);
        expect(FakeWorker.live()[0].lastPosted('GET_STRUCTURES_IN_REGIONS')).toEqual({ kind: 'GET_STRUCTURES_IN_REGIONS', data: { mcVersion: 35, structType: 5, seed: '123', regionsRange: 50, dimension: 0, requestId: expect.any(Number) } });
        FakeWorker.live()[0].emit('DONE_GET_STRUCTURES_IN_REGIONS', { coords: [[3, 4]] });
        await vi.advanceTimersByTimeAsync(0);
        expect(cb).toHaveBeenCalledWith({ coords: [[3, 4]] });
    });

    it('drains queued tiles after a one-shot query completes', async () => {
        const qm = await readyPool(1);
        qm.findSpawn(35, '123', vi.fn());
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        expect(qm.pending).toHaveLength(1);
        FakeWorker.live()[0].emit('DONE_GET_SPAWN', { x: 0, z: 0 });
        expect(qm.pending).toHaveLength(0);
        expect(FakeWorker.live()[0].lastPosted('GET_AREA').data).toEqual(a);
    });

    it('a helper whose request is killed never calls back and leaves no unhandled rejection', async () => {
        const qm = await readyPool(1);
        const spawn = vi.fn(), strongholds = vi.fn(), regions = vi.fn();
        qm.findSpawn(35, '1', spawn);                                     // in flight
        qm.findStrongholds(35, '1', 3, strongholds);                      // queued
        qm.getStructuresInRegions(35, 5, '1', 4, 0, regions);             // queued
        qm.killAll();
        await vi.advanceTimersByTimeAsync(0);
        expect(spawn).not.toHaveBeenCalled();
        expect(strongholds).not.toHaveBeenCalled();
        expect(regions).not.toHaveBeenCalled();
    });
});

describe('requests (request / cancelToken)', () => {
    const blank = (a) => ({ ...a, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });
    // Reply to the request of `kind` the worker is running, echoing its requestId.
    const reply = (w, kind, result = {}) => w.emit('DONE_' + kind, { requestId: w.lastPosted(kind).data.requestId, error: null, ...result });
    const postedOf = (kind) => FakeWorker.live().filter((w) => w.lastPosted(kind));
    // Settle state of a promise without awaiting it forever.
    const settleState = async (promise) => {
        let state = 'pending';
        promise.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
        await vi.advanceTimersByTimeAsync(0);
        return state;
    };

    it('drain order on a freed worker: pending tile, then high request, then low request', async () => {
        const qm = await readyPool(1);
        const w = FakeWorker.live()[0];
        const first = area({ startX: 0 }), second = area({ startX: 75 });
        qm.draw(...areaArgs(first), vi.fn());                             // occupies the only worker
        const low = qm.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' });
        const high = qm.request('NEAREST_STRUCTURES', { mcVersion: 35, seed: '1' }, { priority: 'high' });
        qm.draw(...areaArgs(second), vi.fn());                            // asked for last, served first
        const before = w.posted.length;
        w.emit('DONE_GET_AREA', blank(first));
        w.emit('DONE_GET_AREA', blank(second));
        reply(w, 'NEAREST_STRUCTURES', { results: [] });
        reply(w, 'SEED_SUMMARY', { spawnX: 0 });
        expect(w.postedKinds().slice(before)).toEqual(['GET_AREA', 'NEAREST_STRUCTURES', 'SEED_SUMMARY']);
        await expect(high).resolves.toEqual({ results: [], error: null });
        await expect(low).resolves.toEqual({ spawnX: 0, error: null });
    });

    it('caps low requests in flight at max(1, min(2, N - 1)); high requests are uncapped', async () => {
        const qm = await readyPool(4);
        for (let i = 0; i < 5; i++) qm.request('SEED_SUMMARY', { seed: String(i) });
        expect(postedOf('SEED_SUMMARY')).toHaveLength(2);
        expect(qm.lowQueue).toHaveLength(3);
        expect(qm.workers.filter((w) => !w.busy)).toHaveLength(2);        // never every worker
        // A finished low request lets exactly one more in.
        reply(postedOf('SEED_SUMMARY')[0], 'SEED_SUMMARY');
        expect(qm.lowQueue).toHaveLength(2);
        expect(qm.workers.filter((w) => w.request?.priority === 'low')).toHaveLength(2);

        FakeWorker.reset();
        const big = await readyPool(4);
        for (let i = 0; i < 5; i++) big.request('BIOME_AT', { seed: String(i) }, { priority: 'high' });
        expect(postedOf('BIOME_AT')).toHaveLength(4);                     // every worker, no cap
        reply(postedOf('BIOME_AT')[0], 'BIOME_AT', { biome: 1 });
        expect(FakeWorker.live().flatMap((w) => w.postedKinds()).filter((k) => k === 'BIOME_AT')).toHaveLength(5);
        expect(big.highQueue).toHaveLength(0);
    });

    it('the low cap is 1 on pools of one and two workers and 2 from three', async () => {
        for (const [n, cap] of [[1, 1], [2, 1], [3, 2], [8, 2]]) {
            FakeWorker.reset();
            const qm = await readyPool(n);
            for (let i = 0; i < 4; i++) qm.request('SLIME_CHUNKS', { seed: '1' });
            expect(postedOf('SLIME_CHUNKS')).toHaveLength(cap);
        }
    });

    it('a wide low request may use every worker but one; a plain one behind it keeps the cap of 2', async () => {
        const count = (kind) => FakeWorker.live().flatMap((w) => w.postedKinds()).filter((k) => k === kind).length;
        const busyWith = (kind) => FakeWorker.live().filter((w, i) => qm.workers[i].busy && w.postedKinds().at(-1) === kind);
        const qm = await readyPool(6);
        for (let i = 0; i < 7; i++) qm.requestArea({ seed: String(i) }, { wide: true });
        expect(count('GET_AREA')).toBe(5);                                 // N - 1
        expect(qm.workers.filter((w) => !w.busy)).toHaveLength(1);        // one left for tiles
        qm.request('SEED_SUMMARY', { seed: 'x' });
        // Two strips finish: the last two wide ones go; the plain one waits for the cap of 2.
        for (const w of busyWith('GET_AREA').slice(0, 2)) reply(w, 'GET_AREA');
        expect(count('GET_AREA')).toBe(7);
        expect(count('SEED_SUMMARY')).toBe(0);
        for (const w of busyWith('GET_AREA')) reply(w, 'GET_AREA');
        expect(count('SEED_SUMMARY')).toBe(1);
    });

    it('a wide request on a pool of one still runs one at a time', async () => {
        const qm = await readyPool(1);
        for (let i = 0; i < 3; i++) qm.requestArea({ seed: String(i) }, { wide: true });
        expect(FakeWorker.live()[0].postedKinds().filter((k) => k === 'GET_AREA')).toHaveLength(1);
    });

    it('a low request waits for a busy pool, and during a search the reserved worker serves it', async () => {
        const qm = await readyPool(1);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        qm.request('SEED_SUMMARY', { seed: '1' });
        expect(postedOf('SEED_SUMMARY')).toHaveLength(0);
        FakeWorker.live()[0].emit('DONE_GET_AREA', blank(a));
        expect(postedOf('SEED_SUMMARY')).toHaveLength(1);

        FakeWorker.reset();
        const pool = await readyPool(3);
        pool.findSeeds({ mcVersion: 35, dimension: 0, yHeight: 256, biomes: [], structures: [5], rangeBlocks: 300, startingSeed: 0n, count: 3 }, {});
        expect(postedOf('FIND_SEEDS')).toHaveLength(2);
        pool.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' });
        const [served] = postedOf('SEED_SUMMARY');
        expect(served).toBeDefined();
        expect(served.lastPosted('FIND_SEEDS')).toBeUndefined();
    });

    it('resolves with the reply data minus requestId, error included - an engine error is an answer, not a rejection', async () => {
        const qm = await readyPool(1);
        const w = FakeWorker.live()[0];
        const ok = qm.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' });
        const id = w.lastPosted('SEED_SUMMARY').data.requestId;
        expect(w.lastPosted('SEED_SUMMARY').data).toEqual({ mcVersion: 35, seed: '1', requestId: id });
        w.emit('DONE_SEED_SUMMARY', { requestId: id, spawnX: 1, error: null });
        await expect(ok).resolves.toEqual({ spawnX: 1, error: null });
        const failing = qm.request('BIOME_CENTERS', { mcVersion: 35, seed: '1', radiusBlocks: 2048 });
        const error = { code: -8, message: 'Not enough memory' };
        w.emit('DONE_BIOME_CENTERS', { requestId: w.lastPosted('BIOME_CENTERS').data.requestId, error });
        await expect(failing).resolves.toEqual({ error });
        expect(w.busy).toBeFalsy();
    });

    it("ignores a reply whose requestId is not the worker's request", async () => {
        const qm = await readyPool(1);
        const w = FakeWorker.live()[0];
        const p = qm.request('SEED_SUMMARY', { seed: '1' });
        const id = w.lastPosted('SEED_SUMMARY').data.requestId;
        w.emit('DONE_SEED_SUMMARY', { requestId: id + 99, spawnX: 7, error: null });
        expect(await settleState(p)).toBe('pending');
        expect(qm.workers[0].busy).toBe(true);
        w.emit('DONE_SEED_SUMMARY', { requestId: id, spawnX: 1, error: null });
        await expect(p).resolves.toEqual({ spawnX: 1, error: null });
    });

    it('cancelToken rejects queued requests without posting them, and in-flight ones at once; the late reply only frees the worker', async () => {
        const qm = await readyPool(1);
        const w = FakeWorker.live()[0];
        const token = Symbol('seed 1');
        const inFlight = qm.request('SEED_SUMMARY', { seed: '1' }, { token });
        const queued = qm.request('NEAREST_STRUCTURES', { seed: '1' }, { token, priority: 'high' });
        const other = qm.request('BIOME_AT', { seed: '2' }, { token: 'seed 2' });
        qm.cancelToken(token);
        await expect(inFlight).rejects.toEqual({ cancelled: true, reason: 'cancelled' });
        await expect(queued).rejects.toEqual({ cancelled: true, reason: 'cancelled' });
        expect(qm.highQueue).toHaveLength(0);
        expect(w.busy).toBe(true);                                        // still inside its C call
        reply(w, 'SEED_SUMMARY', { spawnX: 1 });                          // late reply: dropped
        expect(w.lastPosted('NEAREST_STRUCTURES')).toBeUndefined();       // never posted
        expect(w.lastPosted('BIOME_AT')).toBeDefined();                   // the worker moved on
        expect(await settleState(other)).toBe('pending');
        reply(w, 'BIOME_AT', { biome: 4 });
        await expect(other).resolves.toEqual({ biome: 4, error: null });
    });

    it('killAll rejects queued and in-flight requests with reason killed', async () => {
        const qm = await readyPool(2);
        const inFlight = qm.request('SEED_SUMMARY', { seed: '1' });
        const queuedLow = qm.request('SEED_SUMMARY', { seed: '2' });      // cap 1 on two workers
        const high = qm.request('BIOME_AT', { seed: '1' }, { priority: 'high' });
        const queuedHigh = qm.request('BIOME_AT', { seed: '2' }, { priority: 'high' });
        qm.killAll();
        for (const p of [inFlight, queuedLow, high, queuedHigh]) await expect(p).rejects.toEqual({ cancelled: true, reason: 'killed' });
        expect(qm.highQueue).toEqual([]);
        expect(qm.lowQueue).toEqual([]);
    });

    describe('requestArea (the dashboard\'s biome areas)', () => {
        const big = area({ startX: -258, startY: -230, widthX: 500, widthY: 500, yHeight: 256 });
        const areaReply = (a) => ({ ...a, rgba: new Uint8ClampedArray([1, 2, 3, 255]), ids: new Int32Array([7]) });

        it('posts GET_AREA with a requestId at low priority, behind pending tiles and high requests', async () => {
            const qm = await readyPool(1);
            const w = FakeWorker.live()[0];
            const first = area({ startX: 0 }), second = area({ startX: 75 });
            qm.draw(...areaArgs(first), vi.fn());                         // occupies the only worker
            qm.requestArea(big);
            qm.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' }, { priority: 'high' });
            qm.draw(...areaArgs(second), vi.fn());
            expect(qm.lowQueue.map((e) => [e.kind, e.priority])).toEqual([['GET_AREA', 'low']]);
            const before = w.posted.length;
            w.emit('DONE_GET_AREA', blank(first));
            w.emit('DONE_GET_AREA', blank(second));
            reply(w, 'SEED_SUMMARY', { spawnX: 0 });
            expect(w.postedKinds().slice(before)).toEqual(['GET_AREA', 'SEED_SUMMARY', 'GET_AREA']);
            expect(w.lastPosted('GET_AREA')).toEqual({ kind: 'GET_AREA', data: { ...big, requestId: expect.any(Number) } });
            expect(w.request).toMatchObject({ kind: 'GET_AREA', priority: 'low' });
            expect(w.job).toBeNull();
        });

        it('resolves with { rgba, ids } and the echo from a reply without requestId, leaving the tile counters and inFlight alone', async () => {
            const qm = await readyPool(1);
            const w = FakeWorker.live()[0];
            const p = qm.requestArea(big);
            expect(qm.stats).toEqual({ areaRequests: 0, areaDone: 0 });
            expect(qm.inFlight.size).toBe(0);
            // The worker's GET_AREA reply echoes the params only, never our requestId.
            const data = areaReply(big);
            w.emit('DONE_GET_AREA', data);
            const result = await p;
            expect(result).toEqual(data);
            expect(result.ids).toBe(data.ids);
            expect(result.rgba).toBe(data.rgba);
            expect(qm.stats).toEqual({ areaRequests: 0, areaDone: 0 });
            expect(qm.inFlight.size).toBe(0);
            expect(w.busy).toBe(false);
            expect(w.request).toBeNull();
        });

        it('rejects on cancelToken; its late reply only frees the worker', async () => {
            const qm = await readyPool(1);
            const w = FakeWorker.live()[0];
            const token = Symbol('biomes');
            const p = qm.requestArea(big, { token });
            const queued = qm.requestArea({ ...big, seed: '9' }, { token });
            qm.cancelToken(token);
            await expect(p).rejects.toEqual({ cancelled: true, reason: 'cancelled' });
            await expect(queued).rejects.toEqual({ cancelled: true, reason: 'cancelled' });
            expect(qm.lowQueue).toHaveLength(0);
            const tile = vi.fn();
            qm.draw(...areaArgs(area()), tile);                            // waits: the worker is still in its C call
            w.emit('DONE_GET_AREA', areaReply(big));                      // late reply: dropped
            expect(tile).not.toHaveBeenCalled();
            expect(qm.stats.areaDone).toBe(0);
            expect(w.lastPosted('GET_AREA').data).toEqual(area());         // the worker moved on to the tile
        });

        it('a tile dispatched at the same time on another worker still takes the tile path', async () => {
            const qm = await readyPool(2);
            const p = qm.requestArea(big);
            const cb = vi.fn();
            const a = area();
            qm.draw(...areaArgs(a), cb);
            const [areaWorker] = postedOf('GET_AREA').filter((w) => w.request);
            const [tileWorker] = postedOf('GET_AREA').filter((w) => w.job);
            expect(areaWorker).toBeDefined();
            expect(tileWorker).toBeDefined();
            expect(tileWorker).not.toBe(areaWorker);
            expect(qm.inFlight.size).toBe(1);
            const rgba = new Uint8ClampedArray(4), ids = new Int32Array(1);
            tileWorker.emit('DONE_GET_AREA', { ...a, rgba, ids });
            expect(cb).toHaveBeenCalledWith({ rgba, ids });
            expect(qm.stats.areaDone).toBe(1);
            expect(qm.inFlight.size).toBe(0);
            expect(await settleState(p)).toBe('pending');
            areaWorker.emit('DONE_GET_AREA', areaReply(big));
            await expect(p).resolves.toMatchObject({ widthX: 500, ids: new Int32Array([7]) });
            expect(cb).toHaveBeenCalledTimes(1);
            expect(qm.stats.areaDone).toBe(1);
        });
    });

    it('restartAll asks for the palette again when the pool died before answering it', async () => {
        const qm = new QueueManager(PATH, 2);
        await vi.advanceTimersByTimeAsync(1);                             // nobody loaded: GET_COLORS still queued
        expect(qm.highQueue.map((e) => e.kind)).toEqual(['GET_COLORS']);
        qm.restartAll();
        expect(qm.highQueue.map((e) => e.kind)).toEqual(['GET_COLORS']);
        await vi.advanceTimersByTimeAsync(1);
        for (const w of FakeWorker.live()) w.emit('DONE_LOADING');
        const [asked] = postedOf('GET_COLORS');
        asked.emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
        await vi.advanceTimersByTimeAsync(0);
        expect(qm.COLORS).toBe(FAKE_COLORS);
        // With the palette known, a restart does not ask again.
        qm.restartAll();
        expect(qm.highQueue).toHaveLength(0);
    });
});

describe('teardown', () => {
    it('killAll terminates every worker, clears queues and notifies reset listeners', async () => {
        const qm = await readyPool(2);
        const onReset = vi.fn();
        qm.addResetListener(onReset);
        qm.draw(...areaArgs(area()), vi.fn());
        qm.killAll();
        expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
        expect(qm.workers).toEqual([]);
        expect(qm.pending).toEqual([]);
        expect(qm.inFlight.size).toBe(0);
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('restartAll spawns a fresh pool of the same size', async () => {
        const qm = await readyPool(2);
        qm.restartAll();
        expect(FakeWorker.live()).toHaveLength(2);
        expect(FakeWorker.instances).toHaveLength(4);
        await vi.advanceTimersByTimeAsync(1);
        for (const w of FakeWorker.live()) { expect(w.posted[0].kind).toBe('INIT'); w.emit('DONE_LOADING'); }
        expect(qm.workers).toHaveLength(2);
    });

    it('removeResetListener stops notifications', async () => {
        const qm = await readyPool(1);
        const onReset = vi.fn();
        qm.addResetListener(onReset);
        qm.removeResetListener(onReset);
        qm.killAll();
        expect(onReset).not.toHaveBeenCalled();
    });
});

describe('worker crashes', () => {
    const blank = (a) => ({ ...a, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });
    const CRITERIA = { mcVersion: 35, dimension: 0, yHeight: 256, biomes: [], structures: [5], rangeBlocks: 300, startingSeed: 1000n, count: 3, maxSeedsToScan: 250_000n };
    const cbs = () => ({ onHit: vi.fn(), onProgress: vi.fn(), onDone: vi.fn() });
    // Let the replacement receive INIT and report DONE_LOADING; returns it.
    const bootReplacement = async () => {
        await vi.advanceTimersByTimeAsync(1);
        const fresh = FakeWorker.instances.at(-1);
        expect(fresh.posted[0]).toEqual({ kind: 'INIT', module: fakeModule });
        fresh.emit('DONE_LOADING');
        return fresh;
    };
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

    it('replaces a crashed worker: terminated, removed from the pool, a new one INIT-ed with the shared module', async () => {
        const qm = await readyPool(2);
        const [victim] = FakeWorker.live();
        const event = victim.crash('importScripts failed');
        expect(event.preventDefault).toHaveBeenCalled();
        expect(victim.terminated).toBe(true);
        expect(qm.workers).not.toContain(victim);
        expect(FakeWorker.instances).toHaveLength(3);
        const fresh = await bootReplacement();
        expect(qm.workers).toHaveLength(2);
        expect(qm.workers).toContain(fresh);
    });

    it('treats a messageerror like a crash', async () => {
        const qm = await readyPool(1);
        const [victim] = FakeWorker.live();
        victim.crash(undefined, 'messageerror');
        expect(victim.terminated).toBe(true);
        await bootReplacement();
        expect(qm.workers).toHaveLength(1);
    });

    it('a tile whose worker crashed is dealt again to another worker and still reaches its callback', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        const a = area();
        qm.draw(...areaArgs(a), cb);
        FakeWorker.live()[0].crash();
        expect(qm.inFlight.has(qm.getAreaKey(...areaArgs(a)))).toBe(true);
        const fresh = await bootReplacement();
        expect(fresh.lastPosted('GET_AREA').data).toEqual(a);
        const rgba = new Uint8ClampedArray(4), ids = new Int32Array(1);
        fresh.emit('DONE_GET_AREA', { ...a, rgba, ids });
        expect(cb).toHaveBeenCalledWith({ rgba, ids });
        expect(qm.inFlight.size).toBe(0);
    });

    it('a tile that crashes its worker twice is dropped from inFlight, so it can be requested again', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        const a = area();
        qm.draw(...areaArgs(a), cb);
        FakeWorker.live()[0].crash();
        (await bootReplacement()).crash();
        expect(qm.inFlight.size).toBe(0);
        expect(qm.pending).toHaveLength(0);
        const third = await bootReplacement();
        expect(third.lastPosted('GET_AREA')).toBeUndefined();
        qm.draw(...areaArgs(a), cb);
        expect(third.lastPosted('GET_AREA').data).toEqual(a);
        expect(cb).not.toHaveBeenCalled();
    });

    it('a DONE_GET_AREA carrying an engine error frees the worker and the tile without calling back', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        const a = area();
        qm.draw(...areaArgs(a), cb);
        const w = FakeWorker.live()[0];
        w.emit('DONE_GET_AREA', { ...a, error: { code: -7, message: 'GET_AREA failed: bad seed' } });
        expect(cb).not.toHaveBeenCalled();
        expect(qm.inFlight.size).toBe(0);
        expect(qm.workers[0].busy).toBe(false);
        qm.draw(...areaArgs(a), cb);
        expect(w.postedKinds().filter((k) => k === 'GET_AREA')).toHaveLength(2);
    });

    it('a pending request resolves with a WORKER_CRASH error (it does not reject) and the queue moves on', async () => {
        const qm = await readyPool(1);
        const p = qm.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' });
        const next = qm.request('BIOME_AT', { mcVersion: 35, seed: '1', x: 0, z: 0 });
        FakeWorker.live()[0].crash('RuntimeError: unreachable');
        await expect(p).resolves.toEqual({ error: { code: 'WORKER_CRASH', message: expect.stringContaining('unreachable') } });
        const fresh = await bootReplacement();
        expect(fresh.lastPosted('BIOME_AT')).toBeDefined();
        fresh.emit('DONE_BIOME_AT', { requestId: fresh.lastPosted('BIOME_AT').data.requestId, biome: 1, error: null });
        await expect(next).resolves.toEqual({ biome: 1, error: null });
    });

    it('the one-shot helpers do not call back on an error reply; findSpawn hands it to onError', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        const onError = vi.fn();
        qm.findSpawn(35, 'nope', cb, onError);
        FakeWorker.live()[0].emit('DONE_GET_SPAWN', { error: { code: -7, message: 'GET_SPAWN failed' } });
        await vi.advanceTimersByTimeAsync(0);
        expect(cb).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith({ code: -7, message: 'GET_SPAWN failed' });
    });

    it('findSpawn reports a crash to onError', async () => {
        const qm = await readyPool(1);
        const onError = vi.fn();
        qm.findSpawn(35, '1', vi.fn(), onError);
        FakeWorker.live()[0].crash('RuntimeError: unreachable');
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledWith({ code: 'WORKER_CRASH', message: expect.stringContaining('unreachable') });
    });

    it('a search shard whose worker crashed is requeued once, and the search then completes', async () => {
        const qm = await readyPool(2);
        const c = cbs();
        qm.findSeeds(CRITERIA, c);
        const victim = FakeWorker.live().find((w) => w.lastPosted('FIND_SEEDS'));
        const shard = victim.lastPosted('FIND_SEEDS').data;
        victim.crash();
        expect(c.onDone).not.toHaveBeenCalled();
        expect(qm.searching).toBe(true);
        // The free worker takes the same shard at once.
        const other = FakeWorker.live().find((w) => w.lastPosted('FIND_SEEDS'));
        expect(other).not.toBe(victim);
        expect(other.lastPosted('FIND_SEEDS').data).toEqual(shard);
        other.emit('DONE_FIND_SEEDS', { shardId: shard.shardId, examined: 250_000, tested: 250_000, hits: 0, error: null });
        expect(c.onDone).toHaveBeenCalledWith([], 250_000n, 'exhausted', 251_000n, expect.objectContaining({ error: null }));
    });

    it('a shard that crashes its worker twice ends the search with reason error and WORKER_CRASH', async () => {
        const qm = await readyPool(2);
        const c = cbs();
        qm.findSeeds(CRITERIA, c);
        FakeWorker.live().find((w) => w.lastPosted('FIND_SEEDS')).crash();
        FakeWorker.live().find((w) => w.lastPosted('FIND_SEEDS')).crash();
        expect(c.onDone).toHaveBeenCalledWith([], 0n, 'error', 251_000n,
            expect.objectContaining({ error: { code: 'WORKER_CRASH', message: expect.any(String) } }));
        expect(qm.searching).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        for (const w of FakeWorker.live()) w.emit('DONE_LOADING');
        expect(qm.workers).toHaveLength(2);
    });

    it('stops replacing workers that keep crashing while booting, and then fails what is waiting', async () => {
        const qm = new QueueManager(PATH, 1);
        const p = qm.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' });
        for (let i = 0; i < 4; i++) {
            await vi.advanceTimersByTimeAsync(1);
            FakeWorker.instances.at(-1).crash('importScripts failed');
        }
        expect(FakeWorker.instances).toHaveLength(4);
        expect(FakeWorker.live()).toHaveLength(0);
        await expect(p).resolves.toEqual({ error: expect.objectContaining({ code: 'WORKER_CRASH' }) });
        expect(qm.COLORS).toBeNull();
    });

    // Every worker of a one-worker pool crashes while booting: 1 + MAX_BOOT_FAILURES tries.
    const deadPool = async () => {
        const qm = new QueueManager(PATH, 1);
        for (let i = 0; i < 4; i++) {
            await vi.advanceTimersByTimeAsync(1);
            FakeWorker.instances.at(-1).crash('importScripts failed');
        }
        expect(FakeWorker.live()).toHaveLength(0);
        return qm;
    };

    it('a dead pool answers what is asked later at once: a request with WORKER_CRASH, a search with reason error', async () => {
        const qm = await deadPool();
        await expect(qm.request('BIOME_AT', { mcVersion: 35, seed: '1', x: 0, z: 0 }))
            .resolves.toEqual({ error: expect.objectContaining({ code: 'WORKER_CRASH' }) });
        const c = cbs();
        const handle = qm.findSeeds(CRITERIA, c);
        expect(handle.id).toEqual(expect.any(Number));
        expect(c.onDone).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.onDone).toHaveBeenCalledWith([], 0n, 'error', 1000n,
            expect.objectContaining({ error: expect.objectContaining({ code: 'WORKER_CRASH' }) }));
        expect(qm.searching).toBe(false);
        expect(FakeWorker.instances).toHaveLength(4);
    });

    it('restartAll() brings a dead pool back, with its boot attempts', async () => {
        const qm = await deadPool();
        qm.restartAll();
        await vi.advanceTimersByTimeAsync(1);
        FakeWorker.instances.at(-1).crash('importScripts failed');
        expect(FakeWorker.instances).toHaveLength(6);           // the crash is replaced again
        await vi.advanceTimersByTimeAsync(1);
        const worker = FakeWorker.instances.at(-1);
        worker.emit('DONE_LOADING');
        // The fresh pool asks for the palette first (it never loaded).
        worker.emit('DONE_GET_COLORS', { colors: [[0, 0, 0, 255]] });
        await vi.advanceTimersByTimeAsync(0);                    // the palette lands in a .then()
        expect(qm.COLORS).toEqual([[0, 0, 0, 255]]);
        const p = qm.request('BIOME_AT', { mcVersion: 35, seed: '1', x: 0, z: 0 });
        worker.emit('DONE_BIOME_AT', { requestId: worker.lastPosted('BIOME_AT').data.requestId, biome: 1, error: null });
        await expect(p).resolves.toEqual({ biome: 1, error: null });
    });

    it('ignores a crash reported by a worker that was already terminated', async () => {
        const qm = await readyPool(2);
        qm.findSeeds(CRITERIA, cbs());
        const shardWorker = FakeWorker.live().find((w) => w.lastPosted('FIND_SEEDS'));
        qm.stopSearch();
        const count = FakeWorker.instances.length;
        shardWorker.crash();
        expect(FakeWorker.instances).toHaveLength(count);
        expect(qm.workers.every((w) => !w.terminated)).toBe(true);
    });
});
