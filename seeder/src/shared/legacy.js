import { canonicalSeed, getInitialVersion } from '../util/seed';
import { buildSeedUrl } from './seedUrl';

// Only a decimal seed is a legacy share link. Text seeds were always hashed and
// rewritten into the URL by the old page, so a non-numeric ?seed= is not one of
// ours and falls through to the landing. The redirect carries the seed Minecraft
// would use for it (canonicalSeed), so it lands on the seed page's canonical URL.
const DECIMAL = /^[+-]?\d+$/;

/*
 * Pre-1.0 share links were /?seed=X&version=Y. Returns the canonical
 * /seed/ URL to replace them with, or null when the query is not a legacy link.
 * The version is normalised to its label (old links carried a numeric index), the
 * dimension is kept when it is Nether or End, and from=legacy tells the seed page
 * to show its one-time "what's new" card - the seed page drops that flag again on
 * its first replaceState, which is why buildSeedUrl never emits it.
 */
export function resolveLegacyRedirect(search) {
    const params = new URLSearchParams(search);
    const seed = (params.get('seed') ?? '').trim();
    if (!DECIMAL.test(seed)) return null;
    const dim = params.get('dim');
    const url = buildSeedUrl({
        seed: canonicalSeed(seed),
        mcVersion: getInitialVersion(params.get('version') ?? undefined),
        dimension: ['-1', '1'].includes(dim) ? Number(dim) : 0,
    });
    return `${url}&from=legacy`;
}
