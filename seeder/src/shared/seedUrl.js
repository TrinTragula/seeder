import { VERSIONS } from '../util/constants';
import { DEFAULT_VERSION, canonicalSeed, getInitialVersion, getRandomSeed } from '../util/seed';

// The seed page lives at one path and publishes one URL shape:
//     /seed/?seed=<decimal>&version=<label>[&dim=-1|1]
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

/*
 * Read the seed page's parameters out of a query string. Never throws: every
 * malformed value falls back to something renderable.
 *   seed    parsed like Minecraft does (canonicalSeed): a signed 64-bit decimal as
 *           its canonical string (never through Number), other text - a decimal
 *           outside the long range included - hashed, nothing at all -> random.
 *   version a VERSIONS label, or a pre-1.0 numeric index via OLD_VERSIONS.
 *   dim     -1 (Nether) or 1 (End); anything else is the Overworld.
 *   from    `legacy` marks a visitor arriving from a pre-1.0 share link.
 */
export function parseSeedPage(search) {
    const params = new URLSearchParams(search);
    const raw = (params.get('seed') ?? '').trim();
    const seed = raw ? canonicalSeed(raw) : getRandomSeed();
    const dim = params.get('dim');
    return {
        seed,
        mcVersion: getInitialVersion(params.get('version') ?? undefined),
        dimension: ['-1', '1'].includes(dim) ? Number(dim) : 0,
        fromLegacy: params.get('from') === 'legacy',
    };
}

/*
 * The canonical URL for a seed page state. `mcVersion` may be the cubiomes int or
 * the label itself. The Overworld is the default, so `dim` is omitted for it -
 * that keeps the common share URL short and makes the contract single-valued.
 * Transient parameters (from=legacy) are never emitted, which is how the first
 * replaceState strips them.
 */
export function buildSeedUrl({ seed, mcVersion, dimension = 0 }, { absolute = false } = {}) {
    const version = typeof mcVersion === 'string' ? mcVersion : versionLabelOf(mcVersion);
    const query = new URLSearchParams({ seed: String(seed), version });
    if (dimension) query.set('dim', String(dimension));
    return `${absolute ? SITE_URL : ''}${SEED_PATH}?${query}`;
}
