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

    it('GET_BIOMES -> DONE_GET_BIOMES { seed: BigInt } after SEED_UPDATE progress ticks', async () => {
        w.clear();
        const { data } = await w.call('GET_BIOMES', { mcVersion: MC, biomes: [1], x: -25, z: -25, widthX: 50, widthZ: 50, startingSeed: 0, dimension: 0, yHeight: 256 });
        expect(typeof data.seed).toBe('bigint');
        expect(w.drain('SEED_UPDATE').length).toBeGreaterThanOrEqual(1);
        const area = (await w.call('GET_AREA', { mcVersion: MC, seed: data.seed, startX: -25, startY: -25, widthX: 50, widthY: 50, dimension: 0, yHeight: 256 })).data.ids;
        expect(Array.from(area)).toContain(1);
    });

    it('FIND_STRUCTURES -> DONE_FIND_STRUCTURES { seed: BigInt }', async () => {
        const { data } = await w.call('FIND_STRUCTURES', { mcVersion: MC, structType: 5, x: 0, z: 0, range: 300, startingSeed: 1, dimension: 0 });
        expect(typeof data.seed).toBe('bigint');
        const { coords } = (await w.call('GET_STRUCTURES_IN_REGIONS', { mcVersion: MC, structType: 5, seed: data.seed, regionsRange: 3, dimension: 0 })).data;
        expect(coords.some(([x, z]) => Math.abs(x) <= 300 && Math.abs(z) <= 300)).toBe(true);
    });

    it('GET_BIOMES_WITH_STRUCTURES -> DONE_GET_BIOMES_WITH_STRUCTURES { seed: BigInt }', async () => {
        const { data } = await w.call('GET_BIOMES_WITH_STRUCTURES', { mcVersion: MC, structType: 5, biomes: [1], x: 0, z: 0, range: 500, startingSeed: 1, dimension: 0, yHeight: 256 });
        expect(typeof data.seed).toBe('bigint');
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
