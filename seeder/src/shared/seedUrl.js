import { HEIGHT_OPTIONS, STRUCTURES_OPTIONS, VERSIONS } from '../util/constants';
import { DEFAULT_VERSION, canonicalSeed, getInitialVersion, getRandomSeed, supportsLargeBiomes } from '../util/seed';

// The seed page lives at one path and publishes one URL shape:
//     /seed/?seed=<decimal>&version=<label>[&dim=-1|1][&world=large]
//            [&structs=<StructureType>,…][&coords=0][&slime=1][&grid=1][&y=<n>]
// The first line is the canonical URL: saved worlds, the finder's links and the legacy
// redirect only ever write that. `world=large` is the Large Biomes world type: it
// changes what the world is, so it is canonical, kept in every dimension (a Large
// Biomes world's Nether is still that world) and only from 1.3, where the type exists. The second line is the view, which the seed page adds
// to its own address bar and Share box and reads once when it loads, so a reload or a
// recipient sees the same structures, overlays and biome height:
//   structs  STRUCTURES_OPTIONS values, in pick order; unknown ids and duplicates are
//            dropped. `structs=` (empty) means none shown, absent means the default.
//   coords   structure coordinates are on by default: only `coords=0` exists.
//   slime    `1` turns the slime-chunk overlay on; anything else is the default.
//   grid     `1` turns the chunk grid lines on; anything else is the default.
//   y        a HEIGHT_OPTIONS value (the seed page's select offers nothing else);
//            written only from 1.18, where biomes are 3D and the select exists.
// Only values that differ from DEFAULT_VIEW are written, in this fixed order.
// Everything that reads or writes that URL goes through this module, so the share
// box, the address bar, the legacy redirect and the finder cannot drift apart.
export const SEED_PATH = '/seed/';

// Share URLs always name production, never the host the page happens to run on:
// a link copied from localhost or a preview build has to work for the person who
// receives it.
export const SITE_URL = 'https://mcseeder.com';

// VERSIONS maps label -> cubiomes MCVersion int; the URL carries the label.
export const versionLabelOf = (mcVersion) =>
    Object.keys(VERSIONS).find((key) => VERSIONS[key] === mcVersion) ?? DEFAULT_VERSION;

// What the seed page shows before anyone touches the controls.
export const DEFAULT_VIEW = Object.freeze({
    structures: Object.freeze([]),
    showCoords: true,
    slime: false,
    grid: false,
    yHeight: 256,
});

// Biomes are 3D from 1.18 on; before that the height has no effect and no control.
const HEIGHT_FROM = VERSIONS['1.18'];
const STRUCTURE_IDS = new Set(STRUCTURES_OPTIONS.map((o) => o.value));
const HEIGHTS = new Set(HEIGHT_OPTIONS.map((o) => o.value));
const DECIMAL = /^-?\d+$/;

// A comma list of known ids: unknown ones dropped, duplicates removed, order kept.
function idList(raw, known) {
    const ids = [];
    for (const part of raw.split(',')) {
        const s = part.trim();
        if (!DECIMAL.test(s)) continue;
        const id = Number(s);
        if (known.has(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

// The view keys the URL set, and only those: the page falls back to DEFAULT_VIEW for the rest.
function parseView(params) {
    const view = {};
    const structs = params.get('structs');
    if (structs !== null) view.structures = idList(structs, STRUCTURE_IDS);
    if (params.get('coords') === '0') view.showCoords = false;
    if (params.get('slime') === '1') view.slime = true;
    if (params.get('grid') === '1') view.grid = true;
    const y = (params.get('y') ?? '').trim();
    if (DECIMAL.test(y) && HEIGHTS.has(Number(y))) view.yHeight = Number(y);
    return view;
}

/*
 * Read the seed page's parameters out of a query string. Never throws: every
 * malformed value falls back to something renderable.
 *   seed    parsed like Minecraft does (canonicalSeed): a signed 64-bit decimal as
 *           its canonical string (never through Number), other text - a decimal
 *           outside the long range included - hashed, nothing at all -> random.
 *   version a VERSIONS label, or a pre-1.0 numeric index via OLD_VERSIONS.
 *   dim     -1 (Nether) or 1 (End); anything else is the Overworld.
 *   world   `large` is a Large Biomes world (largeBiomes: true) from 1.3 on; anything
 *           else, or an older version, is Default.
 *   from    `legacy` marks a visitor arriving from a pre-1.0 share link.
 *   view    the view params the URL set (see the contract above), e.g. { slime: true }.
 */
export function parseSeedPage(search) {
    const params = new URLSearchParams(search);
    const raw = (params.get('seed') ?? '').trim();
    const seed = raw ? canonicalSeed(raw) : getRandomSeed();
    const dim = params.get('dim');
    const mcVersion = getInitialVersion(params.get('version') ?? undefined);
    return {
        seed,
        mcVersion,
        dimension: ['-1', '1'].includes(dim) ? Number(dim) : 0,
        largeBiomes: params.get('world') === 'large' && supportsLargeBiomes(mcVersion),
        fromLegacy: params.get('from') === 'legacy',
        view: parseView(params),
    };
}

/*
 * The canonical URL for a seed page state. `mcVersion` may be the cubiomes int or
 * the label itself. The Overworld is the default, so `dim` is omitted for it -
 * that keeps the common share URL short and makes the contract single-valued. So is
 * the Default world type: `world=large` only for a Large Biomes world on 1.3+.
 * Transient parameters (from=legacy) are never emitted, which is how the first
 * replaceState strips them. The view is written only when `view` is passed (the seed
 * page's own address bar and Share box); it holds the page's current values (the
 * DEFAULT_VIEW keys), and only those that differ from the default are written, lists
 * with literal commas.
 */
export function buildSeedUrl({ seed, mcVersion, dimension = 0, largeBiomes = false }, { absolute = false, view = null } = {}) {
    const version = typeof mcVersion === 'string' ? mcVersion : versionLabelOf(mcVersion);
    const query = new URLSearchParams({ seed: String(seed), version });
    if (dimension) query.set('dim', String(dimension));
    if (largeBiomes && supportsLargeBiomes(VERSIONS[version] ?? 0)) query.set('world', 'large');
    const url = `${absolute ? SITE_URL : ''}${SEED_PATH}?${query}`;
    if (!view) return url;

    const parts = [];
    if (view.structures?.length) parts.push(`structs=${view.structures.join(',')}`);
    if (view.showCoords === false) parts.push('coords=0');
    if (view.slime) parts.push('slime=1');
    if (view.grid) parts.push('grid=1');
    const hasHeight = (VERSIONS[version] ?? 0) >= HEIGHT_FROM;
    if (hasHeight && view.yHeight !== undefined && view.yHeight !== DEFAULT_VIEW.yHeight) parts.push(`y=${view.yHeight}`);
    return parts.length ? `${url}&${parts.join('&')}` : url;
}
