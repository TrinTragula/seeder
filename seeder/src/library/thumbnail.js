// Finder result-row thumbnails: a biome area centred on the row's preview block, 1 px
// per cell like the map at zoom 1, with the hit's structures marked. The opened row's
// map starts on the same block, so the thumbnail is its first frame.

import { ICON_OUTLINE_PX, STRUCTURE_ICONS, outlinedIcon } from './draw';

export const THUMB_CELLS = 128;          // default cells per side when a spec names no size
export const THUMB_SCALE = 1;            // canvas px per biome cell (a cell is 4 blocks), = MapCanvas zoom 1
export const THUMB_MAX_CELLS = 2048;     // per side: a guard, a row is at most ~906 px wide
export const THUMB_STRIP_CELLS = 64;     // rows per engine request (906 × 64 ≈ 0.15 s on 26.3)
export const THUMB_CACHE_MAX = 30;       // rendered canvases kept (oldest evicted; ~1.7 MB each at 900×480)
// A structure is marked with its map icon, drawn as DrawSeed draws it without a label
// (30 px, centred, in its black outline).
export const MARKER_ICON_PX = 30;
// The fallback for a type without an icon (or one that failed to load): --color-accent in
// tokens.css (a canvas cannot read CSS custom properties). A 6 px accent square in a 1 px
// black frame: a bare 4 px square vanished on desert and savanna colours.
export const MARKER_COLOR = '#ff8c00';
export const MARKER_PX = 6;
export const MARKER_BORDER_COLOR = '#000';
export const MARKER_BORDER_PX = 1;

// One decoded image per icon, shared by every requester. A missing or broken icon is null.
const icons = new Map();
const iconOf = (type) => {
    const src = STRUCTURE_ICONS[type];
    if (!src) return Promise.resolve(null);
    if (!icons.has(src)) {
        const img = new Image();
        img.src = src;
        icons.set(src, img.decode().then(() => img, () => null));
    }
    return icons.get(src);
};

const cellsOf = (n) => {
    const cells = Math.floor(n ?? THUMB_CELLS);
    return Number.isNaN(cells) ? THUMB_CELLS : Math.min(THUMB_MAX_CELLS, Math.max(1, cells));
};
// The area of a spec: widthCells × heightCells centred on block (centreX, centreZ),
// the origin by default (cell 0 is block 0). Rounded the way DrawSeed.panTo places a
// block at its canvas' centre, so the thumbnail and the opened map line up.
export const areaOf = (spec) => {
    const widthX = cellsOf(spec.widthCells);
    const widthY = cellsOf(spec.heightCells);
    const { centreX = 0, centreZ = 0 } = spec;
    return {
        startX: Math.round(centreX / 4 - widthX / 2),
        startY: Math.round(centreZ / 4 - widthY / 2),
        widthX, widthY,
    };
};

// The area as horizontal strips of THUMB_STRIP_CELLS rows: requested side by side on
// the pool's spare workers (`wide`), so a ~1 s thumbnail takes a fraction of that, and a
// map tile never waits behind more than one short strip.
const stripsOf = ({ startX, startY, widthX, widthY }) => {
    const strips = [];
    for (let row = 0; row < widthY; row += THUMB_STRIP_CELLS) {
        strips.push({ row, startX, startY: startY + row, widthX, widthY: Math.min(THUMB_STRIP_CELLS, widthY - row) });
    }
    return strips;
};

// One thumbnail per world, size and marker set. The markers are part of the key because
// the same seed found by other criteria marks other structures.
export const thumbKey = (spec) => {
    const { mcVersion, seed, dimension = 0, yHeight = 256, markers = [] } = spec;
    const { startX, startY, widthX, widthY } = areaOf(spec);
    return `${mcVersion}:${seed}:${dimension}:${yHeight}:${startX},${startY}:${widthX}x${widthY}:${markers.map((m) => `${m.type}@${m.x},${m.z}`).join(';')}`;
};

function render(rgba, { startX, startY, widthX, widthY }, markers, markerIcons, doc) {
    const small = doc.createElement('canvas');
    small.width = widthX;
    small.height = widthY;
    const pixels = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    small.getContext('2d').putImageData(new ImageData(pixels, widthX, widthY), 0, 0);

    const canvas = doc.createElement('canvas');
    canvas.width = widthX * THUMB_SCALE;
    canvas.height = widthY * THUMB_SCALE;
    const ctx = canvas.getContext('2d');
    // Nearest-neighbour: at any THUMB_SCALE above 1 a biome cell stays a crisp square.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    const outer = MARKER_PX + 2 * MARKER_BORDER_PX;
    // Block -> pixel: a cell is 4 blocks, and the area starts at cell startX / startY.
    const toPixel = (block, start) => (block / 4 - start) * THUMB_SCALE;
    markers.forEach(({ x, z }, i) => {
        const px = Math.round(toPixel(x, startX));
        const pz = Math.round(toPixel(z, startY));
        // A structure outside the drawn area has no marker.
        if (px < 0 || pz < 0 || px >= canvas.width || pz >= canvas.height) return;
        const icon = markerIcons[i];
        if (icon) {
            const size = MARKER_ICON_PX + 2 * ICON_OUTLINE_PX;
            ctx.drawImage(outlinedIcon(icon, MARKER_ICON_PX, MARKER_ICON_PX, doc), px - size / 2, pz - size / 2, size, size);
            return;
        }
        ctx.fillStyle = MARKER_BORDER_COLOR;
        ctx.fillRect(px - outer / 2, pz - outer / 2, outer, outer);
        ctx.fillStyle = MARKER_COLOR;
        ctx.fillRect(px - MARKER_PX / 2, pz - MARKER_PX / 2, MARKER_PX, MARKER_PX);
    });
    return canvas;
}

/*
 * createThumbnailRequester(queue) -> { request(spec, onReady), destroy(), size }
 *
 * spec = { mcVersion, seed: "decimal", dimension, yHeight, markers: [{ x, z, type }],
 *          widthCells, heightCells, centreX, centreZ }  (the area, centred on block
 *          centreX, centreZ - the origin by default; 128 cells each by default).
 * request() asks the pool once per key, in strips (queue.requestArea: low priority and
 * `wide`, so tiles and high queries go first and the strips spread over every spare
 * worker), then calls onReady({ canvas, key }) with a canvas of widthCells × THUMB_SCALE
 * by heightCells × THUMB_SCALE px (each marker inside it drawn as the structure's map
 * icon in its outline, or an 8 px framed square for a type without one); a
 * cached canvas answers at once. Every request carries this requester's one token, so
 * destroy() cancels them all. A cancellation is silent; an engine error or any other failure
 * leaves the card's placeholder. A pool reset (killAll / restartAll: in-flight requests
 * are 'killed') asks again for every key still wanted.
 */
export function createThumbnailRequester(queue, { document: doc = globalThis.document } = {}) {
    const token = Symbol('thumbnails');
    const cache = new Map();       // key -> canvas, insertion-ordered
    const wanted = new Map();      // key -> { spec, listeners, attempt }
    let attempts = 0;
    let destroyed = false;

    const remember = (key, canvas) => {
        cache.delete(key);
        cache.set(key, canvas);
        while (cache.size > THUMB_CACHE_MAX) cache.delete(cache.keys().next().value);
    };

    const ask = (key, entry) => {
        const attempt = ++attempts;
        entry.attempt = attempt;
        const { mcVersion, seed, dimension = 0, yHeight = 256, markers = [] } = entry.spec;
        const area = areaOf(entry.spec);
        const strips = stripsOf(area);
        // Stale answers (an earlier attempt, a key no longer wanted) are dropped.
        const current = () => !destroyed && wanted.get(key) === entry && entry.attempt === attempt;
        // The icons load beside the strips, so the canvas is drawn once, with them in it.
        const markerIcons = Promise.all(markers.map((m) => iconOf(m.type)));
        Promise.all([markerIcons, ...strips.map(({ row, ...strip }) => queue.requestArea(
            { mcVersion, seed: String(seed), ...strip, dimension, yHeight }, { token, wide: true },
        ))]).then(([loaded, ...replies]) => {
            if (!current()) return;
            wanted.delete(key);
            // One strip the engine could not draw leaves the whole placeholder.
            if (replies.some((reply) => reply?.error || !reply?.rgba)) return;
            const rgba = new Uint8ClampedArray(area.widthX * area.widthY * 4);
            replies.forEach((reply, i) => rgba.set(reply.rgba, strips[i].row * area.widthX * 4));
            const canvas = render(rgba, area, markers, loaded, doc);
            remember(key, canvas);
            for (const onReady of entry.listeners) onReady({ canvas, key });
        }, (reason) => {
            if (!current()) return;
            // Killed with the pool: the reset listener below has already asked again.
            if (reason?.cancelled && reason.reason === 'killed') return;
            wanted.delete(key);
        });
    };

    const onReset = () => {
        if (destroyed) return;
        for (const [key, entry] of wanted) ask(key, entry);
    };
    queue.addResetListener(onReset);

    return {
        request(spec, onReady) {
            if (destroyed) return null;
            const key = thumbKey(spec);
            const cached = cache.get(key);
            if (cached) {
                remember(key, cached);
                onReady?.({ canvas: cached, key });
                return key;
            }
            const entry = wanted.get(key);
            if (entry) {
                if (onReady) entry.listeners.push(onReady);
                return key;
            }
            const fresh = { spec, listeners: onReady ? [onReady] : [], attempt: 0 };
            wanted.set(key, fresh);
            ask(key, fresh);
            return key;
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            queue.removeResetListener(onReset);
            queue.cancelToken(token);
            wanted.clear();
            cache.clear();
        },
        get size() { return cache.size; },
    };
}
