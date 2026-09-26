import { copyToClipboard } from '../../util/functions';
import { APP_VERSION } from '../../util/site';
import { versionLabelOf } from '../../shared/seedUrl';
import { summaryOf } from './hitModel';

/*
 * The finder's exports, pure except for download(). Seeds are the views'
 * decimal strings and `start` is written as a string: a BigInt inside JSON.stringify
 * throws, and a Number would round a 64-bit seed. Only the structures the engine
 * found are exported; a shared seed's "not found within" rows are left out.
 */

export const CSV_HEADER = 'seed,spawnX,spawnZ,structures,version,dimension,criteria';
// Some browsers read the object URL after click() returns: revoke it a moment later.
export const REVOKE_DELAY_MS = 1000;

const foundRows = (view) => view.structures.filter((s) => s.verified !== false);

// One seed per line: what "Copy all seeds" puts on the clipboard.
export const seedsText = (views) => views.map((v) => v.seed).join('\n');

export const copyAllSeeds = (views) => copyToClipboard(seedsText(views));

// RFC 4180: a field in double quotes, its own double quotes doubled.
const quote = (text) => `"${String(text).replace(/"/g, '""')}"`;

/*
 * CSV, one row per view, CRLF line ends:
 *   seed,spawnX,spawnZ,structures,version,dimension,criteria
 * `structures` is type:x:z:distance per found structure joined by `|` (empty when
 * none), `version` the label, `dimension` -1 | 0 | 1, `criteria` the quoted summary
 * (summaryOf: it names or counts the any-of / avoid lists; the ids are in the JSON export).
 */
export function toCsv(criteria, views) {
    const version = versionLabelOf(criteria.mcVersion);
    const dimension = criteria.dimension ?? 0;
    const summary = quote(summaryOf(criteria));
    const rows = views.map((v) => [
        v.seed,
        v.spawn.x,
        v.spawn.z,
        foundRows(v).map((s) => `${s.type}:${s.x}:${s.z}:${s.distance}`).join('|'),
        version,
        dimension,
        summary,
    ].join(','));
    return `${[CSV_HEADER, ...rows].join('\r\n')}\r\n`;
}

/*
 * JSON, in this key order (external tools may parse it):
 *   { version, mcVersion, largeBiomes, dimension, rangeBlocks, yHeight, biomes, anyBiomes, excludeBiomes,
 *     structures, count,
 *     start: "decimal", generatedWith: "Seeder x.y.z",
 *     hits: [{ seed: "decimal", spawnX, spawnZ, structures: [{ type, x, z, distance }] }] }
 */
export function toJson(criteria, views, { start = criteria.startingSeed ?? 0n } = {}) {
    return JSON.stringify({
        version: versionLabelOf(criteria.mcVersion),
        mcVersion: criteria.mcVersion,
        largeBiomes: !!criteria.largeBiomes,
        dimension: criteria.dimension ?? 0,
        rangeBlocks: criteria.rangeBlocks,
        yHeight: criteria.yHeight,
        biomes: [...criteria.biomes],
        anyBiomes: [...(criteria.anyBiomes ?? [])],
        excludeBiomes: [...(criteria.excludeBiomes ?? [])],
        structures: [...criteria.structures],
        count: criteria.count,
        start: String(start),
        generatedWith: `Seeder ${APP_VERSION}`,
        hits: views.map((v) => ({
            seed: String(v.seed),
            spawnX: v.spawn.x,
            spawnZ: v.spawn.z,
            structures: foundRows(v).map(({ type, x, z, distance }) => ({ type, x, z, distance })),
        })),
    }, null, 2);
}

// seeder-seeds-<version label>-<YYYYMMDD>.<ext>, the date in the visitor's time zone.
export function exportFilename(criteria, ext, date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    return `seeder-seeds-${versionLabelOf(criteria.mcVersion)}-${day}.${ext}`;
}

// Save a blob as a file: an object URL on a temporary <a download>.
export function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export const downloadCsv = (criteria, views) =>
    download(exportFilename(criteria, 'csv'), new Blob([toCsv(criteria, views)], { type: 'text/csv;charset=utf-8' }));

export const downloadJson = (criteria, views, options) =>
    download(exportFilename(criteria, 'json'), new Blob([toJson(criteria, views, options)], { type: 'application/json' }));
