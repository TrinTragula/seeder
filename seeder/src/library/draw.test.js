// DrawSeed: the canvas map. jsdom has no real canvas, so drawing goes to the
// RecordingCanvasContext from src/test/setup.js and the tests assert on geometry
// (pan / zoom / tile scheduling / hit testing) and on which overlays get drawn where.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DrawSeed, STRUCTURE_ICONS } from './draw';
import { BIOMES, STRUCTURES_OPTIONS } from '../util/constants';

const MC = 35, SEED = '777', TILE = 75;
const PLAINS = 1, MUSHROOM = 14;
const W = 300, H = 150;

let canvas, ctx, queue, onclick, onmousemove;
const newDrawer = () => new DrawSeed(MC, queue, canvas, onclick, onmousemove, TILE, 1);
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
const pointer = (type, { id = 1, x, y, t }) => {
    const e = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true });
    if (t !== undefined) Object.defineProperty(e, 'timeStamp', { value: t });
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
        addResetListener: vi.fn(), removeResetListener: vi.fn(),
        stats: { areaRequests: 3, areaDone: 2 }, workers: [1, 2], COLORS: null,
    };
    onclick = vi.fn();
    onmousemove = vi.fn();
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
    it('subscribes to pool resets, exposes itself for tooling and prepares the canvas for dragging', () => {
        const d = newDrawer();
        expect(queue.addResetListener).toHaveBeenCalledWith(expect.any(Function));
        expect(window.__seederDrawer).toBe(d);
        expect(canvas.style.cursor).toBe('grab');
        expect(canvas.style.touchAction).toBe('none');
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
        expect(canvas.style.cursor).toBe('grabbing');
        pointer('pointermove', { x: 152, y: 77 });                // 1.4 px: under the click threshold
        expect(d.panX).toBe(W / 2);
        pointer('pointerup', { x: 152, y: 77 });
        expect(onclick).toHaveBeenCalledWith(8, 8, 'Plains');           // cell (2,2) under the release point
        expect(d.dragging).toBe(false);
        expect(canvas.style.cursor).toBe('grab');
    });

    it('a click over an unknown area does not fire onclick', () => {
        const d = newDrawer();
        pointer('pointerdown', { x: 10, y: 10 });
        pointer('pointerup', { x: 10, y: 10 });
        expect(onclick).not.toHaveBeenCalled();
    });

    it('hovering reports the biome under the pointer', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.draw();
        await frame();
        deliver(0, 0, tileResult(PLAINS, MUSHROOM));
        pointer('pointermove', { x: 150, y: 75 });
        expect(onmousemove).toHaveBeenLastCalledWith(0, 0, 'Mushroom Fields');
        pointer('pointerleave', { x: 0, y: 0 });
        expect(d.lastPointer).toBeNull();
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
        expect(queue.findSpawn).toHaveBeenCalledWith(MC, SEED, expect.any(Function));
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

    it('hides coordinate labels when structure coords are switched off', async () => {
        const d = newDrawer();
        d.setSeed(SEED);
        d.findSpawn();
        queue.findSpawn.mock.calls[0][2](0, 0);
        d.spawnIcon = { complete: true };
        d.setShowStructureCoords(false);
        await frame();
        expect(ctx.callsOf('fillText')).toHaveLength(0);
        expect(shown(d).icons).toHaveLength(1);
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
