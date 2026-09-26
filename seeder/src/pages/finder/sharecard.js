import { dimensionLabel, formatCoords, formatDistance } from '../../shared/format';
import { download } from './exporters';

/*
 * The PNG share card of one result row, 1200×630 (the Open Graph size):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ┌─────────────────┐  SEED                                     │
 *   │ │                 │  8091867987493326313   (64 px, shrinks)   │
 *   │ │  the row's own  │  26.3 | Overworld                         │
 *   │ │  thumbnail,     │  Village | (128, 160) | 205 blocks  (≤ 4) │
 *   │ │  centred square │  Village | 300 blocks | 26.3 | Overworld  │
 *   │ │  600×600        │                                           │
 *   │ └─────────────────┘                             mcseeder.com  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The picture is the largest centred square of the canvas already on screen (no second
 * engine request), scaled nearest-neighbour so the biome cells stay crisp. Every text
 * is in the pixel font; the canvas can only use it once the font has loaded.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
// --color-brand-ink and --color-brand in tokens.css; a canvas cannot read CSS properties.
export const CARD_BG = '#1b1b1b';
export const CARD_BRAND = '#8FCA5C';
export const CARD_PAD = 15;
export const CARD_THUMB = 600;
export const CARD_FRAME = 3;
export const TEXT_X = 645;
export const TEXT_WIDTH = 525;
export const MAX_STRUCTURE_LINES = 4;
export const SEED_FONT_MAX = 64;
export const SEED_FONT_MIN = 20;

const font = (px) => `${px}px Minecraft, monospace`;
// The pixel font's middle dot is a 2 px square that reads as a minus next to negative
// coordinates: the card separates with a bar.
export const CARD_SEPARATOR = ' | ';
const onCard = (text) => text.split(' · ').join(CARD_SEPARATOR);
const ELLIPSIS = '…';

// The text as is when it fits, else cut with an ellipsis until it does.
function fit(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return text;
    let cut = text;
    while (cut.length > 0 && ctx.measureText(cut + ELLIPSIS).width > width) cut = cut.slice(0, -1);
    return cut.trimEnd() + ELLIPSIS;
}

// Greedy word wrap into at most `max` lines; the last one ends in an ellipsis when
// words are left over.
export function wrapLines(ctx, text, width, max) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    let i = 0;
    for (; i < words.length && lines.length < max; i += 1) {
        const next = line ? `${line} ${words[i]}` : words[i];
        if (!line || ctx.measureText(next).width <= width) {
            line = next;
            continue;
        }
        lines.push(line);
        line = words[i];
    }
    if (lines.length < max && line) {
        lines.push(line);
        line = '';
    }
    const rest = [line, ...words.slice(i)].filter(Boolean).join(' ');
    return lines.map((l, n) => (n === lines.length - 1 && rest ? fit(ctx, `${l} ${rest}`, width) : fit(ctx, l, width)));
}

// The pixel font must be loaded before the canvas draws with it; a browser without the
// Font Loading API just draws (monospace at worst).
async function fontReady() {
    try {
        await document.fonts?.load?.('40px Minecraft');
    } catch (_) { /* draw with the fallback */ }
}

/*
 * buildShareCard({ view, thumbnailCanvas, versionLabel, criteriaSummary })
 *   -> Promise<HTMLCanvasElement> (1200×630)
 * `thumbnailCanvas` is the row's canvas; it is only read, never moved.
 */
export async function buildShareCard({ view, thumbnailCanvas, versionLabel, criteriaSummary }) {
    await fontReady();
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = CARD_BG;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // The frame, then the picture inside it.
    ctx.fillStyle = CARD_BRAND;
    ctx.fillRect(CARD_PAD - CARD_FRAME, CARD_PAD - CARD_FRAME, CARD_THUMB + 2 * CARD_FRAME, CARD_THUMB + 2 * CARD_FRAME);
    const w = thumbnailCanvas?.width ?? 0;
    const h = thumbnailCanvas?.height ?? 0;
    if (w > 0 && h > 0) {
        const side = Math.min(w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(thumbnailCanvas, Math.floor((w - side) / 2), Math.floor((h - side) / 2), side, side, CARD_PAD, CARD_PAD, CARD_THUMB, CARD_THUMB);
    } else {
        ctx.fillStyle = '#333333';
        ctx.fillRect(CARD_PAD, CARD_PAD, CARD_THUMB, CARD_THUMB);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let y = 70;
    ctx.fillStyle = CARD_BRAND;
    ctx.font = font(22);
    ctx.fillText('SEED', TEXT_X, y);

    // The digits as large as fits the column: 64 px, 4 px smaller at a time.
    let size = SEED_FONT_MAX;
    ctx.font = font(size);
    while (size > SEED_FONT_MIN && ctx.measureText(view.seed).width > TEXT_WIDTH) {
        size -= 4;
        ctx.font = font(size);
    }
    y += 18 + size;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(view.seed, TEXT_X, y);

    y += 52;
    ctx.font = font(26);
    ctx.fillText(fit(ctx, `${versionLabel}${CARD_SEPARATOR}${dimensionLabel(view.dimension)}`, TEXT_WIDTH), TEXT_X, y);

    const found = view.structures.filter((s) => s.verified !== false).slice(0, MAX_STRUCTURE_LINES);
    ctx.font = font(22);
    ctx.fillStyle = '#dddddd';
    y += 20;
    for (const s of found) {
        y += 36;
        ctx.fillText(fit(ctx, [s.name, formatCoords(s.x, s.z), formatDistance(s.distance)].join(CARD_SEPARATOR), TEXT_WIDTH), TEXT_X, y);
    }

    ctx.font = font(20);
    ctx.fillStyle = '#aaaaaa';
    y += found.length ? 30 : 16;
    for (const line of wrapLines(ctx, onCard(criteriaSummary ?? ''), TEXT_WIDTH, 2)) {
        y += 30;
        ctx.fillText(line, TEXT_X, y);
    }

    ctx.font = font(24);
    ctx.fillStyle = CARD_BRAND;
    ctx.textAlign = 'right';
    ctx.fillText('mcseeder.com', TEXT_X + TEXT_WIDTH, CARD_HEIGHT - CARD_PAD - 20);
    return canvas;
}

const toPng = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The share card could not be encoded.'))), 'image/png');
});

/*
 * Hand the card to the system share sheet when it takes files (phones), else download
 * it as seed-<seed>.png. Closing the share sheet (AbortError) is not a failure; any
 * other refusal (e.g. the click's activation expired) falls back to the download.
 * Resolves with 'shared' or 'downloaded'.
 */
export async function shareOrDownloadCard(canvas, seed) {
    const blob = await toPng(canvas);
    const name = `seed-${seed}.png`;
    const files = [new File([blob], name, { type: 'image/png' })];
    if (navigator.canShare?.({ files })) {
        try {
            // Files only: some targets turn a title or text into an extra attachment.
            await navigator.share({ files });
            return 'shared';
        } catch (e) {
            if (e?.name === 'AbortError') return 'shared';
        }
    }
    download(name, blob);
    return 'downloaded';
}
