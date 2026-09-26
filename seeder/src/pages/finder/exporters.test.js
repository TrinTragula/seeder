import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    CSV_HEADER, REVOKE_DELAY_MS, copyAllSeeds, download, downloadCsv, downloadJson, exportFilename, seedsText, toCsv, toJson,
} from './exporters';
import { summaryOf, toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { APP_VERSION } from '../../util/site';

// summaryOf only ever names known biomes and structures: let one test give it a quote.
vi.mock('./hitModel', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, summaryOf: vi.fn(actual.summaryOf) };
});

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');
const PORTAL = structure('Ruined Portal');
const MANSION = structure('Mansion');
const BIG = '8091867987493326313';

const criteria = {
    ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE, PORTAL], biomes: [biome('Plains')],
    rangeBlocks: 300, yHeight: 64, count: 25, startingSeed: 0n,
};
const views = [
    toHitView({ seed: BigInt(BIG), spawnX: -32, spawnZ: 80, index: 0, structures: [{ type: PORTAL, x: 200, z: -150 }, { type: VILLAGE, x: -48, z: 16 }] }, criteria),
    // A shared seed whose portal the engine did not find in the box.
    toHitView({ seed: '-5', spawnX: 8, spawnZ: -8, index: 1, structures: [{ type: VILLAGE, x: 96, z: -80 }, { type: PORTAL, x: null, z: null, verified: false }] }, criteria),
    // A biome-only style row: nothing to list.
    toHitView({ seed: 7n, spawnX: 0, spawnZ: 16, index: 2, structures: [] }, criteria),
];

describe('toCsv', () => {
    it('starts with the exact header and ends every line with CRLF', () => {
        const csv = toCsv(criteria, views);
        expect(CSV_HEADER).toBe('seed,spawnX,spawnZ,structures,version,dimension,criteria');
        expect(csv.split('\r\n')[0]).toBe(CSV_HEADER);
        expect(csv.endsWith('\r\n')).toBe(true);
        expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
        expect(csv.split('\r\n')).toHaveLength(views.length + 2);   // header, rows, trailing empty
    });

    it('one row per view: |-joined found structures, the label, the dimension, the quoted summary', () => {
        const [, a, b, c] = toCsv(criteria, views).split('\r\n');
        const summary = '"Village · Ruined Portal · Plains · 300 blocks · 26.3 · Overworld"';
        expect(a).toBe(`${BIG},-32,80,${VILLAGE}:-48:16:51|${PORTAL}:200:-150:250,26.3,0,${summary}`);
        // The unverified portal is omitted.
        expect(b).toBe(`-5,8,-8,${VILLAGE}:96:-80:125,26.3,0,${summary}`);
        // No structures: an empty field.
        expect(c).toBe(`7,0,16,,26.3,0,${summary}`);
    });

    it('names the any-of and avoid lists in the criteria column, under the same header', () => {
        const csv = toCsv({ ...criteria, anyBiomes: [biome('Snowy Plains')], excludeBiomes: [biome('Ocean')] }, views.slice(0, 1));
        const [header, row] = csv.split('\r\n');
        expect(header).toBe(CSV_HEADER);
        expect(row.endsWith('"Village · Ruined Portal · Plains · any of Snowy Plains · no Ocean · 300 blocks · 26.3 · Overworld"')).toBe(true);
    });

    it('doubles the double quotes inside the summary (RFC 4180)', () => {
        summaryOf.mockReturnValueOnce('Village "near" spawn, 300 blocks');
        const [, row] = toCsv(criteria, views.slice(0, 1)).split('\r\n');
        expect(row.endsWith(',"Village ""near"" spawn, 300 blocks"')).toBe(true);
    });

    it('writes the Nether as -1', () => {
        const [, row] = toCsv({ ...criteria, dimension: -1, structures: [], biomes: [] }, views.slice(2)).split('\r\n');
        expect(row).toBe('7,0,16,,26.3,-1,"300 blocks · 26.3 · Nether"');
    });

    it('writes the End as 1', () => {
        const [, row] = toCsv({ ...criteria, dimension: 1, structures: [], biomes: [] }, views.slice(2)).split('\r\n');
        expect(row).toBe('7,0,16,,26.3,1,"300 blocks · 26.3 · End"');
    });

    it('an empty view is the header and one CRLF, nothing else', () => {
        expect(toCsv(criteria, [])).toBe(`${CSV_HEADER}\r\n`);
    });

    it('a seed whose structures are all unverified gets an empty structures field', () => {
        const only = toHitView({ seed: '1', spawnX: 4, spawnZ: -4, index: 0, structures: [{ type: MANSION, x: null, z: null, verified: false }] }, criteria);
        const [, row] = toCsv(criteria, [only]).split('\r\n');
        expect(row.split(',').slice(0, 5)).toEqual(['1', '4', '-4', '', '26.3']);
        expect(row).not.toContain(`${MANSION}:`);
    });
});

describe('toJson', () => {
    it('carries the any-of and avoid lists as ids', () => {
        const data = JSON.parse(toJson({ ...criteria, anyBiomes: [biome('Snowy Plains')], excludeBiomes: [biome('Ocean'), biome('Deep Ocean')] }, views));
        expect(data.anyBiomes).toEqual([biome('Snowy Plains')]);
        expect(data.excludeBiomes).toEqual([biome('Ocean'), biome('Deep Ocean')]);
    });

    it('carries the world type: largeBiomes true, and the CSV criteria name it', () => {
        const big = { ...criteria, largeBiomes: true };
        expect(JSON.parse(toJson(big, views)).largeBiomes).toBe(true);
        expect(toCsv(big, views)).toContain('Large Biomes');
        expect(toCsv(criteria, views)).not.toContain('Large Biomes');
    });

    it('has exactly the documented keys, in order, with string seeds and start', () => {
        const json = toJson(criteria, views, { start: 2n ** 63n + 5n });
        const data = JSON.parse(json);
        expect(Object.keys(data)).toEqual([
            'version', 'mcVersion', 'largeBiomes', 'dimension', 'rangeBlocks', 'yHeight', 'biomes', 'anyBiomes', 'excludeBiomes', 'structures', 'count', 'start', 'generatedWith', 'hits',
        ]);
        expect(data).toEqual({
            version: '26.3',
            mcVersion: VERSIONS['26.3'],
            largeBiomes: false,
            dimension: 0,
            rangeBlocks: 300,
            yHeight: 64,
            biomes: [biome('Plains')],
            anyBiomes: [],
            excludeBiomes: [],
            structures: [VILLAGE, PORTAL],
            count: 25,
            start: '9223372036854775813',
            generatedWith: `Seeder ${APP_VERSION}`,
            hits: [
                { seed: BIG, spawnX: -32, spawnZ: 80, structures: [{ type: VILLAGE, x: -48, z: 16, distance: 51 }, { type: PORTAL, x: 200, z: -150, distance: 250 }] },
                { seed: '-5', spawnX: 8, spawnZ: -8, structures: [{ type: VILLAGE, x: 96, z: -80, distance: 125 }] },
                { seed: '7', spawnX: 0, spawnZ: 16, structures: [] },
            ],
        });
        expect(Object.keys(data.hits[0])).toEqual(['seed', 'spawnX', 'spawnZ', 'structures']);
        // The 19-digit seed is a JSON string, digit for digit.
        expect(json).toContain(`"seed": "${BIG}"`);
        expect(json).toContain('"start": "9223372036854775813"');
    });

    it('start defaults to the criteria\'s starting seed; never throws on BigInts', () => {
        expect(JSON.parse(toJson({ ...criteria, startingSeed: 12345n }, [])).start).toBe('12345');
        expect(() => toJson(criteria, views)).not.toThrow();
    });

    it('omits a shared seed\'s unverified structures', () => {
        const only = toHitView({ seed: '1', spawnX: 0, spawnZ: 0, index: 0, structures: [{ type: MANSION, x: null, z: null, verified: false }] }, criteria);
        expect(JSON.parse(toJson(criteria, [only])).hits[0].structures).toEqual([]);
    });
});

describe('copyAllSeeds', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
    });

    it('copies one seed per line through copyToClipboard', async () => {
        await copyAllSeeds(views);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${BIG}\n-5\n7`);
        expect(seedsText(views)).toBe(`${BIG}\n-5\n7`);
    });
});

describe('download', () => {
    let clicked;
    beforeEach(() => {
        vi.useFakeTimers();
        clicked = [];
        URL.createObjectURL = vi.fn(() => 'blob:seeder/1');
        URL.revokeObjectURL = vi.fn();
        // jsdom would try to navigate to the blob: URL.
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
            clicked.push({ href: this.getAttribute('href'), download: this.download, attached: this.isConnected });
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete URL.createObjectURL;
        delete URL.revokeObjectURL;
    });

    it('clicks a temporary anchor carrying the filename, then revokes the object URL', () => {
        const blob = new Blob(['x']);
        download('seeds.csv', blob);
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
        expect(clicked).toEqual([{ href: 'blob:seeder/1', download: 'seeds.csv', attached: true }]);
        expect(document.querySelector('a[download]')).toBeNull();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        vi.advanceTimersByTime(REVOKE_DELAY_MS);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:seeder/1');
    });

    it('names the files seeder-seeds-<version>-<YYYYMMDD>', async () => {
        vi.setSystemTime(new Date(2026, 8, 5, 12));
        expect(exportFilename(criteria, 'csv')).toBe('seeder-seeds-26.3-20260905.csv');
        downloadCsv(criteria, views);
        downloadJson({ ...criteria, mcVersion: VERSIONS['1.17'] }, views, { start: 3n });
        expect(clicked.map((c) => c.download)).toEqual(['seeder-seeds-26.3-20260905.csv', 'seeder-seeds-1.17-20260905.json']);
        const [csvBlob, jsonBlob] = URL.createObjectURL.mock.calls.map(([b]) => b);
        expect(csvBlob.type).toBe('text/csv;charset=utf-8');
        expect(jsonBlob.type).toBe('application/json');
        expect((await csvBlob.text()).startsWith(`${CSV_HEADER}\r\n`)).toBe(true);
        expect(JSON.parse(await jsonBlob.text()).start).toBe('3');
    });
});
