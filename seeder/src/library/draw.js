import { BIOMES } from '../util/constants';
import { OVERLAYS } from './overlays';

// One biome cell = 4 blocks (world-gen is generated at scale 1:4).
const CELL_TO_BLOCK = 4;
// Movement (in screen px) before a press is treated as a drag rather than a click.
const CLICK_THRESHOLD = 4;
// Per-frame velocity decay used for both flick-inertia and keyboard/button glide.
const FRICTION = 0.92;
// Velocity (px/frame) below which a glide stops.
const MIN_VELOCITY = 0.05;
// A release this long (ms) after the last move is a finger that stopped: no glide. The
// bottom sheet measures its flicks over the same window (WINDOW_MS in BottomSheet.jsx).
const REST_MS = 80;
// Clamp on glide velocity so a violent flick can't teleport the map.
const MAX_VELOCITY = 60;
// Velocity impulse (px/frame) added per arrow-key / arrow-button press.
const ARROW_IMPULSE = 14;
// Upper bound on cached tiles (LRU). Each tile is a 75x75 canvas (~22KB) + an
// Int16 biome-id array (~11KB) ≈ 34KB, so 1500 tiles ≈ ~50MB - enough history
// to wander several screens and return without regenerating.
const MAX_TILES = 1500;
// Duration of an animated panTo (ease-out cubic).
const PAN_MS = 300;
// The highlight's pin body: --color-accent in tokens.css. A canvas cannot read CSS custom
// properties, so the value is repeated here.
const HIGHLIGHT_COLOR = '#ff8c00';
/*
 * The highlight: a pixel map pin (public/svg/pin.svg, 16x16) drawn at `scale`, its tip
 * on the marked block, over a soft shadow. `rects` are the pin's pixels as
 * [x, y, w, h] runs per colour, in the pin's own 16x16 grid; the tip is the bottom
 * centre (8, 16).
 */
export const HIGHLIGHT_PIN = {
    scale: 2,
    size: 16,
    rects: [
        ['#000', [[5, 0, 6, 1], [3, 1, 2, 1], [11, 1, 2, 1], [2, 2, 1, 2], [13, 2, 1, 2], [1, 4, 1, 4], [14, 4, 1, 4],
            [2, 8, 1, 2], [13, 8, 1, 2], [3, 10, 1, 2], [12, 10, 1, 2], [4, 12, 1, 1], [11, 12, 1, 1], [5, 13, 1, 1],
            [10, 13, 1, 1], [6, 14, 1, 1], [9, 14, 1, 1], [7, 15, 2, 1]]],
        [HIGHLIGHT_COLOR, [[5, 1, 6, 1], [3, 2, 10, 2], [2, 4, 12, 4], [3, 8, 10, 2], [4, 10, 8, 2], [5, 12, 6, 1],
            [6, 13, 4, 1], [7, 14, 2, 1]]],
        ['#fff', [[6, 4, 4, 4]]],
        ['#000', [[7, 5, 2, 2]]],
    ],
};
// The shadow under the tip (screen px radii), and the gap between the pin's head and its label.
const PIN_SHADOW = { rx: 7, rz: 3, color: 'rgba(0, 0, 0, 0.35)' };
const PIN_LABEL_GAP = 4;

// Two tips (see _emitTip) say the same thing: nothing, or the same place, biome and spot.
const sameTip = (a, b) => a === b || (a != null && b != null
    && a.x === b.x && a.z === b.z && a.id === b.id && a.left === b.left && a.top === b.top);

/*
 * An icon drawn without its coordinate label (the finder's preview map and thumbnails, or
 * the labels turned off) loses the label's pale box that made it stand out, so it gets a
 * black silhouette outline instead: outlinedIcon(icon, w, h) is the icon drawn at w × h on
 * a canvas ICON_OUTLINE_PX larger on every side, over its own shape in black grown by
 * ICON_OUTLINE_PX. Built once per loaded icon.
 */
export const ICON_OUTLINE_PX = 2;
const outlinedIcons = new WeakMap();
export function outlinedIcon(icon, w, h, doc = globalThis.document) {
    const cached = outlinedIcons.get(icon);
    if (cached) return cached;
    const o = ICON_OUTLINE_PX;
    const canvas = doc.createElement('canvas');
    canvas.width = w + 2 * o;
    canvas.height = h + 2 * o;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (let dx = 0; dx <= 2 * o; dx++) {
        for (let dy = 0; dy <= 2 * o; dy++) ctx.drawImage(icon, dx, dy, w, h);
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(icon, o, o, w, h);
    outlinedIcons.set(icon, canvas);
    return canvas;
}

export const STRUCTURE_ICONS = {
    /*  Desert_Pyramid */   1: '/img/temple.png',
    /*  Jungle_Pyramid */   2: '/img/jungle.png',
    /*  Swamp_Hut */        3: '/img/hut.png',
    /*  Igloo */            4: '/img/igloo.png',
    /*  Village */          5: '/img/village.png',
    /*  Ocean_Ruin */       6: '/img/ocean.png',
    /*  Shipwreck */        7: '/img/wood.jpg',
    /*  Monument */         8: '/img/guardian.png',
    /*  Mansion */          9: '/img/mansion.png',
    /*  Outpost */          10: '/img/outpost.png',
    /*  Ruined_Portal */    11: '/img/portal.png',
    // 12 Ruined_Portal_N,
    /*  Ancient City */     13: '/img/ancient_city.png',
    /*  Treasure */         14: '/img/treasure.png',
    // 15 Mineshaft,
    // 16 Desert well,
    // 17 Geode,
    /*  Fortress */         18: '/img/fortress.png',
    /*  Bastion */          19: '/img/bastion.png',
    // 20 Nether Fossil,
    /*  End_City */         21: '/img/end_city.png',
    /*  End_Gateway */      22: '/img/end_gateway.png',
    /*  23 End Island */
    /*  Trail Ruin */       24: '/img/ruin.png',
    /*  Trial Chamber */    25: '/img/chamber.png',
    /*  Abandoned Camp */   26: '/img/camp.png',
};

// The user asked the OS for less motion: animations become instant.
const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class DrawSeed {
    // `ontip({ hover, pin })` reports the biome under the mouse and the place a finger
    // tapped (see _emitTip). `opts.onUserMove()` is called once, the first time the user
    // moves the map (drag, pinch, wheel, arrows, zoom); panTo() is not the user.
    // `opts.exposeGlobal` publishes the instance as window.__seederDrawer for tooling
    // (bench/bench.mjs, the e2e fixtures). Opt-in, so a preview map or a thumbnail can
    // never take the hook away from the page's main map.
    constructor(mcVersion, queue, canvas, onclick, ontip, drawDim, pixDim, { exposeGlobal = false, onUserMove = null } = {}) {
        this.mcVersion = mcVersion;
        this.dimension = 0; // Overworld
        this.yHeight = 320; // Top of the world
        this.queue = queue;
        this.canvas = canvas;
        // null where there is no 2D context (a bare jsdom): _render then does nothing.
        this.ctx = this.canvas.getContext("2d");
        this.TILE = drawDim ?? 75;   // biome cells per tile edge
        this.pixDim = pixDim ?? 1;   // integer zoom (screen px per biome cell)
        this.seed = null;

        // Pan = screen-pixel translation of world-cell origin (0,0).
        //   screenPx = worldCell * pixDim + pan   <=>   worldCell = (screenPx - pan) / pixDim
        // Centre world (0,0) in the viewport.
        this.panX = this.canvas.width / 2;
        this.panZ = this.canvas.height / 2;

        // Content-addressed, world-aligned tile cache (also acts as the hover data
        // source). Insertion-ordered Map used as an LRU (re-inserted on access).
        this.tiles = new Map();       // key -> { bitmap: ImageBitmap, ids: Int32Array }
        this.pending = new Set();     // tile keys currently requested from the queue

        // Structure overlays.
        this.spawnShown = false;
        this.spawnX = null;
        this.spawnZ = null;
        this.strongholdsShown = false;
        this.strongholds = null;
        this.structuresShown = {};
        this.structures = {};
        this.showStructureCoords = true;

        // The one highlighted place ({ x, z, label } in blocks) or null. See setHighlight.
        this.highlight = null;

        // Overlays switched on, by name (see setOverlay). Public for tooling: the e2e
        // tests wait on overlays.slime.pending.
        this.overlays = {};

        // rAF render loop.
        this.dirty = false;
        this.rafId = null;

        // Drag / inertia state.
        this.dragging = false;
        this.moved = false;
        this.pointerId = null;
        this.dragStartClientX = 0;
        this.dragStartClientY = 0;
        this.dragStartPanX = 0;
        this.dragStartPanZ = 0;
        this.velSamples = [];
        this.velX = 0;
        this.velZ = 0;
        this.glideRaf = null;
        // True while panTo's animation owns glideRaf (instead of an inertial glide).
        this.panning = false;
        this.lastPointer = null;   // last pointer position (any pointer), canvas-relative { x, y }
        this.hover = null;         // the mouse / pen position, canvas-relative { x, y }, or null
        // The place a finger tapped: { cellX, cellZ } (the exact world point, in fractional
        // biome cells) plus its { x, z, biome, id }, or null. See _emitTip.
        this.pin = null;
        this.lastTip = { hover: null, pin: null };   // what ontip last reported

        // Multi-touch / pinch state.
        this.activePointers = new Map();   // pointerId -> { x, y } in client coords
        this.pinching = false;
        this.pinchLastDist = 0;            // px between the two fingers, last sample
        this.pinchLastMid = null;          // { x, y } canvas-relative midpoint, last sample

        this.onclick = onclick;
        this.ontip = ontip;
        this.onUserMove = onUserMove;
        this.userMoved = false;

        // O(1) hover: biome id -> label.
        this.biomeIdToLabel = new Map(BIOMES.map(b => [b.value, b.label]));

        // When the worker pool is torn down (seed search / STOP), any in-flight
        // tile requests are lost - drop our bookkeeping and re-request on repaint.
        this._onQueueReset = () => {
            this.pending.clear();
            this._markDirty();
        };
        this.queue.addResetListener?.(this._onQueueReset);

        // Lightweight perf counters (read by the benchmark harness).
        this.stats = { renders: 0, tilesGenerated: 0, tilesStored: 0, renderMsTotal: 0 };
        if (exposeGlobal && typeof window !== 'undefined') window.__seederDrawer = this;

        this._preloadIcons();
        this._bindEvents();
        this._markDirty();
    }

    // Snapshot of counters + live cache/queue occupancy for benchmarking.
    getStats() {
        return {
            ...this.stats,
            tilesCached: this.tiles.size,
            pending: this.pending.size,
            pixDim: this.pixDim,
            queueAreaRequests: this.queue.stats?.areaRequests ?? 0,
            queueAreaDone: this.queue.stats?.areaDone ?? 0,
            workersLoaded: this.queue.workers?.length ?? 0,
            colorsReady: !!this.queue.COLORS,
        };
    }

    // ---- Public API (consumed by MapCanvas.jsx) ----------------------------

    clear() {
        this.spawnX = null;
        this.spawnZ = null;
        this.strongholds = null;
        this.structures = {};
        this.strongholdsShown = false;
        this.spawnShown = false;
        this.highlight = null;
        this.pin = null;
        this.panX = this.canvas.width / 2;
        this.panZ = this.canvas.height / 2;
        this._stopGlide();
        this._markDirty();
    }

    /*
     * Centre block (blockX, blockZ) in the viewport, at the current zoom. Animated
     * (PAN_MS, ease-out) unless `animate` is false or the user prefers reduced motion.
     * The animation runs on the glide's frame handle, glideRaf, so everything that
     * stops a glide - a drag, a zoom, an arrow press, clear(), destroy() - stops it too,
     * and "glideRaf == null" still means the map has come to rest.
     */
    panTo(blockX, blockZ, { animate = true } = {}) {
        this._stopGlide();
        const toX = this.canvas.width / 2 - (blockX / CELL_TO_BLOCK) * this.pixDim;
        const toZ = this.canvas.height / 2 - (blockZ / CELL_TO_BLOCK) * this.pixDim;
        if (!animate || prefersReducedMotion()) {
            this.panX = toX;
            this.panZ = toZ;
            this._markDirty();
            return;
        }
        const fromX = this.panX;
        const fromZ = this.panZ;
        let start = null;
        // `now` is the frame's timestamp, so the animation follows the frame clock.
        const step = (now) => {
            start ??= now;
            const t = Math.min(1, (now - start) / PAN_MS);
            const eased = 1 - (1 - t) ** 3;
            this.panX = fromX + (toX - fromX) * eased;
            this.panZ = fromZ + (toZ - fromZ) * eased;
            this._markDirty();
            if (t < 1) {
                this.glideRaf = requestAnimationFrame(step);
            } else {
                this.glideRaf = null;
                this.panning = false;
            }
        };
        this.panning = true;
        this.glideRaf = requestAnimationFrame(step);
    }

    /*
     * Mark one place on the map ({ x, z, label } in blocks), or remove the mark with
     * null. The mark is static - a pulse would keep the render loop running for ever -
     * and is drawn in every dimension, on top of every icon, with its label always
     * shown. clear() (a new seed, version or dimension) and destroy() remove it.
     */
    setHighlight(marker) {
        this.highlight = marker ? { x: marker.x, z: marker.z, label: marker.label } : null;
        this._markDirty();
    }

    // Remove the tapped place's tip (its close button).
    clearPin() {
        this.pin = null;
        this._emitTip();
    }

    setShowStructureCoords(value) {
        if (value !== this.showStructureCoords) {
            this.showStructureCoords = value;
            this._markDirty();
        }
    }

    /*
     * Switch a named overlay (OVERLAYS in overlays.js: 'slime', 'chunkGrid') on or off. On, it is
     * created for the current seed and repaints the map whenever its data lands; off, it
     * is destroyed with its cache and outstanding requests. clear() leaves overlays alone:
     * the toggle outlives a world change, and setSeed() re-targets its data.
     */
    setOverlay(name, on) {
        const current = this.overlays[name];
        if (on && !current && OVERLAYS[name]) {
            const overlay = new OVERLAYS[name](this.queue, { onReady: () => this._markDirty() });
            overlay.setSeed(this.seed);
            this.overlays[name] = overlay;
        } else if (!on && current) {
            current.destroy();
            delete this.overlays[name];
        }
        this._markDirty();
    }

    setSeed(seed) {
        this.seed = seed;
        for (const overlay of Object.values(this.overlays)) overlay.setSeed(seed);
    }
    setDimension(dimension) { this.dimension = dimension; }
    setYHeight(yHeight) { this.yHeight = yHeight; }
    setMcVersion(mcVersion) { this.mcVersion = mcVersion; }

    setStructuresShown(structTypes) {
        this.structuresShown = {};
        for (const structType of structTypes) {
            this.structuresShown[structType] = true;
        }
        this._markDirty();
    }

    // A "draw" is now just a repaint request; tiles stream in asynchronously and
    // the rAF loop composites whatever is cached, requesting anything missing.
    draw(callback = null) {
        this._markDirty();
        if (callback) requestAnimationFrame(() => callback());
    }

    // Icons are drawn every frame from the stored coords; this just forces a repaint.
    drawStructures() { this._markDirty(); }

    // `callback(seed, x, z)`, or `onError(error)` when the engine could not find it.
    findSpawn(callback, onError) {
        if (this.spawnX != null && this.spawnZ != null) {
            if (callback) callback(this.seed, this.spawnX, this.spawnZ);
            return;
        }
        this.queue.findSpawn(this.mcVersion, this.seed, (x, z) => {
            this.spawnX = x;
            this.spawnZ = z;
            this.spawnShown = true;
            this._markDirty();
            if (callback) callback(this.seed, this.spawnX, this.spawnZ);
        }, onError);
    }

    findStrongholds(callback) {
        if (this.strongholds?.length > 0) {
            if (callback) callback(this.seed, this.strongholds);
            return;
        }
        this.queue.findStrongholds(this.mcVersion, this.seed, 150, ({ coords }) => {
            this.strongholds = coords;
            this.strongholdsShown = true;
            this._markDirty();
            if (callback) callback(this.seed, this.strongholds);
        });
    }

    findStructure(structType, callback) {
        if (this.structures && this.structures[structType]?.length > 0) {
            if (callback) callback(this.seed, this.structures[structType]);
            this.structuresShown[structType] = true;
            this._markDirty();
            return;
        }
        this.queue.getStructuresInRegions(this.mcVersion, structType, this.seed, 50, this.dimension, ({ coords }) => {
            this.structures[structType] = coords;
            this.structuresShown[structType] = true;
            this._markDirty();
            if (callback) callback(this.seed, this.structures[structType]);
        });
    }

    zoom() { this._userMove(); this._setZoom(this.pixDim + 1, this.canvas.width / 2, this.canvas.height / 2); }
    dezoom() { this._userMove(); this._setZoom(this.pixDim - 1, this.canvas.width / 2, this.canvas.height / 2); }

    up() { this._nudge(0, ARROW_IMPULSE); }
    down() { this._nudge(0, -ARROW_IMPULSE); }
    left() { this._nudge(ARROW_IMPULSE, 0); }
    right() { this._nudge(-ARROW_IMPULSE, 0); }

    // Compatibility wrapper: biome + block coords from a DOM event.
    getBiomeAndPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return this._biomeAt(e.clientX - rect.left, e.clientY - rect.top);
    }

    destroy() {
        this._stopGlide();
        this.highlight = null;
        for (const overlay of Object.values(this.overlays)) overlay.destroy();
        this.overlays = {};
        if (this.rafId != null) cancelAnimationFrame(this.rafId);
        this.queue.removeResetListener?.(this._onQueueReset);
        this._unbindEvents();
        this.tiles.clear();
        // Only our own hook: a newer instance may already have taken it over.
        if (typeof window !== 'undefined' && window.__seederDrawer === this) delete window.__seederDrawer;
    }

    // ---- Zoom / pan --------------------------------------------------------

    // Zoom while keeping the world cell under (cx, cy) fixed on screen.
    _setZoom(newPix, cx, cy) {
        newPix = Math.max(1, Math.min(5, newPix));
        if (newPix === this.pixDim) return;
        this._stopGlide();
        const cellX = (cx - this.panX) / this.pixDim;
        const cellZ = (cy - this.panZ) / this.pixDim;
        this.pixDim = newPix;
        this.panX = cx - cellX * newPix;
        this.panZ = cy - cellZ * newPix;
        this._markDirty();
    }

    // The user moved the map (see opts.onUserMove): tell the page, the first time only.
    _userMove() {
        if (this.userMoved) return;
        this.userMoved = true;
        this.onUserMove?.();
    }

    _nudge(impulseX, impulseZ) {
        this._userMove();
        // An arrow press takes over from a panTo animation, like a drag does.
        if (this.panning) this._stopGlide();
        this.velX = this._clampVel(this.velX + impulseX);
        this.velZ = this._clampVel(this.velZ + impulseZ);
        this._ensureGlide();
    }

    _clampVel(v) {
        return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
    }

    _ensureGlide() {
        if (this.glideRaf != null) return;
        const step = () => {
            this.panX += this.velX;
            this.panZ += this.velZ;
            this.velX *= FRICTION;
            this.velZ *= FRICTION;
            this._markDirty();
            if (Math.hypot(this.velX, this.velZ) > MIN_VELOCITY) {
                this.glideRaf = requestAnimationFrame(step);
            } else {
                this.velX = 0;
                this.velZ = 0;
                this.glideRaf = null;
            }
        };
        this.glideRaf = requestAnimationFrame(step);
    }

    _stopGlide() {
        if (this.glideRaf != null) {
            cancelAnimationFrame(this.glideRaf);
            this.glideRaf = null;
        }
        this.panning = false;
        this.velX = 0;
        this.velZ = 0;
    }

    // ---- Render loop -------------------------------------------------------

    _markDirty() {
        this.dirty = true;
        if (this.rafId == null) {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null;
                this.dirty = false;
                this._render();
            });
        }
    }

    _render() {
        const ctx = this.ctx;
        if (!ctx) return;
        const t0 = performance.now();
        this.stats.renders++;
        const W = this.canvas.width;
        const H = this.canvas.height;
        const tileScreen = this.TILE * this.pixDim;

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, W, H); // CSS background (#333) shows through gaps

        if (this.seed == null) return;

        const txMin = Math.floor((0 - this.panX) / tileScreen);
        const txMax = Math.floor((W - this.panX) / tileScreen);
        const tzMin = Math.floor((0 - this.panZ) / tileScreen);
        const tzMax = Math.floor((H - this.panZ) / tileScreen);

        const missing = [];
        for (let tz = tzMin; tz <= tzMax; tz++) {
            for (let tx = txMin; tx <= txMax; tx++) {
                const key = this._tileKey(tx, tz);
                const tile = this.tiles.get(key);
                // Snap dest rect to integer px; make each edge meet the next tile's
                // snapped edge so fractional pans never leave seams.
                const dx = Math.round(tx * tileScreen + this.panX);
                const dy = Math.round(tz * tileScreen + this.panZ);
                const dw = Math.round((tx + 1) * tileScreen + this.panX) - dx;
                const dh = Math.round((tz + 1) * tileScreen + this.panZ) - dy;
                if (tile) {
                    // LRU touch
                    this.tiles.delete(key);
                    this.tiles.set(key, tile);
                    ctx.drawImage(tile.canvas, dx, dy, dw, dh);
                } else if (!this.pending.has(key)) {
                    missing.push({ tx, tz });
                }
            }
        }

        // Fill visible gaps center-out so the middle of the view resolves first.
        if (missing.length) {
            const cx = (txMin + txMax) / 2;
            const cz = (tzMin + tzMax) / 2;
            missing.sort((a, b) =>
                ((a.tx - cx) ** 2 + (a.tz - cz) ** 2) - ((b.tx - cx) ** 2 + (b.tz - cz) ** 2));
            for (const m of missing) this._requestTile(m.tx, m.tz);
        }

        // Over the biomes, under the icons and the highlight.
        this._drawOverlays(W, H);
        this._drawStructures();
        // After any pan, zoom, glide or new tile: the biome under a still mouse may have
        // changed, and the pin has moved with the map.
        this._emitTip();
        this.stats.renderMsTotal += performance.now() - t0;
    }

    _tileKey(tx, tz) {
        return this.mcVersion + '-' + this.seed + '-' + this.dimension + '-' + this.yHeight + '-' + tx + '-' + tz;
    }

    _requestTile(tx, tz) {
        if (this.seed == null) return;
        const key = this._tileKey(tx, tz);
        if (this.tiles.has(key) || this.pending.has(key)) return;
        this.pending.add(key);

        // Capture the params this request is for; tiles are content-addressed, so
        // the result is valid for those params even if the view changed meanwhile.
        const reqVer = this.mcVersion;
        const reqSeed = this.seed;
        const reqDim = this.dimension;
        const reqY = this.yHeight;
        const startX = tx * this.TILE;
        const startY = tz * this.TILE;

        this.stats.tilesGenerated++;
        this.queue.draw(reqVer, reqSeed, startX, startY, this.TILE, this.TILE, reqDim, reqY, ({ rgba, ids }) => {
            this.pending.delete(key);
            // Synchronously bake the tile into a small canvas (putImageData). Doing
            // this inline - rather than the async createImageBitmap - lets every
            // tile a worker delivers this frame become drawable in the same frame,
            // instead of trickling in one per frame.
            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = this.TILE;
            tileCanvas.height = this.TILE;
            tileCanvas.getContext('2d').putImageData(new ImageData(rgba, this.TILE, this.TILE), 0, 0);
            this.tiles.set(key, { canvas: tileCanvas, ids: Int16Array.from(ids) });
            this.stats.tilesStored++;
            this._enforceLruCap();
            // Only repaint if this tile is still for what's on screen.
            if (reqSeed === this.seed && reqVer === this.mcVersion &&
                reqDim === this.dimension && reqY === this.yHeight) {
                this._markDirty();
            }
        });
    }

    _enforceLruCap() {
        while (this.tiles.size > MAX_TILES) {
            const oldestKey = this.tiles.keys().next().value;
            this.tiles.delete(oldestKey);
        }
    }

    // ---- Structure overlays ------------------------------------------------

    _preloadIcons() {
        const markDirty = () => this._markDirty();
        const load = (src) => {
            const img = new Image();
            img.onload = markDirty;
            img.src = src;
            return img;
        };
        this.spawnIcon = load('/img/spawn.png');
        this.eyeIcon = load('/img/eye.png');
        this.icons = {};
        for (const key of Object.keys(STRUCTURE_ICONS)) {
            this.icons[key] = load(STRUCTURE_ICONS[key]);
        }
    }

    _blockToScreenX(block) { return (block / CELL_TO_BLOCK) * this.pixDim + this.panX; }
    _blockToScreenZ(block) { return (block / CELL_TO_BLOCK) * this.pixDim + this.panZ; }

    _drawStructures() {
        if (this.spawnShown && this.dimension === 0 && this.spawnX != null && this.spawnZ != null) {
            const drawX = this._blockToScreenX(this.spawnX);
            const drawZ = this._blockToScreenZ(this.spawnZ);
            // spawn icon is 32x30
            if (drawX > 0 && drawZ > 0 && drawX < this.canvas.width && drawZ < this.canvas.height) {
                this._drawIcon(this.spawnIcon, drawX - 16, drawZ - 15, 32, 30);
                this.drawText(`(${this.spawnX}, ${this.spawnZ})`, drawX, drawZ);
            }
        }

        if (this.strongholdsShown && this.dimension === 0 && this.strongholds && this.strongholds.length > 0) {
            for (const stronghold of this.strongholds) {
                const drawX = this._blockToScreenX(stronghold[0]);
                const drawZ = this._blockToScreenZ(stronghold[1]);
                if (drawX > 0 && drawZ > 0 && drawX < this.canvas.width && drawZ < this.canvas.height) {
                    this._drawIcon(this.eyeIcon, drawX - 15, drawZ - 15, 30, 30);
                    this.drawText(`(${stronghold[0]}, ${stronghold[1]})`, drawX, drawZ);
                }
            }
        }

        if (this.structuresShown) {
            for (const structureKey of Object.keys(this.structuresShown)) {
                const list = this.structures[structureKey];
                const icon = this.icons[structureKey];
                if (!list || !icon) continue;
                for (const structure of list) {
                    const drawX = this._blockToScreenX(structure[0]);
                    const drawZ = this._blockToScreenZ(structure[1]);
                    if (drawX > 0 && drawZ > 0 && drawX < this.canvas.width && drawZ < this.canvas.height) {
                        this._drawIcon(icon, drawX - 15, drawZ - 15, 30, 30);
                        this.drawText(`(${structure[0]}, ${structure[1]})`, drawX, drawZ);
                    }
                }
            }
        }

        // Last, so it stays on top of every icon.
        this._drawHighlight();
    }

    // An icon at (x, y) w × h once loaded; outlined when no coordinate label goes with it.
    _drawIcon(icon, x, y, w, h) {
        if (!icon.complete) return;
        if (this.showStructureCoords) {
            this.ctx.drawImage(icon, x, y, w, h);
            return;
        }
        const o = ICON_OUTLINE_PX;
        this.ctx.drawImage(outlinedIcon(icon, w, h), x - o, y - o, w + 2 * o, h + 2 * o);
    }

    // Coordinate labels follow showStructureCoords; `always` is for the highlight's label.
    drawText(text, x, z, { always = false } = {}) {
        if (this.showStructureCoords || always) {
            this.ctx.font = "bold 10px Minecraft";
            this.ctx.textAlign = "center";
            this.ctx.fillStyle = "#ffffffbb";
            const textWidth = this.ctx.measureText(text).width;
            this.ctx.fillRect(x - textWidth / 2 - 1, z + 20, textWidth + 1, 12);

            this.ctx.fillStyle = "black";
            this.ctx.fillText(text, x, z + 30);
        }
    }

    // ---- Overlays ----------------------------------------------------------

    _drawOverlays(W, H) {
        const view = { seed: this.seed, dimension: this.dimension, panX: this.panX, panZ: this.panZ, pixDim: this.pixDim, W, H };
        // OVERLAYS' order, whatever order they were switched on in.
        for (const name of Object.keys(OVERLAYS)) this.overlays[name]?.draw(this.ctx, view);
    }

    // ---- Highlight ---------------------------------------------------------

    _drawHighlight() {
        const marker = this.highlight;
        if (!marker) return;
        const drawX = this._blockToScreenX(marker.x);
        const drawZ = this._blockToScreenZ(marker.z);
        if (!(drawX > 0 && drawZ > 0 && drawX < this.canvas.width && drawZ < this.canvas.height)) return;
        const ctx = this.ctx;
        // Whole pixels, so the pin stays crisp wherever the pan leaves the block.
        const tipX = Math.round(drawX);
        const tipZ = Math.round(drawZ);
        ctx.fillStyle = PIN_SHADOW.color;
        ctx.beginPath();
        ctx.ellipse(tipX, tipZ, PIN_SHADOW.rx, PIN_SHADOW.rz, 0, 0, 2 * Math.PI);
        ctx.fill();
        const { scale, size, rects } = HIGHLIGHT_PIN;
        const left = tipX - (size / 2) * scale;
        const top = tipZ - size * scale;
        for (const [color, runs] of rects) {
            ctx.fillStyle = color;
            for (const [x, y, w, h] of runs) ctx.fillRect(left + x * scale, top + y * scale, w * scale, h * scale);
        }
        // drawText puts its box 20-32 px below the anchor: this lifts it just above the pin's head.
        if (marker.label) this.drawText(marker.label, tipX, top - PIN_LABEL_GAP - 32, { always: true });
    }

    // ---- Hit testing and the tip -----------------------------------------------

    // The biome id of world cell (cx, cz) from the cached tiles, or null (no tile yet).
    _biomeIdAt(cx, cz) {
        const tx = Math.floor(cx / this.TILE);
        const tz = Math.floor(cz / this.TILE);
        const tile = this.tiles.get(this._tileKey(tx, tz));
        if (!tile || !tile.ids) return null;
        const id = tile.ids[(cz - tz * this.TILE) * this.TILE + (cx - tx * this.TILE)];
        return this.biomeIdToLabel.has(id) ? id : null;
    }

    _biomeAt(x, y) {
        const cx = Math.floor((x - this.panX) / this.pixDim);
        const cz = Math.floor((y - this.panZ) / this.pixDim);
        const id = this._biomeIdAt(cx, cz);
        if (id == null) return [null, null, null];
        return [CELL_TO_BLOCK * cx, CELL_TO_BLOCK * cz, this.biomeIdToLabel.get(id)];
    }

    // The mouse's tip: hidden while the map is dragged or pinched, and over unloaded tiles.
    _hoverTip() {
        const p = this.hover;
        if (!p || this.pinching || (this.dragging && this.moved)) return null;
        const cx = Math.floor((p.x - this.panX) / this.pixDim);
        const cz = Math.floor((p.y - this.panZ) / this.pixDim);
        const id = this._biomeIdAt(cx, cz);
        if (id == null) return null;
        return { x: CELL_TO_BLOCK * cx, z: CELL_TO_BLOCK * cz, biome: this.biomeIdToLabel.get(id), id, left: p.x, top: p.y };
    }

    // The pin's tip, where the tapped point is now; hidden while it is off the canvas.
    _pinTip() {
        const pin = this.pin;
        if (!pin) return null;
        const left = pin.cellX * this.pixDim + this.panX;
        const top = pin.cellZ * this.pixDim + this.panZ;
        if (left < 0 || top < 0 || left >= this.canvas.width || top >= this.canvas.height) return null;
        // Another Y layer can hold another biome there: re-read it once that tile is in.
        const id = this._biomeIdAt(Math.floor(pin.cellX), Math.floor(pin.cellZ));
        if (id != null && id !== pin.id) Object.assign(pin, { id, biome: this.biomeIdToLabel.get(id) });
        return { x: pin.x, z: pin.z, biome: pin.biome, id: pin.id, left, top };
    }

    // Pin the biome under canvas point (x, y), if its tile is in.
    _pinAt(x, y) {
        const cellX = (x - this.panX) / this.pixDim;
        const cellZ = (y - this.panZ) / this.pixDim;
        const id = this._biomeIdAt(Math.floor(cellX), Math.floor(cellZ));
        if (id == null) return;
        this.pin = {
            cellX, cellZ, id, biome: this.biomeIdToLabel.get(id),
            x: CELL_TO_BLOCK * Math.floor(cellX), z: CELL_TO_BLOCK * Math.floor(cellZ),
        };
    }

    /*
     * Tell the page what to show next to the map: `hover`, the biome under a mouse or pen
     * pointer, and `pin`, the place a finger tapped (touch screens have no hover). Each is
     * { x, z, biome, id, left, top } - blocks, the biome's id and label, canvas px - or
     * null. Only when something changed, so a still pointer costs the page nothing.
     */
    _emitTip() {
        if (!this.ontip) return;
        const tip = { hover: this._hoverTip(), pin: this._pinTip() };
        if (sameTip(tip.hover, this.lastTip.hover) && sameTip(tip.pin, this.lastTip.pin)) return;
        this.lastTip = tip;
        this.ontip(tip);
    }

    // ---- Pointer / wheel input --------------------------------------------

    _bindEvents() {
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onContextMenu = (e) => e.preventDefault();

        // The cursor is CSS's (MapCanvas.css): a crosshair, "grabbing" while data-dragging is set.
        this.canvas.style.touchAction = 'none';
        this.canvas.style.userSelect = 'none';

        this.canvas.addEventListener('pointerdown', this._onPointerDown);
        this.canvas.addEventListener('pointermove', this._onPointerMove);
        this.canvas.addEventListener('pointerup', this._onPointerUp);
        this.canvas.addEventListener('pointercancel', this._onPointerUp);
        this.canvas.addEventListener('pointerleave', this._onPointerLeave);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    }

    _unbindEvents() {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
        this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
        this.canvas.removeEventListener('wheel', this._onWheel);
    }

    // Begin a single-finger drag from a pointer's current client position and the
    // current pan (no jump). Reused both on first-finger-down and when a pinch ends
    // with one finger still on the map.
    _beginDragFrom(id, clientPos, t) {
        this._stopGlide();
        this.dragging = true;
        this.moved = false;
        this.pointerId = id;
        this.dragStartClientX = clientPos.x;
        this.dragStartClientY = clientPos.y;
        this.dragStartPanX = this.panX;
        this.dragStartPanZ = this.panZ;
        this.velSamples = [{ t, x: clientPos.x, y: clientPos.y }];
        this.canvas.dataset.dragging = '';
    }

    _endDrag() {
        this.dragging = false;
        delete this.canvas.dataset.dragging;
    }

    // Canvas-relative position of a pointer event.
    _local(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onPointerDown(e) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
        // A tap may come without any move: the release must not read an older position.
        this.lastPointer = this._local(e);

        if (this.activePointers.size === 1) {
            this._beginDragFrom(e.pointerId, { x: e.clientX, y: e.clientY }, e.timeStamp);
        } else {
            // Second (or more) finger down -> pinch. Abort any single-finger drag
            // without flicking or clicking, and let the next move seed the baseline.
            this._stopGlide();
            this.dragging = false;
            this.moved = false;
            this.pinching = true;
            this.pinchLastMid = null;
            this.pinchLastDist = 0;
        }
    }

    _onPointerMove(e) {
        if (this.activePointers.has(e.pointerId)) {
            this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        const rect = this.canvas.getBoundingClientRect();
        this.lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        // A finger has no hover: it pans, and its taps pin a place instead.
        this.hover = e.pointerType === 'touch' ? null : this.lastPointer;

        if (this.pinching) {
            this._pinchMove(rect);
            return; // no hover / single-finger pan while pinching
        }

        if (this.dragging) {
            const dx = e.clientX - this.dragStartClientX;
            const dz = e.clientY - this.dragStartClientY;
            if (!this.moved && Math.hypot(dx, dz) > CLICK_THRESHOLD) {
                this.moved = true;
                this._userMove();
            }
            if (this.moved) {
                this.panX = this.dragStartPanX + dx;
                this.panZ = this.dragStartPanZ + dz;
                this.velSamples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
                if (this.velSamples.length > 6) this.velSamples.shift();
                this._markDirty();
            }
        }
        this._emitTip();
    }

    // Two-finger pinch: zoom about the finger midpoint (fractional scale) while also
    // panning by however the midpoint itself moves. Anchored so the world cell under
    // the midpoint stays put.
    _pinchMove(rect) {
        const it = this.activePointers.values();
        const a = it.next().value;
        const b = it.next().value;
        if (!a || !b) return;
        const ax = a.x - rect.left, ay = a.y - rect.top;
        const bx = b.x - rect.left, by = b.y - rect.top;
        const dist = Math.hypot(bx - ax, by - ay);
        const mid = { x: (ax + bx) / 2, y: (ay + by) / 2 };

        if (!this.pinchLastMid || this.pinchLastDist <= 0) {
            this.pinchLastMid = mid;
            this.pinchLastDist = dist;
            return;
        }

        this._userMove();
        // Pan by midpoint movement.
        this.panX += mid.x - this.pinchLastMid.x;
        this.panZ += mid.y - this.pinchLastMid.y;
        // Zoom about the midpoint, fractional, clamped to the existing 1..5 range.
        const newPix = Math.max(1, Math.min(5, this.pixDim * (dist / this.pinchLastDist)));
        const cellX = (mid.x - this.panX) / this.pixDim; // OLD pixDim
        const cellZ = (mid.y - this.panZ) / this.pixDim;
        this.pixDim = newPix;
        this.panX = mid.x - cellX * newPix;
        this.panZ = mid.y - cellZ * newPix;

        this.pinchLastDist = dist;
        this.pinchLastMid = mid;
        this._markDirty();
    }

    _onPointerUp(e) {
        this.activePointers.delete(e.pointerId);
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }

        if (this.pinching) {
            // Still two+ fingers down: reseed the baseline from the remaining pair.
            if (this.activePointers.size >= 2) {
                this.pinchLastMid = null;
                this.pinchLastDist = 0;
                return;
            }
            // Dropping below two fingers -> leave pinch. Snap to the nearest whole
            // zoom level, re-anchored at the last midpoint, so the map rests crisp.
            this.pinching = false;
            if (this.pinchLastMid) {
                this._setZoom(Math.round(this.pixDim), this.pinchLastMid.x, this.pinchLastMid.y);
            }
            if (this.activePointers.size === 1) {
                // Hand off to a single-finger drag so continued panning is smooth and
                // the eventual lift is treated as a drag, not a stray biome click.
                const [id, p] = this.activePointers.entries().next().value;
                this._beginDragFrom(id, p, e.timeStamp);
                this.moved = true;
            } else {
                this._endDrag();
            }
            return;
        }

        if (!this.dragging) return;
        this._endDrag();

        if (this.moved) {
            this._flick(e.timeStamp);
        } else if (this.lastPointer) {
            const [x, z, biome] = this._biomeAt(this.lastPointer.x, this.lastPointer.y);
            if (biome) {
                // A tap pins the place (a new tap moves the pin); a mouse click only clicks.
                if (e.pointerType === 'touch') this._pinAt(this.lastPointer.x, this.lastPointer.y);
                this.onclick?.(x, z, biome);
            }
        }
        this.moved = false;
        this.pointerId = null;
        // The mouse's tip comes back after a drag; a tap's pin shows at once.
        this._emitTip();
    }

    _onPointerLeave() {
        this.lastPointer = null;
        this.hover = null;
        this._emitTip();
    }

    // Launch inertial glide from the recent pointer-move velocity - unless the pointer
    // rested before the release, as when the user drags, stops, then lets go.
    _flick(endTime) {
        const s = this.velSamples;
        if (s.length && endTime - s[s.length - 1].t > REST_MS) {
            this._stopGlide();
            return;
        }
        if (s.length >= 2) {
            const last = s[s.length - 1];
            let first = s[0];
            for (let i = s.length - 1; i >= 0; i--) {
                first = s[i];
                if (last.t - s[i].t >= 40) break; // ~one or two frames of samples
            }
            const dt = last.t - first.t;
            if (dt > 0) {
                // convert px/ms to px/frame (~16.7ms), matching the glide step cadence
                this.velX = this._clampVel((last.x - first.x) / dt * 16.7);
                this.velZ = this._clampVel((last.y - first.y) / dt * 16.7);
            }
        }
        if (Math.hypot(this.velX, this.velZ) >= MIN_VELOCITY) this._ensureGlide();
        else this._stopGlide();
    }

    _onWheel(e) {
        e.preventDefault();
        this._userMove();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this._setZoom(this.pixDim + (e.deltaY < 0 ? 1 : -1), mx, my);
    }
}
