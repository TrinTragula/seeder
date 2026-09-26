// A worker handler that throws still answers: DONE_<kind> with an `error`, so the pool is
// never left waiting on a reply that will not come. A WASM trap, and a boot that fails, are
// uncaught errors instead, for the pool to replace the worker. Also pins the palette read
// from get_colors.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createWorkerHarness } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const MC = VERSIONS['26.3'];
const SEED = '8091867987493326313';
const failed = (kind) => ({ code: -7, message: expect.stringContaining(`${kind} failed`) });

describe('map and search handlers reply with an error when they throw', () => {
    let w;
    beforeAll(async () => { w = await createWorkerHarness(); });

    it('GET_AREA with a malformed seed -> DONE_GET_AREA echoing the area, no buffers', async () => {
        const area = { mcVersion: MC, seed: 'not-a-seed', startX: 0, startY: 0, widthX: 4, widthY: 4, dimension: 0, yHeight: 320 };
        const { data } = await w.call('GET_AREA', area);
        expect(data).toEqual({ ...area, error: failed('GET_AREA') });
    });

    it('GET_SPAWN, GET_STRONGHOLDS and GET_STRUCTURES_IN_REGIONS with a malformed seed', async () => {
        expect((await w.call('GET_SPAWN', { mcVersion: MC, seed: 'x' })).data).toEqual({ error: failed('GET_SPAWN') });
        expect((await w.call('GET_STRONGHOLDS', { mcVersion: MC, seed: 'x', howMany: 3 })).data).toEqual({ error: failed('GET_STRONGHOLDS') });
        expect((await w.call('GET_STRUCTURES_IN_REGIONS', { mcVersion: MC, structType: 5, seed: 'x', regionsRange: 1, dimension: 0 })).data)
            .toEqual({ error: failed('GET_STRUCTURES_IN_REGIONS') });
    });

    it('FIND_SEEDS whose Seeder method throws -> DONE_FIND_SEEDS with the shardId and zero counters', async () => {
        const original = w.seeder.findSeeds;
        w.seeder.findSeeds = () => { throw new Error('stubbed'); };
        try {
            const { data } = await w.call('FIND_SEEDS', { shardId: '1-0', mcVersion: MC, structures: [5], rangeBlocks: 300, startingSeed: '0', maxSeedsToScan: 10, maxResults: 1 });
            expect(data).toEqual({ shardId: '1-0', examined: 0, tested: 0, hits: 0, error: failed('FIND_SEEDS') });
        } finally {
            w.seeder.findSeeds = original;
        }
    });

    it('GET_COLORS whose Seeder is broken -> DONE_GET_COLORS with an error', async () => {
        const seeder = w.context.seeder;
        w.context.seeder = null;
        try {
            expect((await w.call('GET_COLORS')).data).toEqual({ error: failed('GET_COLORS') });
        } finally {
            w.context.seeder = seeder;
        }
    });

    // No reply: a reply would free the worker in the pool, which would hand it the next job
    // before the crash arrives and blame that job for it (QueueManager._onWorkerCrash).
    it('a WASM trap gets no reply: it escapes the listener, so the Worker\'s error event fires', () => {
        const original = w.seeder.findSpawn;
        w.seeder.findSpawn = () => { throw new WebAssembly.RuntimeError('unreachable'); };
        try {
            expect(() => w.send('GET_SPAWN', { mcVersion: MC, seed: SEED })).toThrow(WebAssembly.RuntimeError);
            expect(w.drain('DONE_GET_SPAWN')).toEqual([]);
        } finally {
            w.seeder.findSpawn = original;
        }
    });

    it('a WASM trap in a dashboard request gets no reply either; any other throw still does', async () => {
        const original = w.seeder.seedSummary;
        try {
            w.seeder.seedSummary = () => { throw new WebAssembly.RuntimeError('memory access out of bounds'); };
            expect(() => w.send('SEED_SUMMARY', { requestId: 7, mcVersion: MC, seed: SEED })).toThrow('out of bounds');
            expect(w.drain('DONE_SEED_SUMMARY')).toEqual([]);
            w.seeder.seedSummary = () => { throw new Error('stubbed'); };
            const { data } = await w.call('SEED_SUMMARY', { requestId: 8, mcVersion: MC, seed: SEED });
            expect(data).toEqual({ requestId: 8, error: { code: -7, message: expect.stringContaining('Invalid SEED_SUMMARY request') } });
        } finally {
            w.seeder.seedSummary = original;
        }
    });

    it('the worker keeps answering normally afterwards', async () => {
        expect((await w.call('GET_SPAWN', { mcVersion: MC, seed: SEED })).data).toEqual({ x: -32, z: 80 });
    });
});

// A boot that fails inside a promise must still reach the pool as an uncaught error, or the
// worker would stay booting forever: rethrown from a timer, it fires the Worker's error event.
describe('a failed boot is rethrown as an uncaught error', () => {
    const booting = async () => {
        const w = await createWorkerHarness({ init: false });
        const deferred = [];
        w.context.setTimeout = (fn) => { deferred.push(fn); };
        return { w, deferred };
    };

    it('when the shared module cannot be instantiated', async () => {
        const { w, deferred } = await booting();
        w.sendRaw({ kind: 'INIT', module: {} });
        await vi.waitFor(() => expect(deferred).toHaveLength(1));
        expect(deferred[0]).toThrow(/WebAssembly\.instantiate/);
        expect(w.drain('DONE_LOADING')).toEqual([]);
    });

    it('when the loader aborts (its own fetch + compile failed), but not once loaded', async () => {
        const { w, deferred } = await booting();
        w.sendRaw({ kind: 'INIT', module: {} });
        await vi.waitFor(() => expect(deferred).toHaveLength(1));
        w.Module.onAbort('both async and sync fetching of the wasm failed');
        expect(deferred).toHaveLength(2);
        expect(deferred[1]).toThrow('The engine failed to load: both async and sync fetching of the wasm failed');

        const loaded = await createWorkerHarness();
        const later = [];
        loaded.context.setTimeout = (fn) => { later.push(fn); };
        loaded.Module.onAbort('malloc failed');
        expect(later).toEqual([]);
    });
});

describe('palette', () => {
    it('holds one RGBA entry per id of get_colors\' 256-entry table, the last one included', async () => {
        const w = await createWorkerHarness();
        const { COLORS } = w.seeder;
        expect(COLORS).toHaveLength(256);
        expect(COLORS[255]).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), 255]);
        for (const c of COLORS) expect(c).toHaveLength(4);
    });

    it('paints an id outside the palette opaque black instead of throwing', async () => {
        const w = await createWorkerHarness();
        w.seeder.COLORS = w.seeder.COLORS.slice(0, 1);
        const { data } = await w.call('GET_AREA', { mcVersion: MC, seed: SEED, startX: 0, startY: 0, widthX: 8, widthY: 8, dimension: 0, yHeight: 320 });
        expect(data.error).toBeUndefined();
        expect(data.ids.some((id) => id !== 0)).toBe(true);
        for (let i = 0; i < data.ids.length; i++) {
            if (data.ids[i] === 0) continue;
            expect(Array.from(data.rgba.subarray(i * 4, i * 4 + 4))).toEqual([0, 0, 0, 255]);
        }
    });
});
