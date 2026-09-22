import { BIOMES } from '../util/constants';

// One biome cell = 4 blocks (world-gen is generated at scale 1:4).
const CELL_TO_BLOCK = 4;
// Movement (in screen px) before a press is treated as a drag rather than a click.
const CLICK_THRESHOLD = 4;
// Per-frame velocity decay used for both flick-inertia and keyboard/button glide.
const FRICTION = 0.92;
// Velocity (px/frame) below which a glide stops.
const MIN_VELOCITY = 0.05;
// Clamp on glide velocity so a violent flick can't teleport the map.
const MAX_VELOCITY = 60;
// Velocity impulse (px/frame) added per arrow-key / arrow-button press.
const ARROW_IMPULSE = 14;
// Upper bound on cached tiles (LRU). Each tile is a 75x75 canvas (~22KB) + an
// Int16 biome-id array (~11KB) ≈ 34KB, so 1500 tiles ≈ ~50MB — enough history
// to wander several screens and return without regenerating.
const MAX_TILES = 1500;

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

export class DrawSeed {
    constructor(mcVersion, queue, canvas, onclick, onmousemove, drawDim, pixDim) {
        this.mcVersion = mcVersion;
        this.dimension = 0; // Overworld
        this.yHeight = 320; // Top of the world
        this.queue = queue;
        this.canvas = canvas;
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
        this.lastPointer = null;   // last hover position, canvas-relative { x, y }

        // Multi-touch / pinch state.
        this.activePointers = new Map();   // pointerId -> { x, y } in client coords
        this.pinching = false;
        this.pinchLastDist = 0;            // px between the two fingers, last sample
        this.pinchLastMid = null;          // { x, y } canvas-relative midpoint, last sample

        this.onclick = onclick;
        this.onmousemove = onmousemove;

        // O(1) hover: biome id -> label.
        this.biomeIdToLabel = new Map(BIOMES.map(b => [b.value, b.label]));

        // When the worker pool is torn down (seed search / STOP), any in-flight
        // tile requests are lost — drop our bookkeeping and re-request on repaint.
        this._onQueueReset = () => {
            this.pending.clear();
            this._markDirty();
        };
        this.queue.addResetListener?.(this._onQueueReset);

        // Lightweight perf counters (read by the benchmark harness).
        this.stats = { renders: 0, tilesGenerated: 0, tilesStored: 0, renderMsTotal: 0 };
        if (typeof window !== 'undefined') window.__seederDrawer = this;

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

    // ---- Public API (consumed by Seeder.js) --------------------------------

    clear() {
        this.spawnX = null;
        this.spawnZ = null;
        this.strongholds = null;
        this.structures = {};
        this.strongholdsShown = false;
        this.spawnShown = false;
        this.panX = this.canvas.width / 2;
        this.panZ = this.canvas.height / 2;
        this._stopGlide();
        this._markDirty();
    }

    setShowStructureCoords(value) {
        if (value !== this.showStructureCoords) {
            this.showStructureCoords = value;
            this._markDirty();
        }
    }

    setSeed(seed) { this.seed = seed; }
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

    findSpawn(callback) {
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
        });
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

    zoom() { this._setZoom(this.pixDim + 1, this.canvas.width / 2, this.canvas.height / 2); }
    dezoom() { this._setZoom(this.pixDim - 1, this.canvas.width / 2, this.canvas.height / 2); }

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
        if (this.rafId != null) cancelAnimationFrame(this.rafId);
        this.queue.removeResetListener?.(this._onQueueReset);
        this._unbindEvents();
        this.tiles.clear();
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

    _nudge(impulseX, impulseZ) {
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
        const t0 = performance.now();
        this.stats.renders++;
        const ctx = this.ctx;
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

        this._drawStructures();
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
            // this inline — rather than the async createImageBitmap — lets every
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
                if (this.spawnIcon.complete) this.ctx.drawImage(this.spawnIcon, drawX - 16, drawZ - 15, 32, 30);
                this.drawText(`(${this.spawnX}, ${this.spawnZ})`, drawX, drawZ);
            }
        }

        if (this.strongholdsShown && this.dimension === 0 && this.strongholds && this.strongholds.length > 0) {
            for (const stronghold of this.strongholds) {
                const drawX = this._blockToScreenX(stronghold[0]);
                const drawZ = this._blockToScreenZ(stronghold[1]);
                if (drawX > 0 && drawZ > 0 && drawX < this.canvas.width && drawZ < this.canvas.height) {
                    if (this.eyeIcon.complete) this.ctx.drawImage(this.eyeIcon, drawX - 15, drawZ - 15, 30, 30);
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
                        if (icon.complete) this.ctx.drawImage(icon, drawX - 15, drawZ - 15, 30, 30);
                        this.drawText(`(${structure[0]}, ${structure[1]})`, drawX, drawZ);
                    }
                }
            }
        }
    }

    drawText(text, x, z) {
        if (this.showStructureCoords) {
            this.ctx.font = "bold 10px Minecraft";
            this.ctx.textAlign = "center";
            this.ctx.fillStyle = "#ffffffbb";
            const textWidth = this.ctx.measureText(text).width;
            this.ctx.fillRect(x - textWidth / 2 - 1, z + 20, textWidth + 1, 12);

            this.ctx.fillStyle = "black";
            this.ctx.fillText(text, x, z + 30);
        }
    }

    // ---- Hover -------------------------------------------------------------

    _biomeAt(x, y) {
        const cx = Math.floor((x - this.panX) / this.pixDim);
        const cz = Math.floor((y - this.panZ) / this.pixDim);
        const tx = Math.floor(cx / this.TILE);
        const tz = Math.floor(cz / this.TILE);
        const tile = this.tiles.get(this._tileKey(tx, tz));
        if (tile && tile.ids) {
            const lx = cx - tx * this.TILE;
            const lz = cz - tz * this.TILE;
            const id = tile.ids[lz * this.TILE + lx];
            const label = this.biomeIdToLabel.get(id);
            if (label) return [CELL_TO_BLOCK * cx, CELL_TO_BLOCK * cz, label];
        }
        return [null, null, null];
    }

    _emitHover() {
        if (!this.onmousemove || !this.lastPointer) return;
        const [x, z, biome] = this._biomeAt(this.lastPointer.x, this.lastPointer.y);
        if (biome) this.onmousemove(x, z, biome);
    }

    // ---- Pointer / wheel input --------------------------------------------

    _bindEvents() {
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onContextMenu = (e) => e.preventDefault();

        this.canvas.style.cursor = 'grab';
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
        this.canvas.style.cursor = 'grabbing';
    }

    _onPointerDown(e) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }

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

        if (this.pinching) {
            this._pinchMove(rect);
            return; // no hover / single-finger pan while pinching
        }

        if (this.dragging) {
            const dx = e.clientX - this.dragStartClientX;
            const dz = e.clientY - this.dragStartClientY;
            if (!this.moved && Math.hypot(dx, dz) > CLICK_THRESHOLD) this.moved = true;
            if (this.moved) {
                this.panX = this.dragStartPanX + dx;
                this.panZ = this.dragStartPanZ + dz;
                this.velSamples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
                if (this.velSamples.length > 6) this.velSamples.shift();
                this._markDirty();
            }
        }
        this._emitHover();
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
                this.dragging = false;
                this.canvas.style.cursor = 'grab';
            }
            return;
        }

        if (!this.dragging) return;
        this.dragging = false;
        this.canvas.style.cursor = 'grab';

        if (this.moved) {
            this._flick(e.timeStamp);
        } else if (this.onclick && this.lastPointer) {
            const [x, z, biome] = this._biomeAt(this.lastPointer.x, this.lastPointer.y);
            if (biome) this.onclick(x, z, biome);
        }
        this.moved = false;
        this.pointerId = null;
    }

    _onPointerLeave() {
        this.lastPointer = null;
    }

    // Launch inertial glide from the recent pointer-move velocity.
    _flick(endTime) {
        const s = this.velSamples;
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
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this._setZoom(this.pixDim + (e.deltaY < 0 ? 1 : -1), mx, my);
    }
}
