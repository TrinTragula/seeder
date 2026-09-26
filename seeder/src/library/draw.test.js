// DrawSeed: the canvas map. jsdom has no real canvas, so drawing goes to the
// RecordingCanvasContext from src/test/setup.js and the tests assert on geometry
// (pan / zoom / tile scheduling / hit testing) and on which overlays get drawn where.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DrawSeed, HIGHLIGHT_PIN, ICON_OUTLINE_PX, STRUCTURE_ICONS, outlinedIcon } from './draw';
import { SlimeOverlay } from './overlays';
import { BIOMES, STRUCTURES_OPTIONS } from '../util/constants';
import { FakeMatchMedia } from '../test/fakes';

const MC = 35, SEED = '777', TILE = 75;
const PLAINS = 1, MUSHROOM = 14;
const W = 300, H = 150;

let canvas, ctx, queue, onclick, ontip;
const newDrawer = () => new DrawSeed(MC, queue, canvas, onclick, ontip, TILE, 1);
const frame = () => vi.advanceTimersByTimeAsync(17);
const tileResult = (fill = PLAINS, first = fill) => {
    const ids = new Int32Array(TILE * TILE).fill(fill);
    ids[0] = first;
    return { rgba: new Uint8ClampedArray(TILE * TILE * 4), ids };
};
// Deliver a tile result for tile (tx, tz) through the queue.draw callback.
const deliver = (tx, tz, result = tileResult()) => {
    const call = queue.draw.mock.calls.find((c) => c[2] === tx * TILE && c[3] === tz * TILE);
    if (!call) throw new Error(`tile ${tx},${tz} was never requested`);
    call[8](result);
};
// `kind` is the pointerType ('mouse', 'touch', 'pen'); left out, it is jsdom's empty string.
const pointer = (type, { id = 1, x, y, t, kind }) => {
    const e = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true });
    if (t !== undefined) Object.defineProperty(e, 'timeStamp', { value: t });
    if (kind !== undefined) Object.defineProperty(e, 'pointerType', { value: kind });
    canvas.dispatchEvent(e);
    return e;
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    queue = {
        draw: vi.fn(), findSpawn: vi.fn(), findStrongholds: vi.fn(), getStructuresInRegions: vi.fn(),
        // The overlays' channel (queue.request / cancelToken): answers stay pending unless a test resolves them.
        request: vi.fn(() => new Promise(() => { })), cancelToken: vi.fn(),
        addResetListener: vi.fn(), removeResetListener: vi.fn(),
        stats: { areaRequests: 3, areaDone: 2 }, workers: [1, 2], COLORS: null,
    };
    onclick = vi.fn();
    ontip = vi.fn();
});
afterEach(() => {
    canvas.remove();
    vi.useRealTimers();
});

describe('construction', () => {
    it('centres world (0,0) in the viewport and starts unzoomed', () => {
        const d = newDrawer();
        expect(d.panX).toBe(W / 2);
        expect(d.panZ).toBe(H / 2);
        expect(d.pixDim).toBe(1);
        expect(d.TILE).toBe(TILE);
        expect(d.seed).toBeNull();
    });
    it('subscribes to pool resets and prepares the canvas for dragging', () => {
        const d = newDrawer();
        expect(queue.addResetListener).toHaveBeenCalledWith(expect.any(Function));
        // The cursor itself is CSS's (MapCanvas.css), keyed on data-dragging.
        expect(canvas.style.cursor).toBe('');
        expect(canvas.dataset.dragging).toBeUndefined();
        expect(canvas.style.touchAction).toBe('none');
    });
    it('exposes itself for tooling only when asked, and lets go of the hook on destroy', () => {
        const quiet = newDrawer();
        expect(window.__seederDrawer).toBeUndefined();
        const d = new DrawSeed(MC, queue, canvas, onclick, ontip, TILE, 1, { exposeGlobal: true });
        expect(window.__seederDrawer).toBe(d);
        quiet.destroy();
        expect(window.__seederDrawer).toBe(d);       // another instance's destroy leaves it alone
        d.destroy();
        expect(window.__seederDrawer).toBeUndefined();
    });
    it('preloads an icon for every structure the UI can show', () => {
        const d = newDrawer();
        for (const { value } of STRUCTURES_OPTIONS) expect(d.icons[value].src).toContain(STRUCTURE_ICONS[value]);
    });
    it('getStats reports cache, queue and palette state', () => {
        const d = newDrawer();
        expect(d.getStats()).toMatchObject({ tilesCached: 0, pending: 0, pixDim: 1, queueAreaRequests: 3, queueAreaDone: 2, workersLoaded: 2, colorsReady: false });
    });
});

describe('tile scheduling', () => {
    it('draws nothing and requests nothing without a seed', async () => {
        const d = newDrawer();
        d.draw();
        await frame();
        expect(ctx.callsOf('clearRect')).toHaveLength(1);
        expect(queue.draw).not.toHaveBeenCalled();
    });

    it('requests every visible missing tile once, centre-out, with content-addressed params', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setDimension(-1);
        d.setYHeight(64);
        d.draw();
        await frame();
        // 300x150 px at 75 px/tile centred on the origin: 5 columns (-2..2) x 3 rows (-1..1)
        expect(queue.draw).toHaveBeenCalledTimes(15);
        const [mc, seed, x, z, w, h, dim, y] = queue.draw.mock.calls[0];
        expect([mc, seed, x, z, w, h, dim, y]).toEqual([MC, SEED, 0, 0, TILE, TILE, -1, 64]);
        const requested = queue.draw.mock.calls.map((c) => [c[2] / TILE, c[3] / TILE]);
        expect(new Set(requested.map(String)).size).toBe(15);
        expect(requested[0]).toEqual([0, 0]);
        const dist = ([tx, tz]) => tx * tx + tz * tz;
        for (let i = 1; i < requested.length; i++) expect(dist(requested[i])).toBeGreaterThanOrEqual(dist(requested[i - 1]));
        expect(d.pending.size).toBe(15);

        d.draw();
        await frame();
        expect(queue.draw).toHaveBeenCalledTimes(15);          // pending tiles are not re-requested
    });

    it('stores a delivered tile, repaints it at its screen rectangle and updates the stats', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0);
        expect(d.tiles.size).toBe(1);
        expect(d.pending.size).toBe(14);
        expect(d.stats.tilesStored).toBe(1);
        await frame();
        const images = ctx.callsOf('drawImage');
        expect(images).toHaveLength(1);
        expect(images[0].args.slice(1)).toEqual([150, 75, 75, 75]);   // tile (0,0) at pan (150,75), 75 px wide
        expect(images[0].args[0].getContext('2d').callsOf('putImageData')).toHaveLength(1);
    });

    it('caches a late result for a previous seed without repainting, and it is not drawn for the new seed', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        d.setSeed('other');
        await frame();
        expect(d.rafId).toBeNull();
        deliver(0, 0);
        expect(d.tiles.size).toBe(1);
        expect(d.rafId).toBeNull();                              // no repaint scheduled for a stale tile
        expect(d.tiles.has(`${MC}-${SEED}-0-320-0-0`)).toBe(true);
    });

    it('keys tiles by version, seed, dimension, height and tile coordinates', () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setMcVersion(20);
        d.setDimension(1);
        d.setYHeight(0);
        expect(d._tileKey(-3, 7)).toBe(`20-${SEED}-1-0--3-7`);
    });

    it('evicts the least recently used tiles above the cache cap', async () => {
        const d = newDrawer();
        for (let i = 0; i < 1500; i++) d.tiles.set(`k${i}`, { canvas: null, ids: null });
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0);
        expect(d.tiles.size).toBe(1500);
        expect(d.tiles.has('k0')).toBe(false);
        expect(d.tiles.has('k1')).toBe(true);
        expect(d.tiles.has(d._tileKey(0, 0))).toBe(true);
    });

    it('re-requests lost tiles after the worker pool is reset', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        expect(queue.draw).toHaveBeenCalledTimes(15);
        const onReset = queue.addResetListener.mock.calls[0][0];
        onReset();
        expect(d.pending.size).toBe(0);
        await frame();
        expect(queue.draw).toHaveBeenCalledTimes(30);
    });

    it('draw(callback) invokes the callback on the next frame', async () => {
        const d = newDrawer();
        const cb = vi.fn();
        d.draw(cb);
        expect(cb).not.toHaveBeenCalled();
        await frame();
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

describe('hit testing', () => {
    it('maps a canvas position to block coordinates and the biome label of the cached tile', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        expect(d._biomeAt(150, 75)).toEqual([0, 0, 'Mushroom Fields']);          // cell (0,0)
        expect(d._biomeAt(151, 75)).toEqual([4, 0, 'Plains']);                    // cell (1,0) = block 4
        expect(d._biomeAt(150 + 74, 75 + 74)).toEqual([296, 296, 'Plains']);      // last cell of the tile
        expect(d._biomeAt(149, 75)).toEqual([null, null, null]);                  // tile (-1,0) not cached
        expect(d.getBiomeAndPos({ clientX: 151, clientY: 75 })).toEqual([4, 0, 'Plains']);
    });

    it('accounts for zoom when hit testing', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        d.zoom();                                                // 2 px per cell, anchored at the centre
        expect(d._biomeAt(150, 75)).toEqual([0, 0, 'Mushroom Fields']);
        expect(d._biomeAt(152, 75)).toEqual([4, 0, 'Plains']);
    });

    it('knows every biome label the UI lists', () => {
        const d = newDrawer();
        for (const { value, label } of BIOMES) expect(d.biomeIdToLabel.get(value)).toBe(label);
    });
});

describe('zoom', () => {
    it('zoom()/dezoom() step the pixel size within 1..5 around the viewport centre', () => {
        const d = newDrawer();
        d.dezoom();
        expect(d.pixDim).toBe(1);
        for (let i = 0; i < 7; i++) d.zoom();
        expect(d.pixDim).toBe(5);
        expect(d.panX).toBe(W / 2);                              // the centre cell stays put
        expect(d.panZ).toBe(H / 2);
    });

    it('keeps the world cell under the anchor fixed', () => {
        const d = newDrawer();
        const cellUnder = (x, y) => [(x - d.panX) / d.pixDim, (y - d.panZ) / d.pixDim];
        const before = cellUnder(200, 100);
        d._setZoom(3, 200, 100);
        expect(d.pixDim).toBe(3);
        expect(cellUnder(200, 100)).toEqual(before);
        expect(d.panX).toBe(200 - before[0] * 3);
    });

    it('wheel zooms about the cursor and prevents page scrolling', () => {
        const d = newDrawer();
        const up = new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 100, cancelable: true });
        canvas.dispatchEvent(up);
        expect(up.defaultPrevented).toBe(true);
        expect(d.pixDim).toBe(2);
        expect(d.panX).toBe(200 - (200 - 150) * 2);
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 200, clientY: 100, cancelable: true }));
        expect(d.pixDim).toBe(1);
    });
});

describe('keyboard / button panning (glide)', () => {
    it('right() glides the map left and comes to rest', async () => {
        const d = newDrawer();
        d.right();
        expect(d.velX).toBe(-14);
        await frame();
        expect(d.panX).toBeLessThan(W / 2);
        await vi.advanceTimersByTimeAsync(3000);
        expect(d.glideRaf).toBeNull();
        expect(d.velX).toBe(0);
        expect(d.panX).toBeCloseTo(W / 2 - 14 / (1 - 0.92), -1);   // geometric series of the impulse
    });
    it('up() moves the view up (pan grows), left()/down() the other way, with the velocity clamped', () => {
        const d = newDrawer();
        d.up();
        expect(d.velZ).toBe(14);
        d.down(); d.down();
        expect(d.velZ).toBe(-14);
        for (let i = 0; i < 10; i++) d.left();
        expect(d.velX).toBe(60);
    });
});

describe('pointer input', () => {
    it('a press without movement is a click that reports the biome under the pointer', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        pointer('pointerdown', { x: 151, y: 76 });
        expect(d.dragging).toBe(true);
        expect(canvas.dataset.dragging).toBe('');
        pointer('pointermove', { x: 152, y: 77 });                // 1.4 px: under the click threshold
        expect(d.panX).toBe(W / 2);
        pointer('pointerup', { x: 152, y: 77 });
        expect(onclick).toHaveBeenCalledWith(8, 8, 'Plains');           // cell (2,2) under the release point
        expect(d.dragging).toBe(false);
        expect(canvas.dataset.dragging).toBeUndefined();
        expect(d.pin, 'a mouse click pins nothing').toBeNull();
    });

    it('a click over an unknown area does not fire onclick', () => {
        const d = newDrawer();
        pointer('pointerdown', { x: 10, y: 10 });
        pointer('pointerup', { x: 10, y: 10 });
        expect(onclick).not.toHaveBeenCalled();
    });

    it('hovering reports the biome under the pointer and where the pointer is, once per change', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        await frame();
        expect(ontip).not.toHaveBeenCalled();                     // nothing to say before a pointer
        pointer('pointermove', { x: 150, y: 75, kind: 'mouse' });
        expect(ontip).toHaveBeenLastCalledWith({
            hover: { x: 0, z: 0, biome: 'Mushroom Fields', id: MUSHROOM, left: 150, top: 75 }, pin: null,
        });
        pointer('pointermove', { x: 150, y: 75, kind: 'mouse' });   // the same spot: nothing new
        await frame();
        expect(ontip).toHaveBeenCalledTimes(1);
        pointer('pointermove', { x: 160, y: 80, kind: 'pen' });
        expect(ontip).toHaveBeenLastCalledWith({ hover: { x: 40, z: 20, biome: 'Plains', id: PLAINS, left: 160, top: 80 }, pin: null });
        pointer('pointerleave', { x: 0, y: 0 });
        expect(d.lastPointer).toBeNull();
        expect(ontip).toHaveBeenLastCalledWith({ hover: null, pin: null });
    });

    it('the mouse\'s tip hides over tiles not loaded yet and while dragging, and follows zoom and new tiles', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        pointer('pointermove', { x: 150, y: 75, kind: 'mouse' });
        expect(ontip).not.toHaveBeenCalled();                     // tile (0,0) is not in yet
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        await frame();                                            // the repaint tells the still pointer
        expect(ontip).toHaveBeenLastCalledWith({ hover: expect.objectContaining({ biome: 'Mushroom Fields' }), pin: null });
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 151, clientY: 75, cancelable: true }));
        await frame();                                            // 2 px per cell: (151, 75) is still cell (0, 0)
        expect(ontip.mock.lastCall[0].hover).toMatchObject({ x: 0, z: 0, left: 150, top: 75 });
        pointer('pointerdown', { x: 150, y: 75, kind: 'mouse', t: 1000 });
        pointer('pointermove', { x: 190, y: 95, kind: 'mouse', t: 1016 });
        expect(ontip).toHaveBeenLastCalledWith({ hover: null, pin: null });
        pointer('pointerup', { x: 190, y: 95, kind: 'mouse', t: 5000 });
        expect(ontip.mock.lastCall[0].hover).toMatchObject({ x: 0, z: 0, left: 190, top: 95 });   // the cell moved with the pointer
    });

    it('a finger never hovers: its move pans, and its tap pins the place it tapped', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        await frame();
        pointer('pointerdown', { x: 160, y: 80, kind: 'touch' });
        pointer('pointerup', { x: 160, y: 80, kind: 'touch' });   // a tap with no move in between
        expect(ontip).toHaveBeenLastCalledWith({ hover: null, pin: { x: 40, z: 20, biome: 'Plains', id: PLAINS, left: 160, top: 80 } });
        expect(onclick).toHaveBeenCalledWith(40, 20, 'Plains');
        // Another tap moves it.
        pointer('pointerdown', { x: 150, y: 75, kind: 'touch' });
        pointer('pointerup', { x: 150, y: 75, kind: 'touch' });
        expect(ontip.mock.lastCall[0].pin).toMatchObject({ biome: 'Mushroom Fields', left: 150, top: 75 });
    });

    it('the pin rides along with pans and zooms, hides off the canvas, and goes with clearPin() or a new world', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        await frame();
        pointer('pointerdown', { x: 160.5, y: 80.5, kind: 'touch' });
        pointer('pointerup', { x: 160.5, y: 80.5, kind: 'touch' });
        // A drag that starts elsewhere: the pin moves by the drag, and the swipe itself pins nothing.
        pointer('pointerdown', { x: 100, y: 50, kind: 'touch', t: 1000 });
        pointer('pointermove', { x: 130, y: 60, kind: 'touch', t: 1016 });
        await frame();
        expect(ontip.mock.lastCall[0].pin).toMatchObject({ x: 40, z: 20, left: 190.5, top: 90.5 });
        pointer('pointerup', { x: 130, y: 60, kind: 'touch', t: 5000 });
        expect(ontip.mock.lastCall[0].pin).toMatchObject({ left: 190.5, top: 90.5 });
        // Zoomed about the centre: the tapped point, not its cell's corner, stays under the pin.
        d.zoom();
        await frame();
        expect(ontip.mock.lastCall[0].pin).toMatchObject({ x: 40, z: 20, left: 150 + (190.5 - 150) * 2, top: 75 + (90.5 - 75) * 2 });
        d.panX += 1000;
        d._markDirty();
        await frame();
        expect(ontip).toHaveBeenLastCalledWith({ hover: null, pin: null });
        d.panX -= 1000;
        d._markDirty();
        await frame();
        expect(ontip.mock.lastCall[0].pin).toMatchObject({ x: 40, z: 20 });
        d.clearPin();
        expect(ontip).toHaveBeenLastCalledWith({ hover: null, pin: null });
        expect(d.pin).toBeNull();
        pointer('pointerdown', { x: 250, y: 120, kind: 'touch' });   // still over tile (0,0), zoomed and panned
        pointer('pointerup', { x: 250, y: 120, kind: 'touch' });
        expect(d.pin).not.toBeNull();
        d.clear();
        expect(d.pin).toBeNull();
    });

    it('no pin from a tap over an unloaded tile, a pinch, or a mouse click', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        pointer('pointerdown', { x: 160, y: 80, kind: 'touch' });
        pointer('pointerup', { x: 160, y: 80, kind: 'touch' });
        expect(d.pin).toBeNull();                                 // tile (0,0) is not in yet
        deliver(0, 0);
        pointer('pointerdown', { id: 1, x: 140, y: 75, kind: 'touch' });
        pointer('pointerdown', { id: 2, x: 160, y: 75, kind: 'touch' });
        pointer('pointerup', { id: 2, x: 160, y: 75, kind: 'touch' });
        pointer('pointerup', { id: 1, x: 140, y: 75, kind: 'touch' });
        expect(d.pin).toBeNull();
        pointer('pointerdown', { x: 160, y: 80, kind: 'mouse' });
        pointer('pointerup', { x: 160, y: 80, kind: 'mouse' });
        expect(d.pin).toBeNull();
        expect(ontip).not.toHaveBeenCalledWith(expect.objectContaining({ pin: expect.anything() }));
    });

    it('tells the page once, the first time the user moves the map, and never for a tap or a panTo', async () => {
        const moves = () => {
            const onUserMove = vi.fn();
            return [new DrawSeed(MC, queue, canvas, onclick, ontip, TILE, 1, { onUserMove }), onUserMove];
        };
        let [d, onUserMove] = moves();
        pointer('pointerdown', { x: 100, y: 50, kind: 'touch' });
        pointer('pointermove', { x: 102, y: 51, kind: 'touch' });   // under the click threshold: a tap
        pointer('pointerup', { x: 102, y: 51, kind: 'touch' });
        d.panTo(400, 400, { animate: false });
        pointer('pointermove', { x: 120, y: 60, kind: 'mouse' });   // hovering is not moving
        expect(onUserMove).not.toHaveBeenCalled();
        pointer('pointerdown', { x: 100, y: 50, kind: 'mouse' });
        pointer('pointermove', { x: 130, y: 60, kind: 'mouse' });
        pointer('pointermove', { x: 160, y: 70, kind: 'mouse' });
        pointer('pointerup', { x: 160, y: 70, kind: 'mouse' });
        expect(onUserMove).toHaveBeenCalledTimes(1);
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 50, cancelable: true }));
        expect(onUserMove).toHaveBeenCalledTimes(1);
        d.destroy();
        // Each other way of moving counts on its own.
        const ways = [
            () => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 50, cancelable: true })),
            (m) => m.right(), (m) => m.up(), (m) => m.zoom(), (m) => m.dezoom(),
            () => {
                pointer('pointerdown', { id: 1, x: 140, y: 75, kind: 'touch' });
                pointer('pointerdown', { id: 2, x: 160, y: 75, kind: 'touch' });
                pointer('pointermove', { id: 2, x: 160, y: 75, kind: 'touch' });
                pointer('pointermove', { id: 2, x: 200, y: 75, kind: 'touch' });
            },
        ];
        for (const way of ways) {
            [d, onUserMove] = moves();
            way(d);
            expect(onUserMove).toHaveBeenCalledTimes(1);
            d.destroy();
        }
    });

    it('a pinned place shows the biome of the Y layer on screen once its tile is in', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0);
        await frame();
        pointer('pointerdown', { x: 160, y: 80, kind: 'touch' });
        pointer('pointerup', { x: 160, y: 80, kind: 'touch' });
        expect(ontip.mock.lastCall[0].pin.biome).toBe('Plains');
        d.setYHeight(0);
        d.draw();
        await frame();
        expect(ontip.mock.lastCall[0].pin.biome, 'kept until the new layer is in').toBe('Plains');
        const layer = queue.draw.mock.calls.findLast((c) => c[2] === 0 && c[3] === 0);
        expect(layer[7]).toBe(0);
        layer[8](tileResult(MUSHROOM));
        await frame();
        expect(ontip.mock.lastCall[0].pin).toMatchObject({ x: 40, z: 20, biome: 'Mushroom Fields', id: MUSHROOM });
    });

    it('dragging pans the map by the pointer delta and does not click', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0);
        pointer('pointerdown', { x: 100, y: 50, t: 1000 });
        pointer('pointermove', { x: 130, y: 60, t: 1016 });
        expect(d.moved).toBe(true);
        expect(d.panX).toBe(W / 2 + 30);
        expect(d.panZ).toBe(H / 2 + 10);
        pointer('pointerup', { x: 130, y: 60, t: 1032 });
        expect(onclick).not.toHaveBeenCalled();
        expect(d.dragging).toBe(false);
    });

    it('releasing a fast drag flicks the map, which keeps gliding and slows down', async () => {
        const d = newDrawer();
        pointer('pointerdown', { x: 100, y: 50, t: 1000 });
        pointer('pointermove', { x: 120, y: 50, t: 1016 });
        pointer('pointermove', { x: 140, y: 50, t: 1032 });
        pointer('pointermove', { x: 160, y: 50, t: 1048 });
        pointer('pointerup', { x: 160, y: 50, t: 1049 });
        expect(d.velX).toBeGreaterThan(0);
        expect(d.glideRaf).not.toBeNull();
        const afterDrag = d.panX;
        await frame();
        expect(d.panX).toBeGreaterThan(afterDrag);
        await vi.advanceTimersByTimeAsync(3000);
        expect(d.glideRaf).toBeNull();
    });

    it('a drag that rests before the release does not flick, however fast it moved', () => {
        const d = newDrawer();
        pointer('pointerdown', { x: 100, y: 50, t: 1000 });
        pointer('pointermove', { x: 120, y: 50, t: 1016 });
        pointer('pointermove', { x: 140, y: 50, t: 1032 });
        pointer('pointermove', { x: 160, y: 50, t: 1048 });
        pointer('pointerup', { x: 160, y: 50, t: 1048 + 81 });        // held still for 81 ms
        expect(d.glideRaf).toBeNull();
        expect(d.velX).toBe(0);
        expect(d.panX).toBe(W / 2 + 60);                               // exactly where the finger left it
        // Released within 80 ms of the last move: still a flick.
        pointer('pointerdown', { x: 100, y: 50, t: 2000 });
        pointer('pointermove', { x: 120, y: 50, t: 2016 });
        pointer('pointermove', { x: 140, y: 50, t: 2032 });
        pointer('pointerup', { x: 140, y: 50, t: 2032 + 80 });
        expect(d.glideRaf).not.toBeNull();
    });

    it('a very slow drag (under 0.05 px/frame) does not flick', () => {
        const d = newDrawer();
        pointer('pointerdown', { x: 100, y: 50, t: 1000 });
        pointer('pointermove', { x: 105, y: 50, t: 6000 });        // 5 px in 5 s
        pointer('pointerup', { x: 105, y: 50, t: 6001 });
        expect(d.glideRaf).toBeNull();
        expect(d.velX).toBe(0);
    });

    it('two fingers pinch-zoom about their midpoint and snap to a whole zoom level on release', () => {
        const d = newDrawer();
        pointer('pointerdown', { id: 1, x: 100, y: 75 });
        pointer('pointerdown', { id: 2, x: 200, y: 75 });
        expect(d.pinching).toBe(true);
        expect(d.dragging).toBe(false);
        pointer('pointermove', { id: 2, x: 200, y: 75 });         // seeds the baseline (distance 100)
        pointer('pointermove', { id: 2, x: 300, y: 75 });         // distance 200 -> x2
        expect(d.pixDim).toBeCloseTo(2);
        pointer('pointerup', { id: 2, x: 300, y: 75 });
        expect(d.pinching).toBe(false);
        expect(d.pixDim).toBe(2);
        expect(d.dragging).toBe(true);                             // remaining finger continues as a drag
        pointer('pointerup', { id: 1, x: 100, y: 75 });
        expect(d.dragging).toBe(false);
        expect(onclick).not.toHaveBeenCalled();
    });

    it('pinch zoom is clamped to the 1..5 range', () => {
        const d = newDrawer();
        pointer('pointerdown', { id: 1, x: 140, y: 75 });
        pointer('pointerdown', { id: 2, x: 160, y: 75 });
        pointer('pointermove', { id: 2, x: 160, y: 75 });
        pointer('pointermove', { id: 2, x: 300, y: 75 });         // x8
        expect(d.pixDim).toBe(5);
        pointer('pointerup', { id: 2, x: 300, y: 75 });
        pointer('pointerup', { id: 1, x: 140, y: 75 });
        expect(d.pixDim).toBe(5);
    });
});

describe('overlays', () => {
    const shown = (d) => ({
        icons: ctx.callsOf('drawImage').filter((c) => c.args[0] === d.spawnIcon || c.args[0] === d.eyeIcon || Object.values(d.icons).includes(c.args[0])),
        labels: ctx.callsOf('fillText').map((c) => c.args[0]),
    });

    it('findSpawn asks the pool once, then remembers and draws the spawn with its coordinates', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        const cb = vi.fn();
        d.findSpawn(cb);
        expect(queue.findSpawn).toHaveBeenCalledWith(MC, SEED, expect.any(Function), undefined);
        queue.findSpawn.mock.calls[0][2](8, -24);
        expect(cb).toHaveBeenCalledWith(SEED, 8, -24);
        d.findSpawn(cb);
        expect(queue.findSpawn).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledTimes(2);

        d.spawnIcon = { complete: true };
        await frame();
        const { icons, labels } = shown(d);
        expect(icons).toHaveLength(1);
        expect(icons[0].args.slice(1)).toEqual([150 + 2 - 16, 75 - 6 - 15, 32, 30]);   // block (8,-24) = cell (2,-6)
        expect(labels).toEqual(['(8, -24)']);
    });

    it('findSpawn hands onError to the pool: a failed lookup stores and draws no spawn', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        const cb = vi.fn();
        const onError = vi.fn();
        d.findSpawn(cb, onError);
        expect(queue.findSpawn.mock.calls[0][3]).toBe(onError);
        onError({ code: 'WORKER_CRASH', message: 'crashed' });
        expect(cb).not.toHaveBeenCalled();
        expect(d.spawnX).toBeNull();
        d.spawnIcon = { complete: true };
        await frame();
        expect(shown(d).icons).toHaveLength(0);
    });

    it('hides coordinate labels when structure coords are switched off, and outlines the icon instead', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.findSpawn();
        queue.findSpawn.mock.calls[0][2](0, 0);
        d.spawnIcon = { complete: true };
        d.setShowStructureCoords(false);
        await frame();
        expect(ctx.callsOf('fillText')).toHaveLength(0);
        const sprite = outlinedIcon(d.spawnIcon, 32, 30);
        expect(ctx.callsOf('drawImage').filter((c) => c.args[0] === sprite).map((c) => c.args.slice(1)))
            .toEqual([[150 - 16 - 2, 75 - 15 - 2, 36, 34]]);
    });

    it('does not draw the spawn or strongholds outside the Overworld or outside the viewport', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.findSpawn();
        queue.findSpawn.mock.calls[0][2](0, 0);
        d.findStrongholds();
        queue.findStrongholds.mock.calls[0][3]({ coords: [[0, 0], [100000, 100000]] });
        d.spawnIcon = { complete: true };
        d.eyeIcon = { complete: true };
        await frame();
        expect(shown(d).icons).toHaveLength(2);                    // spawn + the one stronghold on screen
        d.setDimension(-1);
        d.draw();
        await frame();
        expect(ctx.callsOf('drawImage').filter((c) => c.args[0] === d.spawnIcon || c.args[0] === d.eyeIcon)).toHaveLength(2);   // unchanged: nothing new drawn
    });

    it('findStrongholds asks for 150 strongholds once and caches them', () => {
        const d = newDrawer();
        d.setSeed(SEED);
        const cb = vi.fn();
        d.findStrongholds(cb);
        expect(queue.findStrongholds).toHaveBeenCalledWith(MC, SEED, 150, expect.any(Function));
        queue.findStrongholds.mock.calls[0][3]({ coords: [[1, 2]] });
        expect(cb).toHaveBeenCalledWith(SEED, [[1, 2]]);
        d.findStrongholds(cb);
        expect(queue.findStrongholds).toHaveBeenCalledTimes(1);
    });

    it('findStructure scans 50 regions in the current dimension, then draws the icons of shown structures only', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setDimension(-1);
        const cb = vi.fn();
        d.findStructure(18, cb);
        expect(queue.getStructuresInRegions).toHaveBeenCalledWith(MC, 18, SEED, 50, -1, expect.any(Function));
        queue.getStructuresInRegions.mock.calls[0][5]({ coords: [[40, 40]] });
        expect(cb).toHaveBeenCalledWith(SEED, [[40, 40]]);
        expect(d.structuresShown[18]).toBe(true);
        d.icons[18] = { complete: true };
        await frame();
        expect(shown(d).icons.map((c) => c.args.slice(1))).toEqual([[150 + 10 - 15, 75 + 10 - 15, 30, 30]]);
        expect(shown(d).labels).toEqual(['(40, 40)']);

        d.setStructuresShown([]);                                 // hide it again: nothing new drawn
        await frame();
        expect(shown(d).icons).toHaveLength(1);
        d.findStructure(18, cb);                                  // cached: no second scan
        expect(queue.getStructuresInRegions).toHaveBeenCalledTimes(1);
        expect(d.structuresShown[18]).toBe(true);
    });

    it('without coordinate labels an icon is drawn in its black outline, 2 px larger on every side', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setDimension(-1);
        d.setShowStructureCoords(false);
        d.findStructure(18);
        queue.getStructuresInRegions.mock.calls[0][5]({ coords: [[40, 40]] });
        d.icons[18] = { complete: true };
        await frame();
        expect(shown(d).icons).toEqual([]);
        expect(shown(d).labels).toEqual([]);
        const sprite = outlinedIcon(d.icons[18], 30, 30);
        const draws = ctx.callsOf('drawImage').filter((c) => c.args[0] === sprite);
        expect(ICON_OUTLINE_PX).toBe(2);
        expect(draws.map((c) => c.args.slice(1))).toEqual([[150 + 10 - 17, 75 + 10 - 17, 34, 34]]);
    });

    it('outlinedIcon: the icon over its own shape in black, shifted 0..4 px each way; built once per icon', () => {
        const icon = { complete: true };
        const sprite = outlinedIcon(icon, 30, 30);
        expect([sprite.width, sprite.height]).toEqual([34, 34]);
        const sctx = sprite.getContext('2d');
        const draws = sctx.callsOf('drawImage').map((c) => c.args);
        expect(draws).toHaveLength(26);
        expect(draws.every((a) => a[0] === icon && a[3] === 30 && a[4] === 30)).toBe(true);
        // 25 shifted copies, blackened by source-in, then the icon itself in the middle.
        expect(draws.slice(0, 25).map((a) => [a[1], a[2]])).toContainEqual([4, 4]);
        expect(sctx.callsOf('fillRect').map((c) => c.args)).toEqual([[0, 0, 34, 34]]);
        expect(draws[25].slice(1)).toEqual([2, 2, 30, 30]);
        expect(outlinedIcon(icon, 30, 30)).toBe(sprite);
    });

    it('setStructuresShown replaces the set of visible structure types', () => {
        const d = newDrawer();
        d.setStructuresShown([5, 9]);
        expect(d.structuresShown).toEqual({ 5: true, 9: true });
        d.setStructuresShown([9]);
        expect(d.structuresShown).toEqual({ 9: true });
    });

    it('clear() forgets overlays, recentres and stops any glide', () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.findSpawn();
        queue.findSpawn.mock.calls[0][2](8, 8);
        d.right();
        d.panX = 999;
        d.clear();
        expect(d.spawnX).toBeNull();
        expect(d.spawnShown).toBe(false);
        expect(d.strongholds).toBeNull();
        expect(d.structures).toEqual({});
        expect(d.panX).toBe(W / 2);
        expect(d.velX).toBe(0);
        expect(d.glideRaf).toBeNull();
    });
});

describe('panTo', () => {
    // Where block (x, z) is on screen right now.
    const screenOf = (d, x, z) => [d._blockToScreenX(x), d._blockToScreenZ(z)];

    it('with animate: false puts the block at the canvas centre at once, at zoom 1 and at zoom 3', () => {
        const d = newDrawer();
        d.panTo(400, -200, { animate: false });
        expect(screenOf(d, 400, -200)).toEqual([W / 2, H / 2]);
        expect(d.glideRaf).toBeNull();
        d._setZoom(3, 10, 10);
        d.panTo(-32, 80, { animate: false });
        expect(d.pixDim).toBe(3);
        expect(screenOf(d, -32, 80)).toEqual([W / 2, H / 2]);
        expect(d.panX).toBe(W / 2 - (-32 / 4) * 3);
        expect(d.panZ).toBe(H / 2 - (80 / 4) * 3);
    });

    it('animates monotonically on the glide handle and lands on the block within 400 ms', async () => {
        const d = newDrawer();
        d.panTo(400, -200);
        expect(d.glideRaf).not.toBeNull();
        const xs = [d.panX];
        const zs = [d.panZ];
        let during = 0;
        for (let t = 0; t < 400; t += 17) {
            await frame();
            xs.push(d.panX);
            zs.push(d.panZ);
            if (d.glideRaf != null) during++;
        }
        expect(during).toBeGreaterThan(10);                           // ~300 ms of frames
        for (let i = 1; i < xs.length; i++) {
            expect(xs[i]).toBeLessThanOrEqual(xs[i - 1]);             // x: 150 -> 50
            expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1]);          // z: 75 -> 125
        }
        expect(xs.some((x) => x < W / 2 && x > W / 2 - 100)).toBe(true);   // it went through the middle
        const [sx, sz] = screenOf(d, 400, -200);
        expect(Math.abs(sx - W / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(sz - H / 2)).toBeLessThanOrEqual(1);
        expect(d.glideRaf).toBeNull();
        expect(d.panning).toBe(false);
    });

    it('a pointerdown mid-animation stops it where it is', async () => {
        const d = newDrawer();
        d.panTo(400, -200);
        await frame();
        await frame();
        await frame();
        pointer('pointerdown', { x: 10, y: 10 });
        expect(d.glideRaf).toBeNull();
        const stopped = d.panX;
        expect(stopped).toBeLessThan(W / 2);
        expect(stopped).toBeGreaterThan(W / 2 - 100);
        await vi.advanceTimersByTimeAsync(400);
        expect(d.panX).toBe(stopped);
    });

    it('an arrow press mid-animation takes over with its own glide', async () => {
        const d = newDrawer();
        d.panTo(0, -400);                                              // straight down: panX stays
        await frame();
        await frame();
        d.right();
        expect(d.panning).toBe(false);
        expect(d.velX).toBe(-14);
        await vi.advanceTimersByTimeAsync(3000);
        expect(d.glideRaf).toBeNull();
        expect(d.panX).toBeLessThan(W / 2 - 100);                     // the arrow's glide ran
        expect(d.panZ).toBeLessThan(H / 2 + 100);                     // panTo never finished
    });

    it('is instant when the user prefers reduced motion', () => {
        FakeMatchMedia.set('(prefers-reduced-motion: reduce)', true);
        const d = newDrawer();
        d.panTo(400, -200);
        expect(d.glideRaf).toBeNull();
        expect(screenOf(d, 400, -200)).toEqual([W / 2, H / 2]);
    });

    it('clear() and destroy() cancel a running animation', async () => {
        const d = newDrawer();
        d.panTo(400, -200);
        await frame();
        d.clear();
        expect(d.glideRaf).toBeNull();
        expect(d.panX).toBe(W / 2);
        await vi.advanceTimersByTimeAsync(400);
        expect(d.panX).toBe(W / 2);
        d.panTo(400, -200);
        d.destroy();
        expect(d.glideRaf).toBeNull();
    });
});

describe('highlight', () => {
    // The pin's calls: its shadow (ellipse) and its pixels (every fillRect but the label's box).
    const LABEL_BOX = '#ffffffbb';
    const shadows = () => ctx.callsOf('ellipse').map((c) => c.args.slice(0, 4));
    const pinRects = () => ctx.callsOf('fillRect').filter((c) => c.fillStyle !== LABEL_BOX);
    // The screen box every pin pixel falls in: [left, top, right, bottom].
    const pinBox = () => {
        const rects = pinRects().map((c) => c.args);
        return [
            Math.min(...rects.map(([x]) => x)), Math.min(...rects.map(([, z]) => z)),
            Math.max(...rects.map(([x, , w]) => x + w)), Math.max(...rects.map(([, z, , h]) => z + h)),
        ];
    };
    const PIN = HIGHLIGHT_PIN.size * HIGHLIGHT_PIN.scale;              // 32 screen px tall
    const SIDE = 7 * HIGHLIGHT_PIN.scale;                             // 14 px each side: the head is 14 pixels wide
    // A drawer with a seed (nothing renders without one) and a highlight at block (40, -40) = cell (10, -10).
    const highlighted = (setup = () => { }) => {
        const d = newDrawer();
        d.setSeed(SEED);
        setup(d);
        d.setHighlight({ x: 40, z: -40, label: 'Spawn' });
        return d;
    };

    it('draws an accent pin whose tip is on the block, over a shadow, and its label above it, even with coordinate labels off, in the Nether too', async () => {
        const d = highlighted((d) => { d.setDimension(-1); d.setShowStructureCoords(false); });
        expect(d.highlight).toEqual({ x: 40, z: -40, label: 'Spawn' });
        await frame();
        // The block is at screen (160, 65): the pin stands on it, centred.
        expect(shadows()).toEqual([[160, 65, 7, 3]]);
        expect(pinBox()).toEqual([160 - SIDE, 65 - PIN, 160 + SIDE, 65]);
        // Its tip: the bottom row is the 2-pixel black point, centred on the block.
        const tip = pinRects().filter((c) => c.args[1] + c.args[3] === 65);
        expect(tip.map((c) => [c.args, c.fillStyle])).toEqual([[[158, 63, 4, 2], '#000']]);
        // Outline, accent body, white eye.
        expect(new Set(pinRects().map((c) => c.fillStyle))).toEqual(new Set(['#000', '#ff8c00', '#fff']));
        // Whole-pixel rects, scaled: crisp.
        for (const { args } of pinRects()) for (const v of args) expect(Number.isInteger(v)).toBe(true);
        expect(ctx.callsOf('fill').map((c) => c.fillStyle)).toEqual(['rgba(0, 0, 0, 0.35)']);
        const labels = ctx.callsOf('fillText');
        expect(labels.map((c) => c.args[0])).toEqual(['Spawn']);
        // The label and its box sit wholly above the pin's head: the point stays visible.
        const box = ctx.callsOf('fillRect').find((c) => c.fillStyle === LABEL_BOX);
        expect(box.args[1] + box.args[3]).toBeLessThan(65 - PIN);
        expect(labels[0].args[2]).toBeLessThan(65 - PIN);
        expect(labels[0].args[1]).toBe(160);
    });

    it('draws the same pin as public/svg/pin.svg, with the accent body', async () => {
        const { readFileSync } = await import('node:fs');
        // Vitest runs from the app root (seeder/).
        const svg = readFileSync(`${process.cwd()}/public/svg/pin.svg`, 'utf8');
        const pixels = (runs) => {
            const set = new Set();
            for (const [x, y, w, h] of runs) for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) set.add(`${x + i},${y + j}`);
            return set;
        };
        const fromSvg = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map(([, fill, d]) => [
            fill,
            [...d.matchAll(/M(\d+) (\d+)h(-?\d+)v(\d+)/g)].map(([, x, y, w, h]) => [+x, +y, +w, +h]),
        ]);
        const svgColor = { '#000': '#000', '#e53935': '#ff8c00', '#fff': '#fff' };
        expect(HIGHLIGHT_PIN.rects.map(([c, runs]) => [c, pixels(runs)]))
            .toEqual(fromSvg.map(([c, runs]) => [svgColor[c], pixels(runs)]));
    });

    it('is drawn after every icon, so it stays on top', async () => {
        const d = highlighted((d) => {
            d.findSpawn();
            queue.findSpawn.mock.calls[0][2](40, -40);
            d.spawnIcon = { complete: true };
        });
        await frame();
        const names = ctx.calls.map((c) => c.name);
        expect(names.indexOf('drawImage')).toBeGreaterThanOrEqual(0);
        expect(names.lastIndexOf('drawImage')).toBeLessThan(names.indexOf('ellipse'));
        expect(ctx.callsOf('fillText').map((c) => c.args[0])).toEqual(['(40, -40)', 'Spawn']);
    });

    it('follows zoom and pan, and draws nothing while off screen', async () => {
        const d = highlighted();
        d.zoom();                                                      // 2 px per cell about the centre
        await frame();
        expect(shadows()).toEqual([[170, 55, 7, 3]]);
        expect(pinBox()).toEqual([170 - SIDE, 55 - PIN, 170 + SIDE, 55]);
        ctx.reset();
        d.panTo(100000, 0, { animate: false });
        await frame();
        expect(ctx.callsOf('ellipse')).toHaveLength(0);
        expect(pinRects().filter((c) => c.fillStyle === '#ff8c00')).toHaveLength(0);
        expect(ctx.callsOf('fillText')).toHaveLength(0);
    });

    it('snaps a block between screen pixels to whole pixels', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.panTo(1, 1, { animate: false });                             // a quarter cell: fractional pan
        d.panX += 0.4;
        d.setHighlight({ x: 40, z: -40, label: 'Spawn' });
        await frame();
        for (const { args } of pinRects()) for (const v of args) expect(Number.isInteger(v)).toBe(true);
        expect(shadows()).toHaveLength(1);
        for (const v of shadows()[0]) expect(Number.isInteger(v)).toBe(true);
    });

    it('setHighlight(null) removes it', async () => {
        const d = highlighted();
        await frame();
        expect(shadows()).toHaveLength(1);
        ctx.reset();
        d.setHighlight(null);
        expect(d.rafId).not.toBeNull();                                // it repaints
        await frame();
        expect(ctx.callsOf('ellipse')).toHaveLength(0);
        expect(d.highlight).toBeNull();
    });

    it('clear() (a new world) and destroy() drop it', async () => {
        const d = highlighted();
        d.clear();
        expect(d.highlight).toBeNull();
        await frame();
        expect(ctx.callsOf('ellipse')).toHaveLength(0);
        d.setHighlight({ x: 0, z: 0, label: 'Stronghold' });
        d.destroy();
        expect(d.highlight).toBeNull();
    });

    it('does not keep the render loop running: one frame, then idle', async () => {
        const d = highlighted();
        await frame();
        expect(d.rafId).toBeNull();
        const renders = d.stats.renders;
        await vi.advanceTimersByTimeAsync(500);
        expect(d.stats.renders).toBe(renders);
    });
});

describe('map overlays (setOverlay)', () => {
    it('setOverlay("slime", true) creates a slime overlay for the current seed and repaints', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        await frame();
        d.setOverlay('slime', true);
        expect(d.overlays.slime).toBeInstanceOf(SlimeOverlay);
        expect(d.overlays.slime.seed).toBe(SEED);
        expect(d.overlays.slime.queue).toBe(queue);
        expect(d.rafId).not.toBeNull();
        d.setOverlay('slime', true);                                   // already on: the same one
        expect(Object.keys(d.overlays)).toEqual(['slime']);
        d.setOverlay('unknown', true);
        expect(Object.keys(d.overlays)).toEqual(['slime']);
    });

    it('draws each overlay with the view after the tiles (and their requests) and before the icons and the highlight', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0);
        d.findSpawn();
        queue.findSpawn.mock.calls[0][2](40, -40);
        d.spawnIcon = { complete: true };
        d.setHighlight({ x: 40, z: -40, label: 'You' });
        d.setOverlay('slime', true);
        const draw = vi.spyOn(d.overlays.slime, 'draw').mockImplementation(() => ctx._record('overlay', []));
        const requestTile = vi.spyOn(d, '_requestTile').mockImplementation(() => ctx._record('requestTile', []));
        d.pending.clear();                                              // so the 14 missing tiles are asked again
        ctx.reset();
        await frame();
        expect(draw).toHaveBeenCalledTimes(1);
        expect(draw.mock.calls[0][0]).toBe(ctx);
        expect(draw.mock.calls[0][1]).toEqual({ seed: SEED, dimension: 0, panX: W / 2, panZ: H / 2, pixDim: 1, W, H });
        const names = ctx.calls.map((c) => c.name);
        const tile = names.indexOf('drawImage');                       // the one cached tile
        const overlay = names.indexOf('overlay');
        expect(ctx.calls[tile].args[0]).toBe(d.tiles.get(d._tileKey(0, 0)).canvas);
        expect(tile).toBeLessThan(overlay);
        expect(names.lastIndexOf('requestTile')).toBeLessThan(overlay);
        expect(names.lastIndexOf('drawImage')).toBeGreaterThan(overlay);   // the spawn icon, on top
        expect(names.indexOf('ellipse')).toBeGreaterThan(overlay);         // the highlight, on top
        requestTile.mockRestore();
    });

    it('its data comes through queue.request (low priority, its own token) and landing repaints', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setOverlay('slime', true);
        await frame();
        const asked = queue.request.mock.calls.filter(([kind]) => kind === 'SLIME_CHUNKS');
        expect(asked.length).toBeGreaterThan(0);
        for (const [, data, opts] of asked) {
            expect(data).toMatchObject({ seed: SEED, w: 64, h: 64 });
            expect(opts).toEqual({ priority: 'low', token: d.overlays.slime.token });
        }
        expect(d.rafId).toBeNull();
        d.overlays.slime.onReady();
        expect(d.rafId).not.toBeNull();
    });

    it('setOverlay("slime", false) destroys it; clear() keeps it; setSeed() re-targets it', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setOverlay('slime', true);
        const overlay = d.overlays.slime;
        const setSeed = vi.spyOn(overlay, 'setSeed');
        const destroy = vi.spyOn(overlay, 'destroy');
        d.clear();
        expect(d.overlays.slime).toBe(overlay);                        // the toggle outlives a world change
        d.setSeed('42');
        expect(setSeed).toHaveBeenCalledWith('42');
        expect(overlay.seed).toBe('42');
        await frame();
        d.setOverlay('slime', false);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(d.overlays).toEqual({});
        expect(queue.cancelToken).toHaveBeenCalledWith(overlay.token);
        expect(d.rafId).not.toBeNull();                                  // repaints without it
        d.setOverlay('slime', false);                                    // already off: nothing to do
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('draws the chunk grid over the slime squares, whatever order they were switched on in', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setOverlay('chunkGrid', true);
        d.setOverlay('slime', true);
        expect(Object.keys(d.overlays)).toEqual(['chunkGrid', 'slime']);
        vi.spyOn(d.overlays.slime, 'draw').mockImplementation(() => ctx._record('slime', []));
        vi.spyOn(d.overlays.chunkGrid, 'draw').mockImplementation(() => ctx._record('grid', []));
        await frame();
        const names = ctx.calls.map((c) => c.name);
        expect(names.indexOf('slime')).toBeGreaterThanOrEqual(0);
        expect(names.indexOf('slime')).toBeLessThan(names.indexOf('grid'));
        d.setOverlay('chunkGrid', false);
        expect(Object.keys(d.overlays)).toEqual(['slime']);
    });

    it('destroy() destroys every overlay', () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.setOverlay('slime', true);
        const destroy = vi.spyOn(d.overlays.slime, 'destroy');
        d.destroy();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(d.overlays).toEqual({});
    });

    it('paints the slime chunks the pool reported, under the highlight', async () => {
        let answer;
        queue.request.mockImplementation((kind, data) => new Promise((resolve) => {
            if (kind === 'SLIME_CHUNKS' && data.cx0 === 0 && data.cz0 === 0) answer = () => {
                const cells = new Uint8Array(64 * 64);
                cells[0] = 1;                                           // chunk (0, 0)
                resolve({ ...data, cells, error: null });
            };
        }));
        const d = newDrawer();
        d.setSeed(SEED);
        d.setOverlay('slime', true);
        await frame();
        d.setHighlight({ x: 8, z: 8, label: 'Slime chunk' });
        answer();
        await frame();
        const names = ctx.calls.map((c) => c.name);
        const slime = ctx.calls.findIndex((c) => c.name === 'fillRect' && c.args.join() === [150, 75, 4, 4].join());
        expect(slime).toBeGreaterThanOrEqual(0);
        expect(names.lastIndexOf('ellipse')).toBeGreaterThan(slime);
    });
});

describe('destroy', () => {
    it('unsubscribes from the pool, unbinds pointer handlers and drops the cache', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0);
        d.destroy();
        expect(queue.removeResetListener).toHaveBeenCalledWith(queue.addResetListener.mock.calls[0][0]);
        expect(d.tiles.size).toBe(0);
        pointer('pointerdown', { x: 100, y: 50 });
        expect(d.dragging).toBe(false);
    });
});
