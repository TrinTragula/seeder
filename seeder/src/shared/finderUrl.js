import { BIOMES, STRUCTURES_OPTIONS } from '../util/constants';
import { getInitialVersion } from '../util/seed';
import { SITE_URL, versionLabelOf } from './seedUrl';
import { COUNT_OPTIONS, DEFAULT_CRITERIA, MAX_RANGE_BLOCKS, MIN_RANGE_BLOCKS } from '../pages/finder/criteria';

// The finder's stable URL contract:
//     /finder/?version=<label>&dim=<n>&range=<blocks>&y=<n>&count=<n>&start=<decimal>
//              [&biomes=185,132][&structures=5,11][&seeds=<decimal>,…]
// A criteria URL never starts a search by itself; `seeds` switches the page to
// render-only mode.
export const FINDER_PATH = '/finder/';

const BIOME_IDS = new Set(BIOMES.map((b) => b.value));
const STRUCTURE_IDS = new Set(STRUCTURES_OPTIONS.map((s) => s.value));

// Y is sampled in -64..320; -70 is HEIGHT_OPTIONS' "Bedrock" entry, accepted so that
// every height the form offers survives a round trip.
const Y_MIN = -70;
const Y_MAX = 320;

const INT64_MIN = -(2n ** 63n);
const UINT64_END = 2n ** 64n;
const DECIMAL = /^-?\d+$/;

function intIn(raw, min, max, fallback) {
    if (raw === null || !DECIMAL.test(raw.trim())) return fallback;
    const n = Number(raw.trim());
    return n >= min && n <= max ? n : fallback;
}

// A comma list of known ids: unknown ones dropped, duplicates removed, order kept.
function idList(raw, known) {
    if (!raw) return [];
    const ids = [];
    for (const part of raw.split(',')) {
        const s = part.trim();
        if (!DECIMAL.test(s)) continue;
        const id = Number(s);
        if (known.has(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

// A 64-bit seed written in decimal, as a signed BigInt; null for anything else.
// Never through Number. The unsigned form of the same 64 bits (up to 2^64 - 1) is
// folded to the signed seed cubiomes and Minecraft use, so one seed has one URL.
// (Minecraft itself does not accept the unsigned form: typed into the game, that
// text would be hashed. Here it is only another spelling of the same 64 bits.)
export function parseSeed64(raw) {
    const s = String(raw ?? '').trim();
    if (!DECIMAL.test(s)) return null;
    const n = BigInt(s);
    return n >= INT64_MIN && n < UINT64_END ? BigInt.asIntN(64, n) : null;
}

/*
 * Read the finder's parameters. Never throws: every malformed value falls back to
 * the default (DEFAULT_CRITERIA), unknown biome / structure ids are dropped.
 * Returns { criteria, seeds: string[] | null, start: BigInt }, with
 * criteria.startingSeed === start (the form's "Start seed" is the URL's cursor).
 */
export function parseFinderUrl(search) {
    const params = new URLSearchParams(search);
    const dim = params.get('dim');
    const count = intIn(params.get('count'), 0, Infinity, DEFAULT_CRITERIA.count);
    const start = parseSeed64(params.get('start')) ?? 0n;
    const seeds = (params.get('seeds') ?? '').split(',')
        .map(parseSeed64).filter((n) => n !== null).map(String);
    const criteria = {
        mcVersion: getInitialVersion(params.get('version') ?? undefined),
        dimension: ['-1', '0', '1'].includes(dim) ? Number(dim) : 0,
        yHeight: intIn(params.get('y'), Y_MIN, Y_MAX, DEFAULT_CRITERIA.yHeight),
        biomes: idList(params.get('biomes'), BIOME_IDS),
        structures: idList(params.get('structures'), STRUCTURE_IDS),
        rangeBlocks: intIn(params.get('range'), MIN_RANGE_BLOCKS, MAX_RANGE_BLOCKS, DEFAULT_CRITERIA.rangeBlocks),
        count: COUNT_OPTIONS.includes(count) ? count : DEFAULT_CRITERIA.count,
        startingSeed: start,
    };
    return { criteria, seeds: seeds.length > 0 ? seeds : null, start };
}

/*
 * The URL for a finder state. Every parameter is written, in a fixed order, so a
 * pasted link is unambiguous; only empty biomes / structures / seeds are left out.
 * `start` defaults to the criteria's own starting seed. Lists keep literal commas
 * (URLSearchParams would write %2C), which is what the contract shows.
 */
export function buildFinderUrl(criteria, { seeds = null, start = criteria.startingSeed ?? 0n, absolute = false } = {}) {
    const version = typeof criteria.mcVersion === 'string' ? criteria.mcVersion : versionLabelOf(criteria.mcVersion);
    const parts = [
        `version=${encodeURIComponent(version)}`,
        `dim=${criteria.dimension ?? 0}`,
        `range=${criteria.rangeBlocks}`,
        `y=${criteria.yHeight}`,
        `count=${criteria.count}`,
        `start=${String(start)}`,
    ];
    if (criteria.biomes?.length) parts.push(`biomes=${criteria.biomes.join(',')}`);
    if (criteria.structures?.length) parts.push(`structures=${criteria.structures.join(',')}`);
    if (seeds?.length) parts.push(`seeds=${seeds.map(String).join(',')}`);
    return `${absolute ? SITE_URL : ''}${FINDER_PATH}?${parts.join('&')}`;
}
