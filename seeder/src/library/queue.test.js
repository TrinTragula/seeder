// QueueManager: the Web Worker pool. Workers are scripted fakes here, so these tests
// pin down the scheduling contract (dispatch, dedup, queueing, sharding, restart)
// independently of the WASM. test/engine/queue.integration.test.js runs the same
// class against the real worker chain.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueManager } from './queue';
import { FakeWorker, FAKE_COLORS } from '../test/fakes';

const PATH = '/workers/worker.js?v=1.2.3';
const fakeModule = { fake: 'WebAssembly.Module' };

// Boot a pool: workers spawned, INIT delivered, every worker reports DONE_LOADING,
// and the constructor's GET_COLORS round trip completed.
async function readyPool(n = 2, { colors = true } = {}) {
    const qm = new QueueManager(PATH, n);
    await vi.advanceTimersByTimeAsync(1);                    // _modulePromise resolves -> INIT posted
    for (const w of FakeWorker.live()) w.emit('DONE_LOADING');
    await vi.advanceTimersByTimeAsync(2);                    // getColors() retry timer fires
    if (colors) {
        const w = FakeWorker.live().find((x) => x.lastPosted('GET_COLORS'));
        w.emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
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
        expect(qm.workers[0].busy).toBe(false);
    });

    it('asks a worker for the palette as soon as one is free and stores it in COLORS', async () => {
        const qm = await readyPool(2, { colors: false });
        const asked = FakeWorker.live().filter((w) => w.lastPosted('GET_COLORS'));
        expect(asked).toHaveLength(1);
        expect(qm.COLORS).toBeNull();
        asked[0].emit('DONE_GET_COLORS', { colors: FAKE_COLORS });
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

describe('seed searches', () => {
    it('findBiomes shards the seed space 1,000,000 apart across at most `threads` free workers', async () => {
        const qm = await readyPool(3);
        const cb = vi.fn();
        qm.findBiomes(35, [1, 4], -25, -25, 50, 50, 42, 0, 256, 2, cb);
        const posted = FakeWorker.live().map((w) => w.lastPosted('GET_BIOMES')).filter(Boolean);
        expect(posted).toHaveLength(2);
        expect(posted.map((m) => m.data.startingSeed)).toEqual([42, 1_000_042]);
        expect(posted[0]).toEqual({ kind: 'GET_BIOMES', data: { mcVersion: 35, biomes: [1, 4], x: -25, z: -25, widthX: 50, widthZ: 50, startingSeed: 42, dimension: 0, yHeight: 256 } });
        expect(qm.workers.filter((w) => w.busy)).toHaveLength(2);
    });

    it('findBiomes uses every free worker when threads is large, skipping busy ones, and starts at 0 by default', async () => {
        const qm = await readyPool(3);
        qm.draw(...areaArgs(area()), vi.fn());                // occupies one worker
        qm.findBiomes(35, [1], 0, 0, 10, 10, undefined, 0, 320, 9999, vi.fn());
        const posted = FakeWorker.live().map((w) => w.lastPosted('GET_BIOMES')).filter(Boolean);
        expect(posted).toHaveLength(2);
        expect(posted.map((m) => m.data.startingSeed)).toEqual([0, 1_000_000]);
    });

    it('does not dispatch a search while every worker is busy', async () => {
        const qm = await readyPool(2);
        qm.draw(...areaArgs(area({ startX: 75 })), vi.fn());
        qm.draw(...areaArgs(area({ startX: 150 })), vi.fn());
        qm.findBiomes(35, [1], 0, 0, 10, 10, 0, 0, 320, 9999, vi.fn());
        expect(FakeWorker.live().some((w) => w.lastPosted('GET_BIOMES'))).toBe(false);
    });

    it('on a hit, restarts the whole pool (dropping in-flight tiles) and then reports the seed', async () => {
        const qm = await readyPool(2);
        const onReset = vi.fn();
        const cb = vi.fn();
        const before = FakeWorker.live();
        qm.addResetListener(onReset);
        qm.draw(...areaArgs(area()), vi.fn());                   // one worker busy with a tile
        qm.findBiomes(35, [1], 0, 0, 10, 10, 0, 0, 320, 9999, cb);
        const searcher = before.find((w) => w.lastPosted('GET_BIOMES'));
        expect(searcher).toBeDefined();
        searcher.emit('DONE_GET_BIOMES', { seed: 4242n });
        expect(cb).toHaveBeenCalledWith(4242n);
        expect(before.every((w) => w.terminated)).toBe(true);
        expect(FakeWorker.live()).toHaveLength(2);
        expect(qm.workers).toHaveLength(0);                     // the new workers have not loaded yet
        expect(qm.pending).toEqual([]);
        expect(qm.inFlight.size).toBe(0);
        expect(onReset).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        for (const w of FakeWorker.live()) expect(w.posted[0]).toEqual({ kind: 'INIT', module: fakeModule });
    });

    it('findStructures posts FIND_STRUCTURES shards and restarts on DONE_FIND_STRUCTURES', async () => {
        const qm = await readyPool(2);
        const cb = vi.fn();
        qm.findStructures(35, 5, 0, 0, 300, 7, -1, 9999, cb);
        const posted = FakeWorker.live().map((w) => w.lastPosted('FIND_STRUCTURES'));
        expect(posted[0]).toEqual({ kind: 'FIND_STRUCTURES', data: { mcVersion: 35, structType: 5, x: 0, z: 0, range: 300, startingSeed: 7, dimension: -1 } });
        expect(posted[1].data.startingSeed).toBe(1_000_007);
        FakeWorker.live()[1].emit('DONE_FIND_STRUCTURES', { seed: 99n });
        expect(cb).toHaveBeenCalledWith(99n);
        expect(FakeWorker.instances.filter((w) => w.terminated)).toHaveLength(2);
    });

    it('findBiomesWithStructures posts GET_BIOMES_WITH_STRUCTURES and restarts on its reply', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.findBiomesWithStructures(35, 5, [1, 2], 0, 0, 500, 3, 0, 256, 9999, cb);
        expect(FakeWorker.live()[0].lastPosted('GET_BIOMES_WITH_STRUCTURES')).toEqual({
            kind: 'GET_BIOMES_WITH_STRUCTURES',
            data: { mcVersion: 35, structType: 5, biomes: [1, 2], x: 0, z: 0, range: 500, startingSeed: 3, dimension: 0, yHeight: 256 },
        });
        FakeWorker.live()[0].emit('DONE_GET_BIOMES_WITH_STRUCTURES', { seed: 5n });
        expect(cb).toHaveBeenCalledWith(5n);
        expect(FakeWorker.instances[0].terminated).toBe(true);
    });

    it('forwards SEED_UPDATE progress ticks to seedUpdateCallback (and tolerates none being set)', async () => {
        const qm = await readyPool(1);
        expect(() => FakeWorker.live()[0].emit('SEED_UPDATE')).not.toThrow();
        qm.seedUpdateCallback = vi.fn();
        FakeWorker.live()[0].emit('SEED_UPDATE');
        FakeWorker.live()[0].emit('SEED_UPDATE');
        expect(qm.seedUpdateCallback).toHaveBeenCalledTimes(2);
    });
});

describe('one-shot queries', () => {
    it('findSpawn posts GET_SPAWN and calls back with (x, z)', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.findSpawn(35, '123', cb);
        expect(FakeWorker.live()[0].lastPosted('GET_SPAWN')).toEqual({ kind: 'GET_SPAWN', data: { mcVersion: 35, seed: '123' } });
        FakeWorker.live()[0].emit('DONE_GET_SPAWN', { x: -32, z: 80 });
        expect(cb).toHaveBeenCalledWith(-32, 80);
        expect(qm.workers[0].busy).toBe(false);
    });

    it('findSpawn waits (polling) for a free worker instead of dropping the request', async () => {
        const qm = await readyPool(1);
        const a = area();
        qm.draw(...areaArgs(a), vi.fn());
        const cb = vi.fn();
        qm.findSpawn(35, '123', cb);
        await vi.advanceTimersByTimeAsync(10);
        expect(FakeWorker.live()[0].lastPosted('GET_SPAWN')).toBeUndefined();
        FakeWorker.live()[0].emit('DONE_GET_AREA', { ...a, rgba: new Uint8ClampedArray(0), ids: new Int32Array(0) });
        await vi.advanceTimersByTimeAsync(2);
        expect(FakeWorker.live()[0].lastPosted('GET_SPAWN')).toBeDefined();
    });

    it('findStrongholds posts GET_STRONGHOLDS and calls back with the reply data', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.findStrongholds(35, '123', 150, cb);
        expect(FakeWorker.live()[0].lastPosted('GET_STRONGHOLDS')).toEqual({ kind: 'GET_STRONGHOLDS', data: { mcVersion: 35, seed: '123', howMany: 150 } });
        FakeWorker.live()[0].emit('DONE_GET_STRONGHOLDS', { coords: [[1, 2]] });
        expect(cb).toHaveBeenCalledWith({ coords: [[1, 2]] });
    });

    it('getStructuresInRegions posts GET_STRUCTURES_IN_REGIONS and calls back with the reply data', async () => {
        const qm = await readyPool(1);
        const cb = vi.fn();
        qm.getStructuresInRegions(35, 5, '123', 50, 0, cb);
        expect(FakeWorker.live()[0].lastPosted('GET_STRUCTURES_IN_REGIONS')).toEqual({ kind: 'GET_STRUCTURES_IN_REGIONS', data: { mcVersion: 35, structType: 5, seed: '123', regionsRange: 50, dimension: 0 } });
        FakeWorker.live()[0].emit('DONE_GET_STRUCTURES_IN_REGIONS', { coords: [[3, 4]] });
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
