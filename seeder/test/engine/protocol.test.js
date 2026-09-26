// The worker message contract between src/library/queue.js and public/workers/worker.js,
// exercised against the real WASM. If a refactor changes a message kind or payload
// shape, this is the test that says so.
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness, compileWasm } from './harness.js';
import { VERSIONS } from '../../src/util/constants';

const MC = VERSIONS['26.3'];
const SEED = '8091867987493326313';
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('worker boot', () => {
    it('ignores requests until INIT and answers INIT with exactly one DONE_LOADING', async () => {
        const w = await createWorkerHarness({ init: false });
        w.send('GET_COLORS');
        await tick();
        expect(w.messages).toEqual([]);
        await w.init();
        await tick();
        expect(w.drain('DONE_LOADING')).toEqual([]);           // the awaited one was the only one
        expect(w.listenerCount()).toBe(1);                      // boot listener replaced by the request listener
        expect(w.seeder).toBeDefined();
    });

    it('boots with a module precompiled by the pool (the fast path QueueManager uses)', async () => {
        const w = await createWorkerHarness({ init: false });
        const module = await compileWasm();
        expect(module).toBeInstanceOf(WebAssembly.Module);
        await expect(w.init(module)).resolves.toMatchObject({ kind: 'DONE_LOADING' });
    });

    it('boots without a precompiled module by loading api.wasm itself', async () => {
        const w = await createWorkerHarness({ init: false });
        await expect(w.init(null)).resolves.toMatchObject({ kind: 'DONE_LOADING' });
        const reply = await w.call('GET_SPAWN', { mcVersion: MC, seed: SEED });
        expect(reply.data).toEqual({ x: -32, z: 80 });
    });

    it('propagates the ?v= cache-buster to every script it imports', async () => {
        const w = await createWorkerHarness({ init: false, cacheBust: '9.9.9' });
        const imported = [];
        const original = w.context.importScripts;
        w.context.importScripts = (...urls) => { imported.push(...urls); return original(...urls); };
        await w.init();
        expect(imported).toEqual(['api.js?v=9.9.9', 'seeder.js?v=9.9.9']);
    });

    it('ignores unknown message kinds without replying or throwing', async () => {
        const w = await createWorkerHarness();
        expect(() => w.send('NOT_A_THING', { foo: 1 })).not.toThrow();
        await tick();
        expect(w.messages).toEqual([]);
    });
});

describe('requests and replies', () => {
    let w;
    beforeAll(async () => { w = await createWorkerHarness(); });

    it('GET_COLORS -> DONE_GET_COLORS with an RGBA palette indexed by biome id', async () => {
        const { data } = await w.call('GET_COLORS');
        expect(data.colors.length).toBeGreaterThan(188);        // covers the newest biome id
        for (const c of data.colors) { expect(c).toHaveLength(4); expect(c[3]).toBe(255); }
        expect(data.colors[1]).toEqual([141, 179, 96, 255]);   // plains, cubiomes' palette
    });

    it('GET_AREA -> DONE_GET_AREA echoing the request, with transferable rgba + ids buffers', async () => {
        const req = { mcVersion: MC, seed: SEED, startX: -8, startY: 4, widthX: 16, widthY: 12, dimension: 0, yHeight: 320 };
        const reply = await w.call('GET_AREA', req);
        const { rgba, ids, ...echo } = reply.data;
        expect(echo).toEqual(req);
        expect(ids).toBeInstanceOf(Int32Array);
        expect(ids).toHaveLength(16 * 12);
        expect(rgba).toBeInstanceOf(Uint8ClampedArray);
        expect(rgba).toHaveLength(16 * 12 * 4);
        const { colors } = (await w.call('GET_COLORS')).data;
        for (let i = 0; i < ids.length; i++) {
            expect(Array.from(rgba.subarray(i * 4, i * 4 + 4))).toEqual(colors[ids[i]]);
        }
        expect(w.transferOf(reply)).toEqual([rgba.buffer, ids.buffer]);
    });

    it('GET_AREA is row-major: ids[row * width + col] is the cell at (startX + col, startY + row)', async () => {
        const area = (await w.call('GET_AREA', { mcVersion: MC, seed: SEED, startX: -64, startY: -64, widthX: 128, widthY: 128, dimension: 0, yHeight: 320 })).data.ids;
        const single = async (x, z) => (await w.call('GET_AREA', { mcVersion: MC, seed: SEED, startX: x, startY: z, widthX: 1, widthY: 1, dimension: 0, yHeight: 320 })).data.ids[0];
        for (const [col, row] of [[0, 0], [127, 0], [0, 127], [37, 91]]) {
            expect(area[row * 128 + col]).toBe(await single(-64 + col, -64 + row));
        }
    });

    it('GET_SPAWN -> DONE_GET_SPAWN { x, z }', async () => {
        const { data } = await w.call('GET_SPAWN', { mcVersion: MC, seed: SEED });
        expect(data).toEqual({ x: -32, z: 80 });
    });

    it('GET_STRONGHOLDS -> DONE_GET_STRONGHOLDS { coords } with no (-1,-1) padding', async () => {
        const { data } = await w.call('GET_STRONGHOLDS', { mcVersion: MC, seed: SEED, howMany: 3 });
        expect(data.coords.map((c) => Array.from(c))).toEqual([[-1356, 164], [644, -1484], [1108, 1524]]);
    });

    it('GET_STRUCTURES_IN_REGIONS -> DONE_GET_STRUCTURES_IN_REGIONS { coords } of viable positions only', async () => {
        const { data } = await w.call('GET_STRUCTURES_IN_REGIONS', { mcVersion: MC, structType: 5, seed: SEED, regionsRange: 4, dimension: 0 });
        expect(data.coords.length).toBeGreaterThan(0);
        for (const [x, z] of data.coords) {
            expect(x).not.toBe(-1);
            expect(Math.abs(x)).toBeLessThan(4 * 34 * 16 + 512);   // inside ±4 village regions (34 chunks) plus slack
            expect(Math.abs(z)).toBeLessThan(4 * 34 * 16 + 512);
        }
    });

    it('FIND_SEEDS -> streamed SEED_FOUND hits, then DONE_FIND_SEEDS echoing shardId with the shard summary', async () => {
        w.clear();
        const req = { shardId: 'p-1', mcVersion: MC, dimension: 0, yHeight: 256, biomes: [1], structures: [5], rangeBlocks: 300, startingSeed: '1', maxSeedsToScan: 1000, maxResults: 1 };
        const { data } = await w.call('FIND_SEEDS', req);
        expect(data).toEqual({ shardId: 'p-1', examined: expect.any(Number), tested: expect.any(Number), hits: 1, error: null });
        const hits = w.drain('SEED_FOUND').map((m) => m.data);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toEqual({
            seed: expect.any(BigInt), spawnX: expect.any(Number), spawnZ: expect.any(Number),
            structures: [{ type: 5, x: expect.any(Number), z: expect.any(Number) }],
            examined: expect.any(Number), tested: expect.any(Number),
        });
        expect(hits[0].structures[0]).not.toBeInstanceOf(Int32Array);      // plain objects, copied out of the heap
        expect(hits[0].examined).toBe(data.examined);
    });

    it('SEED_UPDATE carries numeric { examined, tested } progress counters, paced by time (~100 ms)', async () => {
        w.clear();
        // A 26.3 biome check at ±100 costs ~7 ms and this biome set never occurs together:
        // 40 checks are well over 100 ms of work with no hit to end the shard early.
        await w.call('FIND_SEEDS', { shardId: 'p-2', mcVersion: MC, dimension: 0, yHeight: 256, biomes: [1, 14, 140, 21, 185], structures: [], rangeBlocks: 100, startingSeed: '0', maxSeedsToScan: 40, maxResults: 1e9 });
        const updates = w.drain('SEED_UPDATE').map((m) => m.data);
        expect(updates.length).toBeGreaterThanOrEqual(1);
        for (const u of updates) expect(u).toEqual({ examined: expect.any(Number), tested: expect.any(Number) });
        expect(updates.at(-1).examined).toBeLessThanOrEqual(40);
    });

    it('DONE_FIND_SEEDS reports engine errors as { code, message } instead of throwing', async () => {
        const { data } = await w.call('FIND_SEEDS', { shardId: 'p-3', mcVersion: MC, dimension: 0, yHeight: 256, biomes: [], structures: [], rangeBlocks: 300, startingSeed: '1', maxSeedsToScan: 1000, maxResults: 1 });
        expect(data).toEqual({ shardId: 'p-3', examined: 0, tested: 0, hits: 0, error: { code: -7, message: expect.any(String) } });
    });

    it('GET_VERSION_SUPPORT -> DONE_GET_VERSION_SUPPORT { mcVersion, newest, biomes, biomeDimensions, structures, regionBlocks, minDistance }', async () => {
        const { data } = await w.call('GET_VERSION_SUPPORT', { mcVersion: MC, biomeIds: [1, 8], structTypes: [5, 21] });
        expect(data).toEqual({
            mcVersion: MC, newest: Math.max(...Object.values(VERSIONS)),
            biomes: [1, 8], biomeDimensions: { 1: 0, 8: -1 },
            structures: { 5: 0, 21: 1 }, regionBlocks: { 5: 544, 21: 320 }, minDistance: { 5: 0, 21: 1008 },
        });
    });

    it('the single-result legacy kinds are gone: GET_BIOMES, FIND_STRUCTURES and GET_BIOMES_WITH_STRUCTURES get no reply', async () => {
        w.clear();
        w.send('GET_BIOMES', { mcVersion: MC, biomes: [1], x: -25, z: -25, widthX: 50, widthZ: 50, startingSeed: 0, dimension: 0, yHeight: 256 });
        w.send('FIND_STRUCTURES', { mcVersion: MC, structType: 5, x: 0, z: 0, range: 300, startingSeed: 1, dimension: 0 });
        w.send('GET_BIOMES_WITH_STRUCTURES', { mcVersion: MC, structType: 5, biomes: [1], x: 0, z: 0, range: 500, startingSeed: 1, dimension: 0, yHeight: 256 });
        await tick();
        expect(w.messages).toEqual([]);
    });
});

describe('64-bit seeds', () => {
    it('accepts a seed as a decimal string, a BigInt or a Number and treats them alike', async () => {
        const w = await createWorkerHarness();
        const ids = async (seed) => Array.from((await w.call('GET_AREA', { mcVersion: MC, seed, startX: 0, startY: 0, widthX: 8, widthY: 8, dimension: 0, yHeight: 320 })).data.ids);
        expect(await ids('12345')).toEqual(await ids(12345n));
        expect(await ids('12345')).toEqual(await ids(12345));
    });

    it('keeps full precision for seeds beyond 2^53 when they travel as strings or BigInts', async () => {
        const w = await createWorkerHarness();
        const spawn = async (seed) => (await w.call('GET_SPAWN', { mcVersion: MC, seed })).data;
        const exact = await spawn('8091867987493326313');
        expect(exact).toEqual(await spawn(8091867987493326313n));
        // Number(...) rounds to 8091867987493326848: a different world.
        expect(Number('8091867987493326313')).not.toBe(8091867987493326313n);
        expect(await spawn(Number('8091867987493326313'))).not.toEqual(exact);
    });
});
