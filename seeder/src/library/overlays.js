// Map overlays: extra layers DrawSeed paints between its biome tiles and its icons.

// Chunks per edge of one SLIME_CHUNKS request: the engine's maximum (w, h <= 64), so a
// 1280x800 canvas at zoom 1 needs ~20 requests, not ~80.
export const BLOCK = 64;
// Cached blocks (64x64 bytes each, so ~1 MB); the oldest leaves first.
export const CACHE_MAX = 256;
// --color-slime in tokens.css. A canvas cannot read CSS custom properties, so the value
// is repeated here.
export const SLIME_COLOR = 'rgba(90, 200, 90, .45)';
// The 1 px inset outline that separates neighbouring slime chunks once they are big enough.
export const SLIME_BORDER = 'rgba(30, 120, 30, .6)';
// A chunk is 4 biome cells (16 blocks) of pixDim screen px each.
const CELLS_PER_CHUNK = 4;
// Below this a chunk is a speck (cannot happen at zoom >= 1; the guard stays).
const MIN_CHUNK_PX = 3;
// From this size a chunk gets its outline.
const BORDER_FROM_PX = 8;

/*
 * The chunks a view covers, inclusive, in chunk coordinates: the same floor maths as
 * DrawSeed's tile range, with a chunk of 4 * pixDim px instead of a 75-cell tile.
 */
export function visibleChunks({ panX, panZ, pixDim, W, H }) {
    const chunkPx = CELLS_PER_CHUNK * pixDim;
    return {
        cxMin: Math.floor((0 - panX) / chunkPx),
        cxMax: Math.floor((W - panX) / chunkPx),
        czMin: Math.floor((0 - panZ) / chunkPx),
        czMax: Math.floor((H - panZ) / chunkPx),
    };
}

/*
 * The slime-chunk grid: translucent squares over the chunks where slimes spawn below
 * Y 40. Overworld only, whatever the version; the data depends on the seed alone.
 *
 * Data comes in blocks of BLOCK x BLOCK chunks, block (bx, bz) covering chunks
 * bx*BLOCK .. bx*BLOCK+BLOCK-1 (same for z): one low-priority SLIME_CHUNKS request each,
 * all with this overlay's own token, so a new seed (setSeed) or destroy() drops every
 * outstanding one at once and never touches another caller's requests.
 *
 *   cache    Map "seed:bx:bz" -> Uint8Array(BLOCK * BLOCK), cells[dz * BLOCK + dx] = 1
 *            for a slime chunk; at most CACHE_MAX blocks, oldest evicted.
 *   pending  Set of the keys asked for and not answered yet. Public: nothing else tells
 *            the outside world (the e2e tests) that the grid is complete, since
 *            the tile counters DrawSeed exposes never see these requests.
 *   onReady  called when a block lands, so the map repaints.
 *
 * A cancelled or failed request just leaves `pending`; the next frame that needs the
 * block asks again.
 */
export class SlimeOverlay {
    constructor(queue, { onReady } = {}) {
        this.queue = queue;
        this.onReady = onReady;
        this.seed = null;
        this.cache = new Map();
        this.pending = new Set();
        this.token = Symbol('slime');
        // Bumped by setSeed/destroy: an answer to an older generation is ignored even
        // if it arrives before its cancellation does.
        this.generation = 0;
    }

    // A new world: nothing cached or asked for belongs to it any more.
    setSeed(seed) {
        this._reset();
        this.seed = seed;
    }

    destroy() {
        this._reset();
        this.seed = null;
    }

    _reset() {
        this.generation++;
        this.queue.cancelToken(this.token);
        this.cache.clear();
        this.pending.clear();
    }

    _key(seed, bx, bz) {
        return `${seed}:${bx}:${bz}`;
    }

    // Ask for block (bx, bz) of `seed` unless it is cached or already on its way.
    ensure(seed, bx, bz) {
        const key = this._key(seed, bx, bz);
        if (this.cache.has(key) || this.pending.has(key)) return;
        this.pending.add(key);
        const generation = this.generation;
        const data = { seed, cx0: bx * BLOCK, cz0: bz * BLOCK, w: BLOCK, h: BLOCK };
        this.queue.request('SLIME_CHUNKS', data, { priority: 'low', token: this.token }).then((reply) => {
            if (generation !== this.generation) return;
            this.pending.delete(key);
            if (reply?.error || !reply?.cells) return;
            this.cache.set(key, reply.cells);
            while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
            this.onReady?.();
        }, () => {
            if (generation === this.generation) this.pending.delete(key);
        });
    }

    /*
     * Paint the slime chunks of the view, `view` = { seed, dimension, panX, panZ, pixDim,
     * W, H } (DrawSeed's state; pan = screen px of world cell (0, 0)). Asks for the
     * blocks it has not got. Rects are snapped to whole pixels exactly like the tiles
     * (each edge where the next chunk's snapped edge starts), so the grid has no seams
     * while panning and lands on the chunk borders of the biome cells underneath.
     */
    draw(ctx, view) {
        const { seed, dimension, panX, panZ, pixDim } = view;
        if (dimension !== 0 || seed == null) return;
        const chunkPx = CELLS_PER_CHUNK * pixDim;
        if (chunkPx < MIN_CHUNK_PX) return;
        const { cxMin, cxMax, czMin, czMax } = visibleChunks(view);
        const border = chunkPx >= BORDER_FROM_PX;
        const outlines = border ? [] : null;

        ctx.fillStyle = SLIME_COLOR;
        for (let bz = Math.floor(czMin / BLOCK); bz <= Math.floor(czMax / BLOCK); bz++) {
            for (let bx = Math.floor(cxMin / BLOCK); bx <= Math.floor(cxMax / BLOCK); bx++) {
                const key = this._key(seed, bx, bz);
                const cells = this.cache.get(key);
                if (!cells) {
                    this.ensure(seed, bx, bz);
                    continue;
                }
                // LRU touch: what is on screen is the last thing to evict.
                this.cache.delete(key);
                this.cache.set(key, cells);
                const x0 = bx * BLOCK;
                const z0 = bz * BLOCK;
                for (let cz = Math.max(czMin, z0); cz <= Math.min(czMax, z0 + BLOCK - 1); cz++) {
                    const row = (cz - z0) * BLOCK - x0;
                    const dy = Math.round(cz * chunkPx + panZ);
                    const dh = Math.round((cz + 1) * chunkPx + panZ) - dy;
                    for (let cx = Math.max(cxMin, x0); cx <= Math.min(cxMax, x0 + BLOCK - 1); cx++) {
                        if (cells[row + cx] !== 1) continue;
                        const dx = Math.round(cx * chunkPx + panX);
                        const dw = Math.round((cx + 1) * chunkPx + panX) - dx;
                        ctx.fillRect(dx, dy, dw, dh);
                        if (outlines) outlines.push(dx, dy, dw, dh);
                    }
                }
            }
        }
        if (outlines?.length) {
            // Half-pixel offsets put a 1 px line exactly on the rect's outermost pixels.
            ctx.strokeStyle = SLIME_BORDER;
            ctx.lineWidth = 1;
            for (let i = 0; i < outlines.length; i += 4) {
                ctx.strokeRect(outlines[i] + 0.5, outlines[i + 1] + 0.5, outlines[i + 2] - 1, outlines[i + 3] - 1);
            }
        }
    }
}

// The chunk grid's lines. A canvas cannot read CSS custom properties; this light line
// shows on the dark oceans and the Nether's reds alike without hiding the biome colours.
export const GRID_COLOR = 'rgba(255, 255, 255, .35)';
// Below this zoom a chunk is 4-8 px and the lines would hide the map (from zoom 3 a
// chunk is 12 px).
export const GRID_FROM_PIXDIM = 3;

/*
 * Chunk grid lines: a 1 px line on the first pixel column / row of every chunk, from
 * zoom 3, in every dimension. Snapped like the tiles and the slime squares, so a line
 * lands exactly on a slime square's edge. Pure geometry: nothing to fetch.
 */
export class ChunkGridOverlay {
    constructor() {
        this.seed = null;
    }

    setSeed(seed) { this.seed = seed; }

    destroy() { }

    draw(ctx, view) {
        const { seed, panX, panZ, pixDim, W, H } = view;
        if (seed == null || pixDim < GRID_FROM_PIXDIM) return;
        const chunkPx = CELLS_PER_CHUNK * pixDim;
        const { cxMin, cxMax, czMin, czMax } = visibleChunks(view);
        ctx.fillStyle = GRID_COLOR;
        for (let cx = cxMin; cx <= cxMax; cx++) {
            const x = Math.round(cx * chunkPx + panX);
            if (x >= 0 && x < W) ctx.fillRect(x, 0, 1, H);
        }
        for (let cz = czMin; cz <= czMax; cz++) {
            const z = Math.round(cz * chunkPx + panZ);
            if (z >= 0 && z < H) ctx.fillRect(0, z, W, 1);
        }
    }
}

// Overlays DrawSeed.setOverlay(name, …) can create, by name, in drawing order: the grid
// goes over the slime squares.
export const OVERLAYS = { slime: SlimeOverlay, chunkGrid: ChunkGridOverlay };
