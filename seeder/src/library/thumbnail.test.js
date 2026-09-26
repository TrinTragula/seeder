import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeQueueManager } from '../test/fakes';
import {
    MARKER_BORDER_COLOR, MARKER_COLOR, MARKER_ICON_PX, SPAWN_ICON, SPAWN_ICON_H, SPAWN_ICON_W, THUMB_CACHE_MAX, THUMB_CELLS, THUMB_MAX_CELLS, THUMB_SCALE, THUMB_STRIP_CELLS,
    areaOf, createThumbnailRequester, thumbKey,
} from './thumbnail';

const spec = (over = {}) => ({ mcVersion: 35, seed: '9007199254740993', dimension: 0, yHeight: 256, markers: [], ...over });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const VILLAGE = 5;
const HUT = 3;
// The marker draws: every drawImage after the first (the biome bitmap), as [icon path, x, y, w, h].
// Each draws the icon's outlined sprite (draw.js outlinedIcon), whose last draw is the icon itself.
const iconDraws = (ctx) => ctx.callsOf('drawImage').slice(1).map(({ args: [sprite, ...rest] }) => {
    const icon = sprite.getContext('2d').callsOf('drawImage').at(-1).args[0];
    return [new URL(icon.src).pathname, ...rest];
});

let queue;
beforeEach(() => {
    FakeQueueManager.reset();
    queue = new FakeQueueManager('/workers/worker.js', 4);
});

describe('areaOf and thumbKey', () => {
    it('clamp each side to 1..THUMB_MAX_CELLS cells', () => {
        expect(THUMB_MAX_CELLS).toBe(2048);
        for (const n of [0, -5, -Infinity]) {
            expect(areaOf({ widthCells: n, heightCells: n }), String(n)).toMatchObject({ widthX: 1, widthY: 1 });
        }
        expect(areaOf({ widthCells: 99999, heightCells: 2049 })).toMatchObject({ widthX: THUMB_MAX_CELLS, widthY: THUMB_MAX_CELLS });
        expect(areaOf({ widthCells: 1, heightCells: THUMB_MAX_CELLS })).toMatchObject({ widthX: 1, widthY: THUMB_MAX_CELLS });
        expect(areaOf({})).toMatchObject({ widthX: THUMB_CELLS, widthY: THUMB_CELLS });
        expect(areaOf({ widthCells: null })).toMatchObject({ widthX: THUMB_CELLS });
        expect(areaOf({ widthCells: NaN, heightCells: 'x' })).toMatchObject({ widthX: THUMB_CELLS, widthY: THUMB_CELLS });
    });

    it('drop the fraction of a size and round the start the way the map centres a block', () => {
        expect(areaOf({ widthCells: 10.7, heightCells: 2.9 })).toEqual({ startX: -5, startY: -1, widthX: 10, widthY: 2 });
        // Block 6 is cell 1.5: 1.5 − 5 = −3.5 rounds up to −3; an odd width starts half a cell off.
        expect(areaOf({ widthCells: 10, heightCells: 9, centreX: 6, centreZ: 0 })).toEqual({ startX: -3, startY: -4, widthX: 10, widthY: 9 });
        expect(areaOf({ widthCells: 4, heightCells: 4, centreX: -1000, centreZ: 1002 })).toEqual({ startX: -252, startY: 249, widthX: 4, widthY: 4 });
    });

    it('key the clamped, floored area: specs that draw the same thing share a key', () => {
        expect(thumbKey(spec({ widthCells: 0, heightCells: -5 }))).toBe(thumbKey(spec({ widthCells: 1, heightCells: 1 })));
        expect(thumbKey(spec({ widthCells: 99999, heightCells: 10 }))).toBe(thumbKey(spec({ widthCells: THUMB_MAX_CELLS, heightCells: 10 })));
        expect(thumbKey(spec({ widthCells: 10.7, heightCells: 20.2 }))).toBe(thumbKey(spec({ widthCells: 10, heightCells: 20 })));
        expect(thumbKey(spec())).toBe(thumbKey(spec({ widthCells: THUMB_CELLS, heightCells: THUMB_CELLS })));
        expect(thumbKey(spec({ widthCells: 10 }))).not.toBe(thumbKey(spec({ widthCells: 11 })));
        expect(thumbKey(spec({ widthCells: 1, heightCells: 1 }))).toContain(':1x1:');
    });

    it('a clamped spec asks for ceil(height / 64) strips of the clamped size', () => {
        const thumbs = createThumbnailRequester(queue);
        thumbs.request(spec({ widthCells: -5, heightCells: 99999 }), vi.fn());
        const strips = queue.pendingOf('GET_AREA');
        expect(strips).toHaveLength(Math.ceil(THUMB_MAX_CELLS / THUMB_STRIP_CELLS));
        expect(strips.every((r) => r.data.widthX === 1 && r.data.widthY === THUMB_STRIP_CELLS)).toBe(true);
        expect(strips.map((r) => r.data.startY)).toEqual(strips.map((_, i) => -THUMB_MAX_CELLS / 2 + i * THUMB_STRIP_CELLS));

        thumbs.request(spec({ seed: '2', widthCells: 3, heightCells: 0 }), vi.fn());
        expect(queue.pendingOf('GET_AREA').slice(strips.length).map((r) => [r.data.widthX, r.data.widthY])).toEqual([[3, 1]]);

        thumbs.request(spec({ seed: '3', widthCells: 3, heightCells: 130.9 }), vi.fn());
        expect(queue.pendingOf('GET_AREA').slice(strips.length + 1).map((r) => r.data.widthY)).toEqual([64, 64, 2]);
    });
});

describe('createThumbnailRequester', () => {
    it('by default asks for 128×128 cells around the origin, in strips of 64 rows, low and wide, with its own token', () => {
        const thumbs = createThumbnailRequester(queue);
        thumbs.request(spec({ dimension: -1, yHeight: 64 }), vi.fn());
        const strips = queue.pendingOf('GET_AREA');
        expect(THUMB_STRIP_CELLS).toBe(64);
        expect(strips.map((r) => r.data)).toEqual([-64, 0].map((startY) => ({
            mcVersion: 35, seed: '9007199254740993', startX: -64, startY, widthX: 128, widthY: 64, dimension: -1, yHeight: 64,
        })));
        for (const { opts } of strips) {
            expect(opts.priority).toBe('low');
            expect(opts.wide).toBe(true);
            expect(opts.token).toBe(strips[0].opts.token);
        }
        expect(typeof strips[0].opts.token).toBe('symbol');
        thumbs.request(spec({ seed: '2' }), vi.fn());
        expect(queue.pendingOf('GET_AREA')[2].opts.token).toBe(strips[0].opts.token);
    });

    it('answers only once every strip is in, with the strips stacked in order', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        thumbs.request(spec({ widthCells: 10, heightCells: 150 }), onReady);
        const strips = queue.pendingOf('GET_AREA');
        expect(strips.map((r) => [r.data.startY, r.data.widthY])).toEqual([[-75, 64], [-11, 64], [53, 22]]);
        // Each strip's pixels carry its index.
        const fill = (entry) => ({ rgba: new Uint8ClampedArray(entry.data.widthX * entry.data.widthY * 4).fill(strips.indexOf(entry) + 1) });
        strips[2].resolve({ error: null, ...fill(strips[2]) });
        strips[0].resolve({ error: null, ...fill(strips[0]) });
        await flush();
        expect(onReady).not.toHaveBeenCalled();
        queue.resolveAreas(fill);
        await flush();
        const { canvas } = onReady.mock.calls[0][0];
        const source = canvas.getContext('2d').callsOf('drawImage')[0].args[0];
        const data = source.getContext('2d').callsOf('putImageData')[0].args[0].data;
        expect(data).toHaveLength(10 * 150 * 4);
        expect([data[0], data[64 * 10 * 4 - 1], data[64 * 10 * 4], data[128 * 10 * 4], data.at(-1)]).toEqual([1, 1, 2, 3, 3]);
    });

    it('requests the same key once and answers every caller', async () => {
        const thumbs = createThumbnailRequester(queue);
        const a = vi.fn();
        const b = vi.fn();
        thumbs.request(spec(), a);
        thumbs.request(spec(), b);
        expect(queue.pendingOf('GET_AREA')).toHaveLength(2);
        queue.resolveAreas();
        await flush();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b.mock.calls[0][0].canvas).toBe(a.mock.calls[0][0].canvas);
        expect(a.mock.calls[0][0].key).toBe(thumbKey(spec()));
        // Cached: answered at once, nothing asked.
        const c = vi.fn();
        thumbs.request(spec(), c);
        expect(c).toHaveBeenCalledWith({ canvas: a.mock.calls[0][0].canvas, key: thumbKey(spec()) });
        expect(queue.requests).toHaveLength(2);
    });

    it('draws the area at 1 px per cell like the map at zoom 1, and marks the structures inside it with their map icons', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        const markers = [{ type: VILLAGE, x: 100, z: -60 }, { type: HUT, x: -256, z: 0 }, { type: VILLAGE, x: 256, z: 0 }, { type: HUT, x: 0, z: -300 }];
        thumbs.request(spec({ markers }), onReady);
        queue.resolveAreas();
        await flush();
        const { canvas } = onReady.mock.calls[0][0];
        expect(THUMB_SCALE).toBe(1);
        expect([canvas.width, canvas.height]).toEqual([128, 128]);
        const ctx = canvas.getContext('2d');
        expect(ctx.imageSmoothingEnabled).toBe(false);
        const [draw] = ctx.callsOf('drawImage');
        expect(draw.args.slice(1)).toEqual([0, 0, 128, 128]);
        // The source is the 128-cell bitmap holding the strips' pixels.
        const source = draw.args[0];
        expect([source.width, source.height]).toEqual([128, 128]);
        const [put] = source.getContext('2d').callsOf('putImageData');
        expect(put.args[0].data).toHaveLength(THUMB_CELLS * THUMB_CELLS * 4);
        // (64 + x/4, 64 + z/4): the icon centred there at the map's 30 px, in its 2 px
        // outline; x = 256 and z = -300 fall outside.
        expect(MARKER_ICON_PX).toBe(30);
        expect(iconDraws(ctx)).toEqual([
            ['/img/village.png', 72, 32, 34, 34],
            ['/img/hut.png', -17, 47, 34, 34],
        ]);
        expect(ctx.callsOf('fillRect')).toEqual([]);
    });

    it('a structure without an icon, or whose icon fails to load, gets the framed accent square', async () => {
        const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function decode() {
            return this.src.endsWith('/img/igloo.png') ? Promise.reject(new Error('404')) : Promise.resolve();
        });
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        thumbs.request(spec({ markers: [{ type: 9999, x: 100, z: -60 }, { type: 4, x: -256, z: 0 }] }), onReady);
        queue.resolveAreas();
        await flush();
        decode.mockRestore();
        const ctx = onReady.mock.calls[0][0].canvas.getContext('2d');
        expect(iconDraws(ctx)).toEqual([]);
        // An 8 px black frame, then the 6 px accent square, centred on the structure.
        expect(ctx.callsOf('fillRect').map((c) => c.args)).toEqual([
            [85, 45, 8, 8], [86, 46, 6, 6],
            [-4, 60, 8, 8], [-3, 61, 6, 6],
        ]);
        expect(ctx.fillStyle).toBe(MARKER_COLOR);
        expect(MARKER_BORDER_COLOR).toBe('#000');
    });

    it('marks the spawn with the map\'s house icon, under the structures, and only inside the area', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        thumbs.request(spec({ markers: [{ type: VILLAGE, x: 100, z: -60 }], spawn: { x: -32, z: 80 } }), onReady);
        queue.resolveAreas();
        await flush();
        // (64 - 8, 64 + 20): the 32 × 30 house centred there, in its 2 px outline, drawn first.
        expect([SPAWN_ICON, SPAWN_ICON_W, SPAWN_ICON_H]).toEqual(['/img/spawn.png', 32, 30]);
        expect(iconDraws(onReady.mock.calls[0][0].canvas.getContext('2d'))).toEqual([
            ['/img/spawn.png', 38, 67, 36, 34],
            ['/img/village.png', 72, 32, 34, 34],
        ]);
        const outside = vi.fn();
        thumbs.request(spec({ spawn: { x: 600, z: 0 } }), outside);
        queue.resolveAreas();
        await flush();
        expect(iconDraws(outside.mock.calls[0][0].canvas.getContext('2d'))).toEqual([]);
    });

    it('the spawn is part of the key: a thumbnail without it is another one', () => {
        expect(thumbKey(spec({ spawn: { x: -32, z: 80 } }))).not.toBe(thumbKey(spec()));
        expect(thumbKey(spec({ spawn: null }))).toBe(thumbKey(spec()));
    });

    it('another structure type at the same place is another thumbnail', () => {
        const at = (type) => thumbKey(spec({ markers: [{ type, x: 100, z: -60 }] }));
        expect(at(VILLAGE)).not.toBe(at(HUT));
    });

    it('draws the size it is asked for: widthCells × heightCells centred on the origin, 1 px each', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        const sized = spec({ widthCells: 453, heightCells: 160, markers: [{ type: VILLAGE, x: 100, z: -60 }, { type: VILLAGE, x: 1000, z: 0 }] });
        thumbs.request(sized, onReady);
        expect(queue.pendingOf('GET_AREA').map((r) => r.data)).toEqual([
            expect.objectContaining({ startX: -226, startY: -80, widthX: 453, widthY: 64 }),
            expect.objectContaining({ startX: -226, startY: -16, widthX: 453, widthY: 64 }),
            expect.objectContaining({ startX: -226, startY: 48, widthX: 453, widthY: 32 }),
        ]);
        queue.resolveAreas();
        await flush();
        const { canvas, key } = onReady.mock.calls[0][0];
        expect([canvas.width, canvas.height]).toEqual([453, 160]);
        const ctx = canvas.getContext('2d');
        expect(ctx.callsOf('drawImage')[0].args.slice(1)).toEqual([0, 0, 453, 160]);
        // Block 100 is cell 25, 226 cells from the left edge -> pixel 251; x = 1000 is outside.
        expect(iconDraws(ctx)).toEqual([['/img/village.png', 234, 48, 34, 34]]);
        // Another size is another thumbnail.
        expect(key).not.toBe(thumbKey({ ...sized, widthCells: 179 }));
    });

    it('centres the area on centreX / centreZ (blocks), the way the map centres panTo\'s block', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        const centred = spec({ widthCells: 100, heightCells: 50, centreX: 1000, centreZ: -500, markers: [{ type: VILLAGE, x: 1000, z: -500 }] });
        thumbs.request(centred, onReady);
        const [entry] = queue.pendingOf('GET_AREA');
        // Block 1000 is cell 250, 50 cells from the left edge; block -500 is cell -125, 25 from the top.
        expect(entry.data).toMatchObject({ startX: 200, startY: -150, widthX: 100, widthY: 50 });
        queue.resolveRequest('GET_AREA', { ids: new Int32Array(100 * 50), rgba: new Uint8ClampedArray(100 * 50 * 4) });
        await flush();
        const { canvas, key } = onReady.mock.calls[0][0];
        // The centre block's marker sits at the canvas' centre.
        expect(iconDraws(canvas.getContext('2d'))).toEqual([['/img/village.png', 33, 8, 34, 34]]);
        // Another centre is another thumbnail.
        expect(key).not.toBe(thumbKey({ ...centred, centreX: 0, centreZ: 0 }));
    });

    it('an engine error in any strip or a failure leaves the placeholder; a cancellation is silent', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        const ofSeed = (seed) => queue.pendingOf('GET_AREA').filter((r) => r.data.seed === seed);
        thumbs.request(spec({ seed: '1' }), onReady);
        thumbs.request(spec({ seed: '2' }), onReady);
        const [first, second] = ofSeed('1');
        first.resolve({ error: null, ids: new Int32Array(128 * 64), rgba: new Uint8ClampedArray(128 * 64 * 4) });
        second.resolve({ error: { code: -1, message: 'bad' } });
        ofSeed('2')[0].reject(new Error('worker crashed'));
        await flush();
        expect(onReady).not.toHaveBeenCalled();
        expect(thumbs.size).toBe(0);
        // Neither is wanted any more: asking again posts fresh strips.
        thumbs.request(spec({ seed: '1' }), onReady);
        expect(ofSeed('1')).toHaveLength(2);
    });

    it(`keeps at most ${THUMB_CACHE_MAX} canvases, evicting the oldest`, async () => {
        const thumbs = createThumbnailRequester(queue);
        for (let i = 0; i <= THUMB_CACHE_MAX; i++) {
            thumbs.request(spec({ seed: String(i) }), vi.fn());
            queue.resolveAreas();
        }
        await flush();
        expect(thumbs.size).toBe(THUMB_CACHE_MAX);
        const before = queue.requests.length;
        thumbs.request(spec({ seed: String(THUMB_CACHE_MAX) }), vi.fn());   // newest: cached
        expect(queue.requests).toHaveLength(before);
        thumbs.request(spec({ seed: '0' }), vi.fn());                        // oldest: evicted
        expect(queue.requests).toHaveLength(before + 2);
    });

    it('a pool reset asks again for the keys still wanted, and only those', async () => {
        const thumbs = createThumbnailRequester(queue);
        const done = vi.fn();
        const waiting = vi.fn();
        thumbs.request(spec({ seed: '1' }), done);
        queue.resolveAreas();
        thumbs.request(spec({ seed: '2' }), waiting);
        await flush();
        // killAll(): in-flight requests are rejected as 'killed', then the reset listeners run.
        queue.rejectAllRequests('killed');
        for (const fn of queue.resetListeners) fn();
        await flush();
        const again = queue.pendingOf('GET_AREA');
        expect(again.map((r) => r.data.seed)).toEqual(['2', '2']);
        queue.resolveAreas();
        await flush();
        expect(waiting).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('destroy cancels its token and stops listening for resets', async () => {
        const thumbs = createThumbnailRequester(queue);
        const onReady = vi.fn();
        thumbs.request(spec(), onReady);
        const { token } = queue.pendingOf('GET_AREA')[0].opts;
        expect(queue.resetListeners).toHaveLength(1);
        thumbs.destroy();
        expect(queue.cancelToken).toHaveBeenCalledWith(token);
        expect(queue.resetListeners).toHaveLength(0);
        await flush();
        expect(onReady).not.toHaveBeenCalled();
        thumbs.request(spec({ seed: '3' }), onReady);
        expect(queue.pendingOf('GET_AREA')).toHaveLength(0);
    });
});
