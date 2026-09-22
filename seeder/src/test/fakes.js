// Test doubles shared by the unit / component tests. They mirror the public
// surface of the real classes (queue.js, draw.js, the Worker API) and record
// calls so tests can assert on behaviour without workers, WASM or a canvas.
import { vi } from 'vitest';
import { BIOMES } from '../util/constants';

// ---- Canvas -----------------------------------------------------------------

// Stands in for CanvasRenderingContext2D: records every drawing call.
export class RecordingCanvasContext {
    constructor(canvas) {
        this.canvas = canvas;
        this.calls = [];
        this.imageSmoothingEnabled = true;
        this.font = '';
        this.textAlign = '';
        this.fillStyle = '';
    }
    _record(name, args) { this.calls.push({ name, args }); }
    clearRect(...args) { this._record('clearRect', args); }
    drawImage(...args) { this._record('drawImage', args); }
    fillRect(...args) { this._record('fillRect', args); }
    fillText(...args) { this._record('fillText', args); }
    putImageData(...args) { this._record('putImageData', args); }
    measureText(text) { return { width: String(text).length * 6 }; }
    getImageData(x, y, w, h) { return new ImageData(w, h); }
    callsOf(name) { return this.calls.filter((c) => c.name === name); }
    reset() { this.calls = []; }
}

// ---- QueueManager -------------------------------------------------------------

// A deterministic palette indexed by biome id, like queue.COLORS after GET_COLORS.
export const FAKE_COLORS = (() => {
    const colors = [];
    for (const { value } of BIOMES) colors[value] = [value % 256, (value * 7) % 256, (value * 13) % 256, 255];
    return colors;
})();

export class FakeQueueManager {
    static instances = [];
    static reset() { FakeQueueManager.instances = []; }
    static latest() { return FakeQueueManager.instances.at(-1); }

    constructor(path, numberOfWorkers) {
        FakeQueueManager.instances.push(this);
        this.path = path;
        this.numberOfWorkers = numberOfWorkers ?? 1;
        this.workers = [];
        this.COLORS = FAKE_COLORS;
        this.seedUpdateCallback = null;
        this.resetListeners = [];
        this.stats = { areaRequests: 0, areaDone: 0 };
        // Every seed search is recorded here so a test can inspect the arguments
        // and "find" a seed by calling its callback.
        this.searches = [];
        const recordSearch = (kind) => vi.fn((...args) => {
            this.searches.push({ kind, args, callback: args[args.length - 1] });
        });
        this.findBiomes = recordSearch('findBiomes');
        this.findStructures = recordSearch('findStructures');
        this.findBiomesWithStructures = recordSearch('findBiomesWithStructures');
        this.draw = vi.fn();
        this.findSpawn = vi.fn();
        this.findStrongholds = vi.fn();
        this.getStructuresInRegions = vi.fn();
        this.getColors = vi.fn();
        this.killAll = vi.fn();
        this.restartAll = vi.fn();
        this.printStatus = vi.fn();
    }
    addResetListener(fn) { this.resetListeners.push(fn); }
    removeResetListener(fn) { this.resetListeners = this.resetListeners.filter((f) => f !== fn); }
    lastSearch() { return this.searches.at(-1); }
    // Simulate a worker reporting a hit for the most recent search.
    resolveLastSearch(seed) { this.lastSearch().callback(seed); }
    // Simulate SEED_UPDATE progress ticks.
    tickProgress(times = 1) { for (let i = 0; i < times; i++) this.seedUpdateCallback?.(); }
}

// ---- DrawSeed -------------------------------------------------------------

export class FakeDrawSeed {
    static instances = [];
    // When false, findSpawn/findStrongholds/findStructure hold their callbacks
    // until resolveSpawn()/resolveStrongholds()/resolveStructures() is called.
    static autoResolve = true;
    static reset() { FakeDrawSeed.instances = []; FakeDrawSeed.autoResolve = true; }
    static latest() { return FakeDrawSeed.instances.at(-1); }

    constructor(mcVersion, queue, canvas, onclick, onmousemove, drawDim, pixDim) {
        FakeDrawSeed.instances.push(this);
        Object.assign(this, { mcVersion, queue, canvas, onclick, onmousemove, drawDim, pixDim });
        this.seed = null;
        this.dimension = 0;
        this.yHeight = 320;
        this.structuresShown = [];
        this.showStructureCoords = true;
        this.spawnX = null;
        this.spawnZ = null;
        this.pendingSpawn = [];
        this.pendingStrongholds = [];
        this.pendingStructures = [];
        this.calls = [];

        const record = (name, impl) => vi.fn((...args) => {
            this.calls.push({ name, args });
            return impl ? impl(...args) : undefined;
        });
        this.clear = record('clear', () => { this.spawnX = null; this.spawnZ = null; });
        this.setSeed = record('setSeed', (seed) => { this.seed = seed; });
        this.setMcVersion = record('setMcVersion', (v) => { this.mcVersion = v; });
        this.setDimension = record('setDimension', (d) => { this.dimension = d; });
        this.setYHeight = record('setYHeight', (y) => { this.yHeight = y; });
        this.setStructuresShown = record('setStructuresShown', (list) => { this.structuresShown = [...list]; });
        this.setShowStructureCoords = record('setShowStructureCoords', (v) => { this.showStructureCoords = v; });
        // The real draw() repaints on the next animation frame and then calls back.
        this.draw = record('draw', (cb) => { if (cb) queueMicrotask(cb); });
        this.drawStructures = record('drawStructures');
        this.findSpawn = record('findSpawn', (cb) => {
            this.pendingSpawn.push({ seed: this.seed, cb });
            if (FakeDrawSeed.autoResolve) this.resolveSpawn();
        });
        this.findStrongholds = record('findStrongholds', (cb) => {
            this.pendingStrongholds.push({ seed: this.seed, cb });
            if (FakeDrawSeed.autoResolve) this.resolveStrongholds();
        });
        this.findStructure = record('findStructure', (structType, cb) => {
            this.pendingStructures.push({ seed: this.seed, structType, cb });
            if (FakeDrawSeed.autoResolve) this.resolveStructures();
        });
        this.zoom = record('zoom');
        this.dezoom = record('dezoom');
        this.up = record('up');
        this.down = record('down');
        this.left = record('left');
        this.right = record('right');
        this.destroy = record('destroy');
        this.getStats = record('getStats', () => ({}));
    }
    resolveSpawn(x = 8, z = -24) {
        for (const { seed, cb } of this.pendingSpawn.splice(0)) { this.spawnX = x; this.spawnZ = z; cb?.(seed, x, z); }
    }
    resolveStrongholds(coords = [[1234, -876]]) {
        for (const { seed, cb } of this.pendingStrongholds.splice(0)) cb?.(seed, coords);
    }
    resolveStructures(coords = [[400, 400]]) {
        for (const { seed, cb } of this.pendingStructures.splice(0)) cb?.(seed, coords);
    }
    // Simulate the pointer hovering a biome on the map.
    emitHover(x, z, biome) { this.onmousemove?.(x, z, biome); }
    callsOf(name) { return this.calls.filter((c) => c.name === name).map((c) => c.args); }
}

// ---- Worker -------------------------------------------------------------

// Scripted stand-in for the browser Worker: records what the pool posts and lets
// the test reply with emit(kind, data). Replies are delivered synchronously.
export class FakeWorker {
    static instances = [];
    static reset() { FakeWorker.instances = []; }
    static live() { return FakeWorker.instances.filter((w) => !w.terminated); }

    constructor(path) {
        FakeWorker.instances.push(this);
        this.path = path;
        this.posted = [];
        this.listeners = [];
        this.terminated = false;
    }
    postMessage(message) { this.posted.push(message); }
    addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); }
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((f) => f !== fn); }
    terminate() { this.terminated = true; }
    emit(kind, data) { for (const fn of [...this.listeners]) fn({ data: { kind, data } }); }
    postedKinds() { return this.posted.map((m) => m.kind); }
    lastPosted(kind) { return this.posted.filter((m) => m.kind === kind).at(-1); }
}
