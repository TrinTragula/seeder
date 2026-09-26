// SlimeOverlay and ChunkGridOverlay: the map overlays. The pool is the recording
// FakeQueueManager (answers come from the test), the canvas the RecordingCanvasContext.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BLOCK, CACHE_MAX, SLIME_BORDER, SLIME_COLOR, SlimeOverlay, visibleChunks, ChunkGridOverlay, GRID_COLOR, OVERLAYS } from './overlays';
import { FakeQueueManager, RecordingCanvasContext } from '../test/fakes';

const SEED = '8091867987493326313';
const W = 300, H = 150;

let queue, ctx, onReady;
const newOverlay = () => {
    const overlay = new SlimeOverlay(queue, { onReady });
    overlay.setSeed(SEED);
    return overlay;
};
// The view DrawSeed hands to draw(): origin centred, zoom `pixDim`.
const view = (over = {}) => ({ seed: SEED, dimension: 0, panX: W / 2, panZ: H / 2, pixDim: 1, W, H, ...over });
const slimeRequests = () => queue.requests.filter((r) => r.kind === 'SLIME_CHUNKS');
// A block's reply with slime at the given (dx, dz) offsets inside the block.
const blockReply = (bx, bz, slimes = []) => {
    const cells = new Uint8Array(BLOCK * BLOCK);
    for (const [dx, dz] of slimes) cells[dz * BLOCK + dx] = 1;
    return { cx0: bx * BLOCK, cz0: bz * BLOCK, w: BLOCK, h: BLOCK, cells };
};
// Answer the pending request for block (bx, bz).
const answer = async (bx, bz, slimes) => {
    const entry = queue.pendingOf('SLIME_CHUNKS').find((r) => r.data.cx0 === bx * BLOCK && r.data.cz0 === bz * BLOCK);
    if (!entry) throw new Error(`block ${bx},${bz} was never asked for`);
    entry.resolve({ error: null, ...blockReply(bx, bz, slimes) });
    await Promise.resolve();
    await Promise.resolve();
};
const fills = () => ctx.callsOf('fillRect').map((c) => c.args);

beforeEach(() => {
    FakeQueueManager.reset();
    queue = new FakeQueueManager('/workers/worker.js', 4);
    ctx = new RecordingCanvasContext(null);
    onReady = vi.fn();
});

describe('visibleChunks', () => {
    it('covers the view in 16-block chunks at pixDim 1, 3 and 5', () => {
        // 4 px per chunk, origin at (150, 75): chunks -38..37 across, -19..18 down.
        expect(visibleChunks(view())).toEqual({ cxMin: -38, cxMax: 37, czMin: -19, czMax: 18 });
        // 12 px per chunk.
        expect(visibleChunks(view({ pixDim: 3 }))).toEqual({ cxMin: -13, cxMax: 12, czMin: -7, czMax: 6 });
        // 20 px per chunk, panned so the origin is at (-35, 10).
        expect(visibleChunks(view({ pixDim: 5, panX: -35, panZ: 10 }))).toEqual({ cxMin: 1, cxMax: 16, czMin: -1, czMax: 7 });
    });
});

describe('requests', () => {
    it('asks once per visible 64x64-chunk block, low priority, with its own token', () => {
        const overlay = newOverlay();
        overlay.draw(ctx, view());
        // Chunks -38..37 x -19..18 span blocks -1..0 x -1..0.
        const asked = slimeRequests();
        expect(asked.map((r) => r.data)).toEqual(expect.arrayContaining([
            { seed: SEED, cx0: -64, cz0: -64, w: 64, h: 64 },
            { seed: SEED, cx0: 0, cz0: -64, w: 64, h: 64 },
            { seed: SEED, cx0: -64, cz0: 0, w: 64, h: 64 },
            { seed: SEED, cx0: 0, cz0: 0, w: 64, h: 64 },
        ]));
        expect(asked).toHaveLength(4);
        for (const r of asked) expect(r.opts).toEqual({ priority: 'low', token: overlay.token });
        expect(typeof overlay.token).toBe('symbol');
        expect(overlay.pending.size).toBe(4);
    });

    it('never asks twice for a block that is pending or cached', async () => {
        const overlay = newOverlay();
        overlay.draw(ctx, view());
        overlay.draw(ctx, view());
        expect(slimeRequests()).toHaveLength(4);
        await answer(0, 0, []);
        expect(overlay.pending.size).toBe(3);
        expect(overlay.cache.size).toBe(1);
        overlay.draw(ctx, view());
        expect(slimeRequests()).toHaveLength(4);
    });

    it('calls onReady when a block lands, and a cancelled or failed one just leaves pending', async () => {
        const overlay = newOverlay();
        overlay.draw(ctx, view());
        await answer(-1, -1, [[0, 0]]);
        expect(onReady).toHaveBeenCalledTimes(1);
        // An engine error is dropped without caching; the next frame asks again.
        queue.pendingOf('SLIME_CHUNKS')[0].resolve({ error: { code: -7, message: 'bad' } });
        await Promise.resolve();
        queue.pendingOf('SLIME_CHUNKS')[0].reject({ cancelled: true, reason: 'killed' });
        await Promise.resolve();
        expect(overlay.pending.size).toBe(1);
        expect(overlay.cache.size).toBe(1);
        expect(onReady).toHaveBeenCalledTimes(1);
        overlay.draw(ctx, view());
        expect(slimeRequests()).toHaveLength(6);
    });

    it('evicts the oldest block beyond 256', async () => {
        const overlay = newOverlay();
        for (let i = 0; i < CACHE_MAX; i++) overlay.cache.set(`${SEED}:${1000 + i}:0`, new Uint8Array(BLOCK * BLOCK));
        overlay.draw(ctx, view());
        await answer(0, 0, []);
        expect(overlay.cache.size).toBe(CACHE_MAX);
        expect(overlay.cache.has(`${SEED}:1000:0`)).toBe(false);
        expect(overlay.cache.has(`${SEED}:1001:0`)).toBe(true);
        expect(overlay.cache.has(`${SEED}:0:0`)).toBe(true);
    });

    it('setSeed cancels the token and empties cache and pending; late answers are ignored', async () => {
        const overlay = newOverlay();
        overlay.draw(ctx, view());
        await answer(0, 0, [[1, 1]]);
        const [late] = queue.pendingOf('SLIME_CHUNKS');
        overlay.setSeed('42');
        expect(queue.cancelToken).toHaveBeenCalledWith(overlay.token);
        expect(overlay.cache.size).toBe(0);
        expect(overlay.pending.size).toBe(0);
        expect(late.settled).toBe(true);                             // rejected by the cancellation
        overlay.draw(ctx, view({ seed: '42' }));
        expect(slimeRequests().slice(-4).map((r) => r.data.seed)).toEqual(['42', '42', '42', '42']);
    });

    it('destroy cancels too', () => {
        const overlay = newOverlay();
        overlay.draw(ctx, view());
        overlay.destroy();
        expect(queue.cancelToken).toHaveBeenLastCalledWith(overlay.token);
        expect(queue.pendingOf('SLIME_CHUNKS')).toHaveLength(0);
        expect(overlay.pending.size).toBe(0);
    });
});

describe('drawing', () => {
    // Draw once to ask, answer every block with the given slimes (block, dx, dz), draw again.
    async function drawWith(overlay, v, slimes) {
        overlay.draw(ctx, v);
        for (const r of queue.pendingOf('SLIME_CHUNKS')) {
            const bx = r.data.cx0 / BLOCK, bz = r.data.cz0 / BLOCK;
            await answer(bx, bz, slimes.filter(([b]) => b[0] === bx && b[1] === bz).map(([, dx, dz]) => [dx, dz]));
        }
        ctx.reset();
        overlay.draw(ctx, v);
    }

    it('fills only slime chunks, integer-snapped, in --color-slime', async () => {
        const overlay = newOverlay();
        // Chunk (0, 0) and chunk (-1, -1) (last cell of block (-1, -1)).
        await drawWith(overlay, view(), [[[0, 0], 0, 0], [[-1, -1], 63, 63]]);
        expect(fills()).toEqual(expect.arrayContaining([[150, 75, 4, 4], [146, 71, 4, 4]]));
        expect(fills()).toHaveLength(2);
        expect(ctx.fillStyle).toBe(SLIME_COLOR);
        expect(ctx.callsOf('strokeRect')).toHaveLength(0);           // 4 px chunks: no outline
    });

    it('snaps a fractional pan like the tiles: neighbouring chunks meet without gaps or overlap', async () => {
        const overlay = newOverlay();
        const slimes = [0, 1, 2, 3, 4, 5].map((dx) => [[0, 0], dx, 0]);
        // Mid-pinch the zoom is fractional: 10.8 px per chunk.
        await drawWith(overlay, view({ pixDim: 2.7, panX: 150.4, panZ: 75.6 }), slimes);
        const rects = fills().sort((a, b) => a[0] - b[0]);
        expect(rects).toHaveLength(6);
        for (const [dx, dy, dw, dh] of rects) {
            for (const n of [dx, dy, dw, dh]) expect(Number.isInteger(n)).toBe(true);
            expect([dy, dh]).toEqual([76, 10]);
        }
        for (let i = 1; i < rects.length; i++) expect(rects[i][0]).toBe(rects[i - 1][0] + rects[i - 1][2]);
        expect(rects[0][0]).toBe(150);
        expect(new Set(rects.map((r) => r[2]))).toEqual(new Set([10, 11]));   // widths vary, edges still meet
    });

    it('outlines each slime chunk, 1 px inside it, once a chunk is 8 px or more', async () => {
        const overlay = newOverlay();
        await drawWith(overlay, view({ pixDim: 2 }), [[[0, 0], 0, 0]]);
        expect(fills()).toEqual([[150, 75, 8, 8]]);
        const [outline] = ctx.callsOf('strokeRect').map((c) => c.args);
        expect(outline).toEqual([150.5, 75.5, 7, 7, { strokeStyle: SLIME_BORDER, lineWidth: 1 }]);
    });

    it('draws nothing in the Nether or the End, or without a seed, and asks for nothing there', () => {
        const overlay = newOverlay();
        overlay.draw(ctx, view({ dimension: -1 }));
        overlay.draw(ctx, view({ dimension: 1 }));
        overlay.draw(ctx, view({ seed: null }));
        expect(ctx.calls).toHaveLength(0);
        expect(slimeRequests()).toHaveLength(0);
    });
});

describe('ChunkGridOverlay', () => {
    const grid = () => {
        const overlay = new ChunkGridOverlay();
        overlay.setSeed(SEED);
        return overlay;
    };
    const lines = () => fills().map(([x, y, w, h]) => (w === 1 ? `x${x}` : `z${y}`));

    it('draws a 1 px line on the first pixel column and row of every visible chunk from zoom 3', () => {
        // 12 px per chunk, origin at (150, 75): columns at 150 - 12k, rows at 75 - 12k.
        grid().draw(ctx, view({ pixDim: 3 }));
        expect(ctx.fillStyle).toBe(GRID_COLOR);
        const xs = fills().filter(([, , w]) => w === 1);
        const zs = fills().filter(([, , w]) => w === W);
        expect(xs.map(([x]) => x)).toEqual([6, 18, 30, 42, 54, 66, 78, 90, 102, 114, 126, 138, 150, 162, 174, 186, 198, 210, 222, 234, 246, 258, 270, 282, 294]);
        for (const [, y, , h] of xs) expect([y, h]).toEqual([0, H]);
        expect(zs.map(([, z]) => z)).toEqual([3, 15, 27, 39, 51, 63, 75, 87, 99, 111, 123, 135, 147]);
        for (const [x, , , h] of zs) expect([x, h]).toEqual([0, 1]);
    });

    it('lands on the slime squares\' edges: the same snapping, also mid-pinch', () => {
        const v = view({ pixDim: 3.5, panX: 100.3, panZ: 40.7 });
        grid().draw(ctx, v);
        const xs = new Set(fills().filter(([, , w]) => w === 1).map(([x]) => x));
        const chunkPx = 4 * 3.5;
        for (let cx = -7; cx <= 14; cx++) {
            const edge = Math.round(cx * chunkPx + v.panX);
            if (edge >= 0 && edge < W) expect(xs.has(edge), `chunk ${cx}`).toBe(true);
        }
    });

    it('draws nothing below zoom 3 or without a seed; in the Nether and the End it does', () => {
        grid().draw(ctx, view({ pixDim: 2 }));
        grid().draw(ctx, view({ pixDim: 2.9 }));
        grid().draw(ctx, view({ pixDim: 5, seed: null }));
        expect(ctx.calls).toHaveLength(0);
        grid().draw(ctx, view({ pixDim: 5, dimension: -1 }));
        expect(lines().length).toBeGreaterThan(0);
        ctx.reset();
        grid().draw(ctx, view({ pixDim: 5, dimension: 1 }));
        expect(lines().length).toBeGreaterThan(0);
    });

    it('needs nothing from the pool, and the registry draws it over the slime squares', () => {
        const overlay = new ChunkGridOverlay(queue, { onReady });
        overlay.setSeed(SEED);
        overlay.draw(ctx, view({ pixDim: 4 }));
        overlay.destroy();
        expect(queue.requests).toHaveLength(0);
        expect(queue.cancelToken).not.toHaveBeenCalled();
        expect(Object.keys(OVERLAYS)).toEqual(['slime', 'chunkGrid']);
    });
});
