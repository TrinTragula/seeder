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

    it('findBiomes finds a seed, restarts the pool, and the pool keeps working afterwards', async () => {
        const before = VmWorker.instances.length;
        const found = callback();
        qm.findBiomes(MC, [1], -25, -25, 50, 50, 0, 0, 256, 9999, found.fn);
        const [seed] = await found.promise;
        expect(typeof seed).toBe('bigint');
        expect(Array.from(seeder.getArea(MC, seed, -25, -25, 50, 50, 0, 256).ids)).toContain(1);
        expect(VmWorker.instances.length).toBe(before + 2);
        await loaded(qm, 2);
        const { promise, fn } = callback();
        qm.draw(MC, '1', 0, 0, 8, 8, 0, 320, fn);
        expect((await promise)[0].ids).toHaveLength(64);
    });

    it('restartAll() replaces the pool and requests keep flowing', async () => {
        qm.restartAll();
        await loaded(qm, 2);
        const { promise, fn } = callback();
        qm.findSpawn(MC, SEED, fn);
        expect(await promise).toEqual([-32, 80]);
    });
});
