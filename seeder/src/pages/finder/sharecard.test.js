import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    CARD_BG, CARD_BRAND, CARD_HEIGHT, CARD_WIDTH, TEXT_WIDTH, TEXT_X, buildShareCard, shareOrDownloadCard, wrapLines,
} from './sharecard';
import { REVOKE_DELAY_MS } from './exporters';
import { toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { RecordingCanvasContext } from '../../test/fakes';

const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');
const PORTAL = structure('Ruined Portal');
const MANSION = structure('Mansion');
const criteria = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE] };
const BIG = '-9223372036854775808';                  // 20 characters

// The recording context measures 6 px per character whatever the font; the card's
// fitting needs widths that grow with the font size: 0.6 em per character.
const sizeOf = (fontString) => Number.parseInt(fontString, 10);
let texts;
beforeEach(() => {
    texts = [];
    vi.spyOn(RecordingCanvasContext.prototype, 'measureText').mockImplementation(function measure(text) {
        return { width: String(text).length * sizeOf(this.font) * 0.6 };
    });
    const record = RecordingCanvasContext.prototype.fillText;
    vi.spyOn(RecordingCanvasContext.prototype, 'fillText').mockImplementation(function fillText(text, x, y) {
        texts.push({ text, x, y, font: this.font, fillStyle: this.fillStyle, textAlign: this.textAlign });
        return record.call(this, text, x, y);
    });
});
afterEach(() => { vi.restoreAllMocks(); });

const thumb = (width, height) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
};
const view = (over = {}) => toHitView({
    seed: 8091867987493326313n, spawnX: -32, spawnZ: 80, index: 0,
    structures: [{ type: VILLAGE, x: 128, z: 160 }],
    ...over,
}, criteria);
const build = (over = {}) => buildShareCard({
    view: view(), thumbnailCanvas: thumb(906, 320), versionLabel: '26.3', criteriaSummary: 'Village · 300 blocks · 26.3 · Overworld', ...over,
});

describe('buildShareCard', () => {
    it('is a 1200×630 canvas on the ink background', async () => {
        const card = await build();
        expect([card.width, card.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
        const ctx = card.getContext('2d');
        expect(ctx.callsOf('fillRect')[0].args).toEqual([0, 0, 1200, 630]);
        expect(CARD_BG).toBe('#1b1b1b');
    });

    it('draws the largest centred square of the row\'s canvas at (15, 15) 600×600, smoothing off, inside a 3 px brand frame', async () => {
        const card = await build();
        const ctx = card.getContext('2d');
        const [image] = ctx.callsOf('drawImage');
        // 906×320: the square is 320 wide, centred: x from (906 − 320) / 2 = 293.
        expect(image.args.slice(1)).toEqual([293, 0, 320, 320, 15, 15, 600, 600]);
        expect(ctx.imageSmoothingEnabled).toBe(false);
        expect(ctx.callsOf('fillRect')[1].args).toEqual([12, 12, 606, 606]);
        // A tall canvas is cropped vertically.
        const tall = (await build({ thumbnailCanvas: thumb(360, 668) })).getContext('2d').callsOf('drawImage')[0];
        expect(tall.args.slice(1, 5)).toEqual([0, 154, 360, 360]);
    });

    it('never moves the row\'s canvas: it is only read', async () => {
        const host = document.createElement('div');
        const own = thumb(400, 300);
        host.appendChild(own);
        await build({ thumbnailCanvas: own });
        expect(own.parentNode).toBe(host);
    });

    it('writes SEED, the digits, the version line, the structures, the summary and the footer in the pixel font', async () => {
        await build();
        // No middle dot anywhere: in the pixel font it reads as a minus.
        expect(texts.some((t) => t.text.includes('·'))).toBe(false);
        expect(texts.map((t) => t.text)).toEqual([
            'SEED',
            '8091867987493326313',
            '26.3 | Overworld',
            'Village | (128, 160) | 205 blocks',
            'Village | 300 blocks | 26.3 | Overworld',
            'mcseeder.com',
        ]);
        for (const t of texts) expect(t.font).toMatch(/px Minecraft, monospace$/);
        const by = Object.fromEntries(texts.map((t) => [t.text, t]));
        expect(by.SEED).toMatchObject({ font: '22px Minecraft, monospace', fillStyle: CARD_BRAND, x: TEXT_X });
        expect(by['26.3 | Overworld']).toMatchObject({ font: '26px Minecraft, monospace', fillStyle: '#ffffff', x: 645 });
        expect(by['Village | (128, 160) | 205 blocks']).toMatchObject({ font: '22px Minecraft, monospace', fillStyle: '#dddddd' });
        expect(by['Village | 300 blocks | 26.3 | Overworld']).toMatchObject({ font: '20px Minecraft, monospace', fillStyle: '#aaaaaa' });
        expect(by['mcseeder.com']).toMatchObject({ font: '24px Minecraft, monospace', fillStyle: CARD_BRAND, textAlign: 'right', x: 1170 });
        // Top to bottom, the footer last and inside the card.
        const ys = texts.map((t) => t.y);
        expect([...ys].sort((a, b) => a - b)).toEqual(ys);
        expect(by['mcseeder.com'].y).toBeLessThan(CARD_HEIGHT);
    });

    it('shrinks the digits 4 px at a time until they fit 525 px: a 19-digit seed ends at 44 px', async () => {
        await build();
        const digits = texts.find((t) => t.text === '8091867987493326313');
        // 19 × 0.6 × 44 = 501.6 ≤ 525 < 19 × 0.6 × 48.
        expect(digits.font).toBe('44px Minecraft, monospace');
        expect(digits.fillStyle).toBe('#ffffff');
        texts = [];
        await build({ view: view({ seed: 42n }) });
        expect(texts.find((t) => t.text === '42').font).toBe('64px Minecraft, monospace');
        texts = [];
        await build({ view: view({ seed: BigInt(BIG) }) });
        const neg = texts.find((t) => t.text === BIG);
        expect(sizeOf(neg.font) * 0.6 * BIG.length).toBeLessThanOrEqual(TEXT_WIDTH);
    });

    it('lists at most four found structures, nearest first, and skips the unverified ones', async () => {
        const structures = [
            { type: MANSION, x: null, z: null, verified: false },
            ...[1, 2, 3, 4, 5].map((i) => ({ type: i % 2 ? VILLAGE : PORTAL, x: i * 100, z: 0 })),
        ];
        await build({ view: view({ structures }) });
        const lines = texts.filter((t) => t.fillStyle === '#dddddd').map((t) => t.text);
        expect(lines).toEqual([
            'Village | (100, 0) | 100 blocks',
            'Ruined Portal | (200, 0) | 200 blocks',
            'Village | (300, 0) | 300 blocks',
            'Ruined Portal | (400, 0) | 400 blocks',
        ]);
        expect(texts.some((t) => t.text.startsWith('Mansion'))).toBe(false);
    });

    it('puts a long summary on two lines at most, the second ending in an ellipsis', async () => {
        const long = Array.from({ length: 12 }, (_, i) => `Biome${i}`).join(' | ');
        await build({ criteriaSummary: long });
        const lines = texts.filter((t) => t.fillStyle === '#aaaaaa').map((t) => t.text);
        expect(lines).toHaveLength(2);
        expect(lines[1].endsWith('…')).toBe(true);
        for (const l of lines) expect(l.length * 20 * 0.6).toBeLessThanOrEqual(TEXT_WIDTH);
    });

    it('without a picture to copy (no canvas, or a 0×0 one) fills the square grey instead', async () => {
        const fills = [];
        const record = RecordingCanvasContext.prototype.fillRect;
        vi.spyOn(RecordingCanvasContext.prototype, 'fillRect').mockImplementation(function fillRect(...args) {
            fills.push({ args, fillStyle: this.fillStyle });
            return record.apply(this, args);
        });
        for (const thumbnailCanvas of [null, undefined, thumb(0, 0), thumb(300, 0)]) {
            fills.length = 0;
            const ctx = (await build({ thumbnailCanvas })).getContext('2d');
            expect(ctx.callsOf('drawImage'), String(thumbnailCanvas)).toEqual([]);
            expect(fills, String(thumbnailCanvas)).toContainEqual({ args: [15, 15, 600, 600], fillStyle: '#333333' });
            // The rest of the card is still drawn.
            expect(texts.at(-1).text).toBe('mcseeder.com');
        }
    });

    it('waits for the pixel font before drawing', async () => {
        const load = vi.fn().mockResolvedValue([]);
        Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
        try {
            await build();
            expect(load).toHaveBeenCalledWith('40px Minecraft');
        } finally {
            delete document.fonts;
        }
    });
});

describe('wrapLines', () => {
    it('keeps short text on one line', () => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '20px Minecraft, monospace';
        expect(wrapLines(ctx, 'Village | 300 blocks', 525, 2)).toEqual(['Village | 300 blocks']);
        expect(wrapLines(ctx, '', 525, 2)).toEqual([]);
    });

    // 20 px font: 12 px per character, so a 60 px column holds 5 characters.
    const narrow = () => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '20px Minecraft, monospace';
        return ctx;
    };

    it('cuts a single word wider than the column with an ellipsis', () => {
        expect(wrapLines(narrow(), 'Supercalifragilistic', 60, 2)).toEqual(['Supe…']);
        expect(wrapLines(narrow(), 'ab Supercalifragilistic', 60, 2)).toEqual(['ab', 'Supe…']);
    });

    it('three lines of words at max 2: the second line carries the rest, cut with an ellipsis', () => {
        expect(wrapLines(narrow(), 'aaaa bbbb cccc', 60, 2)).toEqual(['aaaa', 'bbbb…']);
        expect(wrapLines(narrow(), 'aaaa bbbb cccc', 60, 3)).toEqual(['aaaa', 'bbbb', 'cccc']);
    });

    it('max 1 keeps one line, ending in an ellipsis when words are left over', () => {
        expect(wrapLines(narrow(), 'aaaa bbbb cccc', 60, 1)).toEqual(['aaaa…']);
        expect(wrapLines(narrow(), 'aaaa', 60, 1)).toEqual(['aaaa']);
    });
});

describe('shareOrDownloadCard', () => {
    let clicked;
    beforeEach(() => {
        vi.useFakeTimers();
        clicked = [];
        HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlob(cb, type) { cb(new Blob(['png'], { type })); });
        URL.createObjectURL = vi.fn(() => 'blob:card');
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicked.push(this.download); });
    });
    afterEach(() => {
        vi.useRealTimers();
        delete HTMLCanvasElement.prototype.toBlob;
        delete URL.createObjectURL;
        delete URL.revokeObjectURL;
        delete navigator.canShare;
        delete navigator.share;
    });

    it('shares the PNG as a file when the browser can share files', async () => {
        navigator.canShare = vi.fn(() => true);
        navigator.share = vi.fn().mockResolvedValue();
        const result = await shareOrDownloadCard(thumb(1200, 630), '3774');
        expect(result).toBe('shared');
        expect(navigator.share).toHaveBeenCalledTimes(1);
        const [data] = navigator.share.mock.calls[0];
        // One file and nothing else: a title or text becomes a second item in some apps.
        expect(Object.keys(data)).toEqual(['files']);
        const { files } = data;
        expect(files).toHaveLength(1);
        expect(files[0]).toBeInstanceOf(File);
        expect(files[0].name).toBe('seed-3774.png');
        expect(files[0].type).toBe('image/png');
        expect(HTMLCanvasElement.prototype.toBlob.mock.calls[0][1]).toBe('image/png');
        expect(clicked).toEqual([]);
    });

    it('downloads seed-<seed>.png when files cannot be shared', async () => {
        navigator.canShare = vi.fn(() => false);
        navigator.share = vi.fn();
        expect(await shareOrDownloadCard(thumb(10, 10), '-5')).toBe('downloaded');
        expect(navigator.share).not.toHaveBeenCalled();
        expect(clicked).toEqual(['seed--5.png']);
        vi.advanceTimersByTime(REVOKE_DELAY_MS);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card');
        // No Web Share API at all: the same download.
        delete navigator.canShare;
        delete navigator.share;
        await shareOrDownloadCard(thumb(10, 10), '7');
        expect(clicked).toEqual(['seed--5.png', 'seed-7.png']);
    });

    it('swallows an AbortError (the sheet was closed) and does not download', async () => {
        navigator.canShare = vi.fn(() => true);
        navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }));
        await expect(shareOrDownloadCard(thumb(10, 10), '1')).resolves.toBe('shared');
        expect(clicked).toEqual([]);
    });

    it('rejects when the canvas cannot be encoded, and neither shares nor downloads', async () => {
        HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(null));
        navigator.canShare = vi.fn(() => true);
        navigator.share = vi.fn().mockResolvedValue();
        await expect(shareOrDownloadCard(thumb(10, 10), '1')).rejects.toThrow('The share card could not be encoded.');
        expect(navigator.share).not.toHaveBeenCalled();
        expect(clicked).toEqual([]);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('falls back to the download when sharing is refused for another reason', async () => {
        navigator.canShare = vi.fn(() => true);
        navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('no activation'), { name: 'NotAllowedError' }));
        await expect(shareOrDownloadCard(thumb(10, 10), '1')).resolves.toBe('downloaded');
        expect(clicked).toEqual(['seed-1.png']);
    });
});
