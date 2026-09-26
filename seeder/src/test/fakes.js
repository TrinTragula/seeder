// Test doubles shared by the unit / component tests. They mirror the public
// surface of the real classes (queue.js, draw.js, the Worker API, ResizeObserver)
// and record calls so tests can assert on behaviour without workers, WASM or a canvas.
import { vi } from 'vitest';
import { BIOMES, VERSIONS } from '../util/constants';

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
        this.strokeStyle = '';
        this.lineWidth = 1;
    }
    _record(name, args) { this.calls.push({ name, args }); }
    clearRect(...args) { this._record('clearRect', args); }
    drawImage(...args) { this._record('drawImage', args); }
    // Fills keep the fill style in effect on the call (not in args, which tests compare whole).
    fillRect(...args) { this.calls.push({ name: 'fillRect', args, fillStyle: this.fillStyle }); }
    fill(...args) { this.calls.push({ name: 'fill', args, fillStyle: this.fillStyle }); }
    // Records the stroke style and width in effect, like stroke().
    strokeRect(...args) { this._record('strokeRect', [...args, { strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }]); }
    fillText(...args) { this._record('fillText', args); }
    putImageData(...args) { this._record('putImageData', args); }
    beginPath(...args) { this._record('beginPath', args); }
    arc(...args) { this._record('arc', args); }
    ellipse(...args) { this._record('ellipse', args); }
    // Records the stroke style and width in effect, since they are set before the call.
    stroke(...args) { this._record('stroke', [...args, { strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }]); }
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

// The newest MCVersion int, like the engine's mc_newest().
const NEWEST_MC = Math.max(...Object.values(VERSIONS));

// What FakeQueueManager.getVersionSupport resolves with unless a test configures
// `versionSupport`: every requested biome exists, every structure generates in the
// Overworld with 512-block regions and no minimum distance.
export function defaultVersionSupport(mcVersion, biomeIds = [], structTypes = []) {
    const each = (keys, value) => Object.fromEntries(keys.map((k) => [k, value]));
    return {
        mcVersion, newest: NEWEST_MC,
        biomes: [...biomeIds], biomeDimensions: each(biomeIds, 0),
        structures: each(structTypes, 0), regionBlocks: each(structTypes, 512), minDistance: each(structTypes, 0),
    };
}

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
        this.resetListeners = [];
        this.stats = { areaRequests: 0, areaDone: 0 };
        // Every findSeeds() call is recorded here as { id, criteria, cbs, hits, active };
        // a test streams results into the latest one with emitHit / emitProgress / finish.
        this.searches = [];
        this.searchCounter = 0;
        // What getVersionSupport() resolves with; null = defaultVersionSupport().
        this.versionSupport = null;
        this.findSeeds = vi.fn((criteria, cbs = {}) => {
            const id = ++this.searchCounter;
            this.searches.push({ id, criteria, cbs, hits: [], active: true });
            return { id, stop: () => { if (this.lastSearch()?.id === id) this.stopSearch(); } };
        });
        this.stopSearch = vi.fn(() => {
            const s = this.lastSearch();
            if (!s?.active) return;
            s.active = false;
            s.cbs.onDone?.(s.hits, 0n, 'stopped', BigInt(s.criteria.startingSeed ?? 0), { tested: 0, elapsedMs: 0, error: null });
        });
        this.getVersionSupport = vi.fn((mcVersion, biomeIds = [], structTypes = []) =>
            Promise.resolve(this.versionSupport ?? defaultVersionSupport(mcVersion, biomeIds, structTypes)));
        // Every request() call is recorded here as { id, kind, data, opts, resolve, reject, settled };
        // a test answers with resolveRequest(kind, result) and inspects pendingOf(kind).
        this.requests = [];
        this.requestCounter = 0;
        this.cancelledTokens = [];
        this.request = vi.fn((kind, data = {}, opts = {}) => new Promise((resolve, reject) => {
            const entry = { id: ++this.requestCounter, kind, data, opts, settled: false };
            entry.resolve = (value) => { entry.settled = true; resolve(value); };
            entry.reject = (reason) => { entry.settled = true; reject(reason); };
            this.requests.push(entry);
        }));
        // Like the real one, a low-priority GET_AREA request: it shows up in `requests`.
        this.requestArea = vi.fn((params, opts = {}) => this.request('GET_AREA', params, { priority: 'low', ...opts }));
        // Like the real pool: every unsettled request made with this token rejects at once.
        this.cancelToken = vi.fn((token) => {
            this.cancelledTokens.push(token);
            for (const entry of this.pendingRequests()) {
                if (entry.opts.token === token) entry.reject({ cancelled: true, reason: 'cancelled' });
            }
        });
        this.draw = vi.fn();
        this.findSpawn = vi.fn();
        this.findStrongholds = vi.fn();
        this.getStructuresInRegions = vi.fn();
        this.getColors = vi.fn();
        // Like the real pool, tearing it down ends a running search as 'stopped' and
        // rejects every unsettled request with reason 'killed'.
        this.killAll = vi.fn(() => { this.stopSearch(); this.rejectAllRequests('killed'); });
        this.restartAll = vi.fn(() => { this.stopSearch(); this.rejectAllRequests('killed'); });
        this.printStatus = vi.fn();
    }
    addResetListener(fn) { this.resetListeners.push(fn); }
    removeResetListener(fn) { this.resetListeners = this.resetListeners.filter((f) => f !== fn); }
    get searching() { return !!this.lastSearch()?.active; }
    lastSearch() { return this.searches.at(-1); }
    _active(helper) {
        const s = this.lastSearch();
        if (!s?.active) throw new Error(`FakeQueueManager.${helper}: no search is running`);
        return s;
    }
    // Stream one hit into the running search; `index` is assigned like the real coordinator.
    emitHit(hit) {
        const s = this._active('emitHit');
        const full = { spawnX: 0, spawnZ: 0, structures: [], examined: 0, tested: 0, ...hit, index: s.hits.length };
        s.hits.push(full);
        s.cbs.onHit?.(full);
        return full;
    }
    // Simulate a progress tick (fields default to zero / the current hit count).
    emitProgress(progress = {}) {
        const s = this._active('emitProgress');
        s.cbs.onProgress?.({ examined: 0n, tested: 0, hits: s.hits.length, elapsedMs: 0, ...progress });
    }
    pendingRequests() { return this.requests.filter((r) => !r.settled); }
    // Unsettled request() entries of one kind, oldest first.
    pendingOf(kind) { return this.pendingRequests().filter((r) => r.kind === kind); }
    // Answer the last (or the index-th, negative counts from the end) unsettled request of
    // `kind` the way the engine does: the reply data with `error: null` unless given.
    resolveRequest(kind, result = {}, index = -1) {
        const entry = this.pendingOf(kind).at(index);
        if (!entry) throw new Error(`FakeQueueManager.resolveRequest: no pending ${kind} request`);
        entry.resolve({ error: null, ...result });
        return entry;
    }
    // Answer every unsettled GET_AREA (e.g. all of a thumbnail's strips) with blank pixels of
    // its own size, `fill(entry)` -> { ids, rgba } overriding them. Returns the entries.
    resolveAreas(fill = null) {
        const entries = this.pendingOf('GET_AREA');
        for (const entry of entries) {
            const cells = entry.data.widthX * entry.data.widthY;
            entry.resolve({ error: null, ids: new Int32Array(cells), rgba: new Uint8ClampedArray(cells * 4), ...fill?.(entry) });
        }
        return entries;
    }
    // Reject every unsettled request, like killAll() ('killed') or cancelToken() ('cancelled').
    rejectAllRequests(reason = 'killed') {
        for (const entry of this.pendingRequests()) entry.reject({ cancelled: true, reason });
    }
    // End the running search the way the coordinator would: onDone(hits, examined, reason, resumeSeed, extra).
    finish(reason = 'target', resumeSeed, extra = {}) {
        const s = this._active('finish');
        s.active = false;
        const { examined = 0n, ...rest } = extra;
        s.cbs.onDone?.(s.hits, examined, reason, resumeSeed ?? BigInt(s.criteria.startingSeed ?? 0), { tested: 0, elapsedMs: 0, error: null, ...rest });
    }
}

// ---- DrawSeed -------------------------------------------------------------

export class FakeDrawSeed {
    static instances = [];
    // When false, findSpawn/findStrongholds/findStructure hold their callbacks
    // until resolveSpawn()/resolveStrongholds()/resolveStructures() (or failSpawn()) is called.
    static autoResolve = true;
    static reset() { FakeDrawSeed.instances = []; FakeDrawSeed.autoResolve = true; }
    static latest() { return FakeDrawSeed.instances.at(-1); }

    constructor(mcVersion, queue, canvas, onclick, ontip, drawDim, pixDim, opts = {}) {
        FakeDrawSeed.instances.push(this);
        Object.assign(this, { mcVersion, queue, canvas, onclick, ontip, drawDim, pixDim, opts });
        // Like the real class, world (0,0) is centred from the canvas size *at construction*,
        // so a test can tell whether the canvas was sized before or after `new DrawSeed`.
        this.panX = canvas.width / 2;
        this.panZ = canvas.height / 2;
        // The tooling hook is opt-in (bench, e2e); only the page's main map asks for it.
        if (opts.exposeGlobal && typeof window !== 'undefined') window.__seederDrawer = this;
        this.seed = null;
        this.dimension = 0;
        this.yHeight = 320;
        this.structuresShown = [];
        this.showStructureCoords = true;
        this.spawnX = null;
        this.spawnZ = null;
        this.highlight = null;
        // Overlays switched on, by name (true), like the real class' overlays map.
        this.overlays = {};
        this.pendingSpawn = [];
        this.pendingStrongholds = [];
        this.pendingStructures = [];
        this.calls = [];

        const record = (name, impl) => vi.fn((...args) => {
            this.calls.push({ name, args });
            return impl ? impl(...args) : undefined;
        });
        this.clear = record('clear', () => { this.spawnX = null; this.spawnZ = null; this.highlight = null; });
        this.setSeed = record('setSeed', (seed) => { this.seed = seed; });
        this.setMcVersion = record('setMcVersion', (v) => { this.mcVersion = v; });
        this.setDimension = record('setDimension', (d) => { this.dimension = d; });
        this.setYHeight = record('setYHeight', (y) => { this.yHeight = y; });
        this.setStructuresShown = record('setStructuresShown', (list) => { this.structuresShown = [...list]; });
        this.setShowStructureCoords = record('setShowStructureCoords', (v) => { this.showStructureCoords = v; });
        // The real draw() repaints on the next animation frame and then calls back.
        this.draw = record('draw', (cb) => { if (cb) queueMicrotask(cb); });
        this.drawStructures = record('drawStructures');
        this.findSpawn = record('findSpawn', (cb, onError) => {
            this.pendingSpawn.push({ seed: this.seed, cb, onError });
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
        this.panTo = record('panTo');
        this.setHighlight = record('setHighlight', (marker) => { this.highlight = marker ?? null; });
        this.clearPin = record('clearPin', () => this.ontip?.({ hover: null, pin: null }));
        this.setOverlay = record('setOverlay', (name, on) => {
            if (on) this.overlays[name] = true;
            else delete this.overlays[name];
        });
        this.destroy = record('destroy', () => {
            if (typeof window !== 'undefined' && window.__seederDrawer === this) delete window.__seederDrawer;
        });
        this.getStats = record('getStats', () => ({}));
    }
    resolveSpawn(x = 8, z = -24) {
        for (const { seed, cb } of this.pendingSpawn.splice(0)) { this.spawnX = x; this.spawnZ = z; cb?.(seed, x, z); }
    }
    // The engine could not find the spawn: like the real class, onError(error) instead.
    failSpawn(error = { code: 'WORKER_CRASH', message: 'The engine worker crashed.' }) {
        for (const { onError } of this.pendingSpawn.splice(0)) onError?.(error);
    }
    resolveStrongholds(coords = [[1234, -876]]) {
        for (const { seed, cb } of this.pendingStrongholds.splice(0)) cb?.(seed, coords);
    }
    resolveStructures(coords = [[400, 400]]) {
        for (const { seed, cb } of this.pendingStructures.splice(0)) cb?.(seed, coords);
    }
    // Simulate what the real class reports: { hover, pin }, each { x, z, biome, id, left, top } or null.
    emitTip({ hover = null, pin = null } = {}) { this.ontip?.({ hover, pin }); }
    callsOf(name) { return this.calls.filter((c) => c.name === name).map((c) => c.args); }
}

// ---- ResizeObserver -------------------------------------------------------------

// jsdom has no ResizeObserver. This one records what is observed and lets a test
// fire a resize with FakeResizeObserver.trigger() after changing the mocked sizes.
// setup.js installs it on globalThis for the whole `unit` project.
export class FakeResizeObserver {
    static instances = [];
    static reset() { FakeResizeObserver.instances = []; }
    static live() { return FakeResizeObserver.instances.filter((o) => !o.disconnected); }
    // Notify every live observer. Without `entries`, one entry per observed element is
    // built from its (mocked) clientWidth/clientHeight, like the browser would.
    static trigger(entries) {
        for (const observer of FakeResizeObserver.live()) {
            const list = entries ?? observer.targets.map((target) => ({
                target,
                contentRect: { width: target.clientWidth, height: target.clientHeight },
            }));
            observer.callback(list, observer);
        }
    }

    constructor(callback) {
        FakeResizeObserver.instances.push(this);
        this.callback = callback;
        this.targets = [];
        this.disconnected = false;
    }
    observe(target) { if (!this.targets.includes(target)) this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter((t) => t !== target); }
    disconnect() { this.targets = []; this.disconnected = true; }
}

// ---- IntersectionObserver ---------------------------------------------------------

// jsdom has no IntersectionObserver. This one records what is observed and with which
// options; a test decides what is on screen with FakeIntersectionObserver.trigger(el).
// setup.js installs it on globalThis for the whole `unit` project.
export class FakeIntersectionObserver {
    static instances = [];
    static reset() { FakeIntersectionObserver.instances = []; }
    static live() { return FakeIntersectionObserver.instances.filter((o) => !o.disconnected); }
    // Tell every live observer that watches `target` it (dis)appeared, with one entry
    // shaped like the browser's. Returns how many observers were notified.
    static trigger(target, isIntersecting = true, ratio = 1) {
        const observers = FakeIntersectionObserver.live().filter((o) => o.targets.includes(target));
        for (const observer of observers) {
            observer.callback([{
                target,
                isIntersecting,
                intersectionRatio: isIntersecting ? ratio : 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null,
                time: 0,
            }], observer);
        }
        return observers.length;
    }

    constructor(callback, options = {}) {
        FakeIntersectionObserver.instances.push(this);
        this.callback = callback;
        this.options = options;
        this.targets = [];
        this.disconnected = false;
    }
    observe(target) { if (!this.targets.includes(target)) this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter((t) => t !== target); }
    disconnect() { this.targets = []; this.disconnected = true; }
    takeRecords() { return []; }
}

// ---- matchMedia -------------------------------------------------------------

// jsdom has no matchMedia. setup.js installs FakeMatchMedia.create as window.matchMedia
// for the whole `unit` project. Unknown queries do not match, except the desktop
// breakpoint, which does by default so every page test gets the desktop layout unless
// it asks for a phone with FakeMatchMedia.set('(min-width: 768px)', false).
const DEFAULT_MEDIA = { '(min-width: 768px)': true };

export class FakeMatchMedia {
    static matches = { ...DEFAULT_MEDIA };
    static lists = [];
    static reset() { FakeMatchMedia.matches = { ...DEFAULT_MEDIA }; FakeMatchMedia.lists = []; }
    // Change what a query answers. Listeners hear about it on trigger(), like a resize would.
    static set(query, matches) { FakeMatchMedia.matches[query] = matches; }
    // Fire `change` on every list whose answer differs from what it last reported.
    static trigger() {
        for (const list of FakeMatchMedia.lists) {
            if (list.reported === list.matches) continue;
            list.reported = list.matches;
            const event = { matches: list.matches, media: list.media };
            for (const fn of [...list.listeners]) fn(event);
            list.onchange?.(event);
        }
    }
    static create(query) { return new FakeMatchMedia(query); }

    constructor(query) {
        FakeMatchMedia.lists.push(this);
        this.media = query;
        this.listeners = [];
        this.onchange = null;
        this.reported = this.matches;
    }
    get matches() { return !!FakeMatchMedia.matches[this.media]; }
    addEventListener(type, fn) { if (type === 'change' && !this.listeners.includes(fn)) this.listeners.push(fn); }
    removeEventListener(type, fn) { if (type === 'change') this.listeners = this.listeners.filter((f) => f !== fn); }
    // The deprecated MediaQueryList API, for code that still uses it.
    addListener(fn) { this.addEventListener('change', fn); }
    removeListener(fn) { this.removeEventListener('change', fn); }
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
        this.otherListeners = {};              // 'error' / 'messageerror' -> [fn]
        this.terminated = false;
    }
    postMessage(message) { this.posted.push(message); }
    addEventListener(type, fn) {
        if (type === 'message') this.listeners.push(fn);
        else (this.otherListeners[type] ??= []).push(fn);
    }
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((f) => f !== fn); }
    terminate() { this.terminated = true; }
    emit(kind, data) { for (const fn of [...this.listeners]) fn({ data: { kind, data } }); }
    // An uncaught exception in the worker (type 'error') or an undeserializable message
    // ('messageerror'); returns the event so tests can check preventDefault.
    crash(message = 'boom', type = 'error') {
        const event = { type, message, preventDefault: vi.fn() };
        for (const fn of [...(this.otherListeners[type] ?? [])]) fn(event);
        return event;
    }
    postedKinds() { return this.posted.map((m) => m.kind); }
    lastPosted(kind) { return this.posted.filter((m) => m.kind === kind).at(-1); }
}
