// MapCanvas: the canvas + DrawSeed lifecycle. The worker pool and the renderer are the
// recording fakes (src/test/fakes.js); ResizeObserver is the fake installed by setup.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapCanvas from './MapCanvas';
import { resetQueueManagerForTests } from './engine';
import { FakeQueueManager, FakeDrawSeed, FakeResizeObserver, FAKE_COLORS } from '../test/fakes';
import { placeTip } from './MapTip';

vi.mock('../library/queue', async () => ({ QueueManager: (await import('../test/fakes')).FakeQueueManager }));
vi.mock('../library/draw', async () => ({ DrawSeed: (await import('../test/fakes')).FakeDrawSeed }));

const drawer = () => FakeDrawSeed.latest();
const flush = () => act(async () => { await Promise.resolve(); });
const names = () => drawer().calls.map((c) => c.name);

// jsdom lays nothing out, so clientWidth/Height are always 0. Give every <div> the
// size the test wants; the map's container is one of them.
const size = { width: 800, height: 600 };
beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    FakeDrawSeed.reset();
    FakeResizeObserver.reset();
    size.width = 800;
    size.height = 600;
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { configurable: true, get: () => size.width });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, get: () => size.height });
    delete window.__seederDrawer;
});
afterEach(() => {
    delete HTMLDivElement.prototype.clientWidth;
    delete HTMLDivElement.prototype.clientHeight;
    delete window.__seederDrawer;
});

const BASE = { mcVersion: 35, seed: '1', dimension: 0, yHeight: 256 };
async function renderMap(props = {}) {
    const utils = render(<MapCanvas {...BASE} {...props} />);
    await flush();
    return {
        ...utils,
        rerender: async (next) => {
            props = { ...props, ...next };
            utils.rerender(<MapCanvas {...BASE} {...props} />);
            await flush();
        },
    };
}

describe('mounting', () => {
    it('creates one renderer on a canvas sized to its container *before* construction, with TILE 75 and pixDim 1', async () => {
        await renderMap();
        expect(FakeDrawSeed.instances).toHaveLength(1);
        const d = drawer();
        expect(d.canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(d.canvas).toBe(screen.getByLabelText('Biome map'));
        expect(d.canvas.width).toBe(800);
        expect(d.canvas.height).toBe(600);
        // The fake centres the origin from the canvas size at construction, like the real class.
        expect(d.panX).toBe(400);
        expect(d.panZ).toBe(300);
        expect(d.drawDim).toBe(75);
        expect(d.pixDim).toBe(1);
        expect(d.onclick).toBeNull();
    });

    it('uses the document\'s single worker pool', async () => {
        await renderMap();
        expect(FakeQueueManager.instances).toHaveLength(1);
        expect(drawer().queue).toBe(FakeQueueManager.latest());
        expect(FakeQueueManager.latest().path).toMatch(/^\/workers\/worker\.js\?v=/);
    });

    it('forwards every prop to the renderer', async () => {
        await renderMap({ mcVersion: 22, seed: '8091867987493326313', dimension: -1, yHeight: 62, structuresToShow: [5], showStructureCoords: false });
        const d = drawer();
        expect(d.setSeed).toHaveBeenLastCalledWith('8091867987493326313');
        expect(d.setMcVersion).toHaveBeenLastCalledWith(22);
        expect(d.setDimension).toHaveBeenLastCalledWith(-1);
        expect(d.setYHeight).toHaveBeenLastCalledWith(62);
        expect(d.setStructuresShown).toHaveBeenLastCalledWith([5]);
        expect(d.setShowStructureCoords).toHaveBeenLastCalledWith(false);
        expect(d.draw).toHaveBeenCalled();
        expect(d.findSpawn).toHaveBeenCalledTimes(1);
        expect(d.findStrongholds).toHaveBeenCalledTimes(1);
        expect(d.findStructure).toHaveBeenCalledWith(5);
    });

    it('publishes window.__seederDrawer only when asked, and withdraws it on unmount', async () => {
        const { unmount } = await renderMap();
        expect(window.__seederDrawer).toBeUndefined();
        unmount();
        const { unmount: unmountExposed } = await renderMap({ exposeGlobal: true });
        expect(window.__seederDrawer).toBe(drawer());
        unmountExposed();
        expect(window.__seederDrawer).toBeUndefined();
    });

    it('destroys the renderer and stops watching the container on unmount', async () => {
        const { unmount } = await renderMap();
        expect(FakeResizeObserver.live()).toHaveLength(1);
        unmount();
        expect(drawer().destroy).toHaveBeenCalledTimes(1);
        expect(FakeResizeObserver.live()).toHaveLength(0);
    });
});

describe('changing the world', () => {
    it('a seed change clears, redraws and looks up spawn, strongholds and every structure on show', async () => {
        const { rerender } = await renderMap({ structuresToShow: [5, 9] });
        drawer().calls.length = 0;
        await rerender({ seed: '2' });
        const seen = names();
        expect(seen.indexOf('clear')).toBeGreaterThanOrEqual(0);
        expect(seen.indexOf('clear')).toBeLessThan(seen.indexOf('draw'));
        expect(seen).toContain('findSpawn');
        expect(seen).toContain('findStrongholds');
        expect(drawer().setSeed).toHaveBeenLastCalledWith('2');
        expect(drawer().callsOf('findStructure').map(([type]) => type)).toEqual([5, 9]);
    });

    it('a version or dimension change is a new world too', async () => {
        const { rerender } = await renderMap();
        drawer().calls.length = 0;                        // the recorded list, not the vi.fn counters
        await rerender({ mcVersion: 22 });
        expect(drawer().callsOf('clear')).toHaveLength(1);
        expect(drawer().setMcVersion).toHaveBeenLastCalledWith(22);
        await rerender({ dimension: 1 });
        expect(drawer().callsOf('clear')).toHaveLength(2);
        expect(drawer().setDimension).toHaveBeenLastCalledWith(1);
    });

    it('a height change repaints without clearing (the pan and the overlays stay)', async () => {
        const { rerender } = await renderMap();
        drawer().calls.length = 0;
        await rerender({ yHeight: 0 });
        expect(drawer().callsOf('clear')).toHaveLength(0);
        expect(drawer().setYHeight).toHaveBeenLastCalledWith(0);
        expect(drawer().callsOf('draw')).toHaveLength(1);
        expect(drawer().callsOf('findSpawn')).toHaveLength(0);
    });

    it('reports busy until the spawn of the *current* seed is known, then hands it to the page', async () => {
        FakeDrawSeed.autoResolve = false;
        const onBusy = vi.fn();
        const onSpawn = vi.fn();
        const { rerender } = await renderMap({ onBusy, onSpawn });
        expect(onBusy).toHaveBeenCalledWith(true);
        expect(onBusy).not.toHaveBeenCalledWith(false);
        act(() => drawer().resolveSpawn(8, -24));
        expect(onBusy).toHaveBeenLastCalledWith(false);
        expect(onSpawn).toHaveBeenCalledWith('1', 8, -24);

        // Two quick changes: the answer for the seed the user already left is dropped.
        onBusy.mockClear();
        onSpawn.mockClear();
        await rerender({ seed: '2' });
        await rerender({ seed: '3' });
        expect(onBusy.mock.calls).toEqual([[true], [true]]);
        act(() => drawer().resolveSpawn(100, 200));
        expect(onBusy).toHaveBeenLastCalledWith(false);
        expect(onBusy.mock.calls.filter(([busy]) => busy === false)).toHaveLength(1);
        expect(onSpawn).toHaveBeenCalledTimes(1);
        expect(onSpawn).toHaveBeenCalledWith('3', 100, 200);
    });

    it('a failed spawn lookup ends busy too, without a spawn; a failure for a seed already left is ignored', async () => {
        FakeDrawSeed.autoResolve = false;
        const onBusy = vi.fn();
        const onSpawn = vi.fn();
        const { rerender } = await renderMap({ onBusy, onSpawn });
        act(() => drawer().failSpawn());
        expect(onBusy).toHaveBeenLastCalledWith(false);
        expect(onSpawn).not.toHaveBeenCalled();

        onBusy.mockClear();
        await rerender({ seed: '2' });
        await rerender({ seed: '3' });
        const [stale] = drawer().pendingSpawn;
        act(() => stale.onError({ code: 'WORKER_CRASH', message: 'crashed' }));
        expect(onBusy).not.toHaveBeenCalledWith(false);
        act(() => drawer().resolveSpawn(100, 200));
        expect(onBusy).toHaveBeenLastCalledWith(false);
        expect(onSpawn).toHaveBeenCalledWith('3', 100, 200);
    });

    it('hands the strongholds to the page', async () => {
        const onStrongholds = vi.fn();
        await renderMap({ onStrongholds });
        expect(onStrongholds).toHaveBeenCalledWith('1', [[1234, -876]]);
    });
});

describe('structures on show', () => {
    it('looks a type up once when it is added and never again for the same world', async () => {
        const { rerender } = await renderMap({ structuresToShow: [5] });
        expect(drawer().callsOf('findStructure').map(([type]) => type)).toEqual([5]);
        await rerender({ structuresToShow: [5, 9] });
        expect(drawer().callsOf('findStructure').map(([type]) => type)).toEqual([5, 9]);
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([5, 9]);
        expect(drawer().clear).toHaveBeenCalledTimes(1);           // not a new world
        await rerender({ structuresToShow: [9] });
        await rerender({ structuresToShow: [9, 5] });
        expect(drawer().callsOf('findStructure').map(([type]) => type)).toEqual([5, 9]);
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([9, 5]);
    });

    it('toggling the coordinate labels reaches the renderer and repaints the overlays', async () => {
        const { rerender } = await renderMap();
        expect(drawer().setShowStructureCoords).toHaveBeenLastCalledWith(true);
        const before = drawer().drawStructures.mock.calls.length;
        await rerender({ showStructureCoords: false });
        expect(drawer().setShowStructureCoords).toHaveBeenLastCalledWith(false);
        expect(drawer().drawStructures.mock.calls.length).toBeGreaterThan(before);
        expect(drawer().findStructure).not.toHaveBeenCalled();
    });
});

describe('hover, buttons, keys, api', () => {
    it('shows the biome under the mouse next to the pointer, with its colour and coordinates, and tells the page', async () => {
        const onHover = vi.fn();
        await renderMap({ onHover });
        // Nothing until the pointer is over a biome: no fixed readout any more.
        expect(screen.queryByText(/^X:/)).toBeNull();
        act(() => drawer().emitTip({ hover: { x: 40, z: -28, biome: 'Plains', id: 1, left: 120, top: 80 } }));
        const name = screen.getByText('Plains');
        expect(screen.getByText((_, el) => el.textContent === 'X: 40, Z: -28')).toBeInTheDocument();
        const tip = name.closest('[style*="translate"]');
        expect(tip).toHaveStyle({ transform: 'translate(120px, 80px)' });
        expect(name.previousElementSibling).toHaveStyle({ backgroundColor: `rgba(${FAKE_COLORS[1].join(', ')})` });
        expect(onHover).toHaveBeenCalledWith(40, -28, 'Plains');
        // The mouse's tip has nothing to click: it never takes the pointer from the map.
        expect(screen.queryByRole('button', { name: 'Close biome info' })).toBeNull();
        act(() => drawer().emitTip({ hover: null }));
        expect(screen.queryByText('Plains')).toBeNull();
    });

    it('a tapped place gets a tip with a close button', async () => {
        await renderMap();
        act(() => drawer().emitTip({ pin: { x: 64, z: -128, biome: 'Cherry Grove', id: 185, left: 300, top: 200 } }));
        expect(screen.getByText('Cherry Grove').closest('[style*="translate"]')).toHaveStyle({ transform: 'translate(300px, 200px)' });
        expect(screen.getByText((_, el) => el.textContent === 'X: 64, Z: -128')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close biome info' }));
        expect(drawer().clearPin).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Cherry Grove')).toBeNull();
        // A mouse over the map while a place is pinned: both tips.
        act(() => drawer().emitTip({
            hover: { x: 0, z: 0, biome: 'Plains', id: 1, left: 10, top: 10 },
            pin: { x: 64, z: -128, biome: 'Cherry Grove', id: 185, left: 300, top: 200 },
        }));
        expect(screen.getByText('Plains')).toBeInTheDocument();
        expect(screen.getByText('Cherry Grove')).toBeInTheDocument();
    });

    it('says what the map can do until the user first moves it, then never again for this map', async () => {
        const { rerender } = await renderMap();
        // Both wordings are in the page; CSS shows the one for the device's pointer.
        expect(screen.getByText('Drag to move, scroll to zoom, point at the map to see the biome')).toBeInTheDocument();
        expect(screen.getByText((_, el) => el.textContent === 'Drag to move, pinch to zoom, tap to see the biome')).toBeInTheDocument();
        act(() => drawer().emitTip({ pin: { x: 64, z: -128, biome: 'Cherry Grove', id: 185, left: 300, top: 200 } }));
        expect(screen.getByText('Drag to move, pinch to zoom,'), 'a tap is not a move').toBeInTheDocument();
        act(() => drawer().opts.onUserMove());
        expect(screen.queryByText(/^Drag to move/)).toBeNull();
        await rerender({ seed: '2' });
        expect(screen.queryByText(/^Drag to move/), 'a new world does not bring it back').toBeNull();
    });

    it('places a tip\'s bubble inside the map: below right of the mouse, above right of a pin, flipped or pushed in at the edges', () => {
        const size = { width: 150, height: 40 };
        // Offsets from the point, 16 px away.
        expect(placeTip({ left: 100, top: 100 }, size, 800, 600)).toEqual({ x: 16, y: 16 });
        expect(placeTip({ left: 100, top: 100 }, size, 800, 600, true)).toEqual({ x: 16, y: -56 });
        expect(placeTip({ left: 700, top: 100 }, size, 800, 600)).toEqual({ x: -166, y: 16 });
        expect(placeTip({ left: 100, top: 560 }, size, 800, 600)).toEqual({ x: 16, y: -56 });
        expect(placeTip({ left: 100, top: 30 }, size, 800, 600, true)).toEqual({ x: 16, y: 16 });
        // No room on either side (a 412 px phone, a tap in the middle): pushed in 4 px from the right edge.
        const wide = { width: 240, height: 56 };
        expect(placeTip({ left: 226, top: 300 }, wide, 412, 800, true)).toEqual({ x: 412 - 4 - 240 - 226, y: -72 });
        // Unmeasured (the first render): the largest box, 260 x 60.
        expect(placeTip({ left: 100, top: 100 }, null, 800, 600)).toEqual({ x: 16, y: 16 });
        expect(placeTip({ left: 600, top: 100 }, null, 800, 600)).toEqual({ x: -276, y: 16 });
    });

    it('the four arrow buttons pan', async () => {
        const user = userEvent.setup();
        await renderMap();
        await user.click(screen.getByRole('button', { name: 'Pan up' }));
        await user.click(screen.getByRole('button', { name: 'Pan down' }));
        await user.click(screen.getByRole('button', { name: 'Pan left' }));
        await user.click(screen.getByRole('button', { name: 'Pan right' }));
        expect(drawer().up).toHaveBeenCalledTimes(1);
        expect(drawer().down).toHaveBeenCalledTimes(1);
        expect(drawer().left).toHaveBeenCalledTimes(1);
        expect(drawer().right).toHaveBeenCalledTimes(1);
    });

    it('arrow keys pan only when nothing has focus: typing in a field never moves the map', async () => {
        render(<input aria-label="Other field" />);
        await renderMap();
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        fireEvent.keyDown(document.body, { key: 'ArrowUp' });
        expect(drawer().left).toHaveBeenCalledTimes(1);
        expect(drawer().up).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(screen.getByLabelText('Other field'), { key: 'ArrowLeft' });
        fireEvent.keyDown(screen.getByLabelText('Other field'), { key: 'ArrowRight' });
        fireEvent.keyDown(document.body, { key: 'Enter' });
        const pans = drawer().calls.filter((c) => ['up', 'down', 'left', 'right'].includes(c.name));
        expect(pans).toHaveLength(2);
        expect(drawer().right).not.toHaveBeenCalled();
    });

    it('apiRef exposes zoom, dezoom, the four pans, panTo, setHighlight, setOverlay and the renderer, and is emptied on unmount', async () => {
        const apiRef = { current: null };
        const { unmount } = await renderMap({ apiRef });
        expect(Object.keys(apiRef.current).sort()).toEqual(['dezoom', 'down', 'getDrawer', 'left', 'panTo', 'right', 'setHighlight', 'setOverlay', 'up', 'zoom']);
        apiRef.current.zoom();
        apiRef.current.dezoom();
        apiRef.current.down();
        expect(drawer().zoom).toHaveBeenCalledTimes(1);
        expect(drawer().dezoom).toHaveBeenCalledTimes(1);
        expect(drawer().down).toHaveBeenCalledTimes(1);
        expect(apiRef.current.getDrawer()).toBe(drawer());
        unmount();
        expect(apiRef.current).toBeNull();
    });

    it('apiRef.panTo and apiRef.setHighlight forward their arguments to the renderer', async () => {
        const apiRef = { current: null };
        await renderMap({ apiRef });
        apiRef.current.panTo(-32, 80, { animate: false });
        apiRef.current.panTo(100, -200);
        expect(drawer().callsOf('panTo')).toEqual([[-32, 80, { animate: false }], [100, -200, undefined]]);
        const marker = { x: -32, z: 80, label: 'Spawn' };
        apiRef.current.setHighlight(marker);
        apiRef.current.setHighlight(null);
        expect(drawer().callsOf('setHighlight')).toEqual([[marker], [null]]);
    });
});

describe('overlays', () => {
    const slimeCalls = () => drawer().callsOf('setOverlay').filter(([name]) => name === 'slime');

    it('overlays={{ slime: true }} switches the slime grid on once; flipping the prop switches it off', async () => {
        const { rerender } = await renderMap({ overlays: { slime: true } });
        expect(slimeCalls()).toEqual([['slime', true]]);
        expect(drawer().overlays).toEqual({ slime: true });
        await rerender({ overlays: { slime: true } });                  // a new object saying the same thing
        expect(slimeCalls()).toEqual([['slime', true]]);
        await rerender({ overlays: { slime: false } });
        expect(slimeCalls()).toEqual([['slime', true], ['slime', false]]);
        expect(drawer().overlays).toEqual({});
    });

    it('is off without the prop, and survives a world change', async () => {
        const { rerender } = await renderMap();
        expect(slimeCalls()).toEqual([['slime', false]]);
        await rerender({ overlays: { slime: true } });
        await rerender({ seed: '2', dimension: -1 });
        expect(slimeCalls()).toEqual([['slime', false], ['slime', true]]);
        expect(drawer().overlays).toEqual({ slime: true });
    });

    it('overlays={{ chunkGrid }} switches the chunk grid on its own, next to the slime grid', async () => {
        const grid = () => drawer().callsOf('setOverlay').filter(([name]) => name === 'chunkGrid');
        const { rerender } = await renderMap({ overlays: { chunkGrid: true } });
        expect(grid()).toEqual([['chunkGrid', true]]);
        expect(slimeCalls()).toEqual([['slime', false]]);
        await rerender({ overlays: { chunkGrid: true, slime: true } });
        expect(grid()).toEqual([['chunkGrid', true]]);
        expect(drawer().overlays).toEqual({ chunkGrid: true, slime: true });
        await rerender({ overlays: { slime: true } });
        expect(grid()).toEqual([['chunkGrid', true], ['chunkGrid', false]]);
        expect(drawer().overlays).toEqual({ slime: true });
    });

    it('apiRef.setOverlay forwards to the renderer', async () => {
        const apiRef = { current: null };
        await renderMap({ apiRef });
        apiRef.current.setOverlay('slime', true);
        expect(drawer().callsOf('setOverlay').at(-1)).toEqual(['slime', true]);
    });
});

describe('resizing', () => {
    it('re-fits the canvas to the container and repaints when the container changes size', async () => {
        await renderMap();
        const draws = () => drawer().draw.mock.calls.length;
        const before = draws();
        size.width = 1000;
        size.height = 700;
        act(() => FakeResizeObserver.trigger());
        expect(drawer().canvas.width).toBe(1000);
        expect(drawer().canvas.height).toBe(700);
        expect(draws()).toBe(before + 1);
        expect(drawer().clear).toHaveBeenCalledTimes(1);   // the pan is kept, not recentred
    });

    it('ignores a notification that does not change the size (no needless bitmap wipe)', async () => {
        await renderMap();
        const before = drawer().draw.mock.calls.length;
        act(() => FakeResizeObserver.trigger());
        expect(drawer().draw.mock.calls.length).toBe(before);
        expect(drawer().canvas.width).toBe(800);
    });
});
