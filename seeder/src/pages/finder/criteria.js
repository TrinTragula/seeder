import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { DEFAULT_VERSION } from '../../util/seed';
import { versionLabelOf } from '../../shared/seedUrl';

/*
 * The finder's rules: what a search may ask for, what the form warns about, and how
 * much of the seed space a search may scan. Pure, no React. Ids are looked up by
 * label / pureText, never typed as numbers.
 */

const biomeId = (label) => BIOMES.find((b) => b.label === label).value;
const structureType = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;

const THE_END = biomeId('The End');
const RUINED_PORTAL = structureType('Ruined Portal');

// Biomes are 3D from 1.18 on; 1.18 itself has a height, hence `>=`.
export const HEIGHT_FROM = VERSIONS['1.18'];

export const DEFAULT_CRITERIA = {
    mcVersion: VERSIONS[DEFAULT_VERSION],
    dimension: 0,
    largeBiomes: false, // the world type: Large Biomes (1.3+) instead of Default
    yHeight: 256,
    biomes: [],         // all of these
    anyBiomes: [],      // at least one of these
    excludeBiomes: [],  // none of these
    structures: [],
    rangeBlocks: 300,
    count: 10,
    startingSeed: 0n,
};

export const RANGE_OPTIONS_BLOCKS = [100, 300, 500, 750, 1000, 2000];
export const COUNT_OPTIONS = [10, 25, 50];
export const MIN_RANGE_BLOCKS = 1;
export const MAX_RANGE_BLOCKS = 2048;       // the engine's box limit (-7 beyond)
export const MAX_BIOMES = 32;          // required, and alternatives: the engine takes 32 of each
export const MAX_EXCLUDE_BIOMES = 64;  // avoided: one bitmask in the engine, long lists are cheap
export const MAX_STRUCTURES = 8;

// The fixed 16 MB WASM heap cannot hold a biome box wider than this (the
// 1.13-1.17 layer caches need 16 MB at ±1500, 1.18+ 20 MB at ±2048). The engine
// answers -8 as a safety net; the form must never offer it.
export const BIOME_RANGE_CAP = 1000;
export const BIOME_RANGE_CAP_REASON = "Biome boxes above 1,000 blocks do not fit in the engine's memory.";

export const CHECKING_SUPPORT = 'Checking what this version supports…';
export const NO_CRITERION = 'Pick at least one biome or structure.';

const DIMENSION_NAMES = { 0: 'the Overworld', '-1': 'the Nether', 1: 'the End' };
export const dimensionName = (dimension) => DIMENSION_NAMES[dimension] ?? 'the Overworld';

const biomeLabel = (id) => BIOMES.find((b) => b.value === id)?.label ?? `Biome ${id}`;
const structureLabel = (type) => STRUCTURES_OPTIONS.find((s) => s.value === type)?.pureText ?? `Structure ${type}`;
const thousands = (n) => n.toLocaleString('en-US');

// The three biome lists (all of / any of / none of) and whether a search has one.
const biomeLists = (criteria) => [criteria.biomes ?? [], criteria.anyBiomes ?? [], criteria.excludeBiomes ?? []];
export const hasBiomeFilter = (criteria) => biomeLists(criteria).some((list) => list.length > 0);

export const rangeLabel = (blocks) => (blocks >= 1000 && blocks % 1000 === 0 ? `${blocks / 1000}k blocks` : `${blocks} blocks`);

/*
 * The Range select's choices. 2k is SLOW whatever the criteria; with a biome it does
 * not fit in memory at all, so it stays listed (the user learns why) but disabled.
 */
export function rangeChoices(criteria) {
    const withBiomes = hasBiomeFilter(criteria);
    return RANGE_OPTIONS_BLOCKS.map((value) => {
        const disabled = withBiomes && value > BIOME_RANGE_CAP;
        return { value, label: rangeLabel(value), slow: value === 2000, disabled, reason: disabled ? BIOME_RANGE_CAP_REASON : null };
    });
}

/*
 * Why a biome cannot be searched on this version / in this dimension, or null.
 * The phrase is the tail of a sentence: "Cherry Grove <does not exist in 1.12.>".
 */
export function biomeProblem(id, dimension, support) {
    const version = versionLabelOf(support.mcVersion);
    if (!support.biomes.includes(id)) return `does not exist in ${version}.`;
    if (support.biomeDimensions[id] !== dimension) return `does not generate in ${dimensionName(dimension)}.`;
    return null;
}

/*
 * Why a structure cannot be searched, or null. structures[type] is the dimension the
 * type generates in (-100: not on this version). Ruined Portal is reported as
 * Overworld only, but the engine also searches it in the Nether (Ruined_Portal_N; see
 * useVersionSupport). Chunk-scale features (End Gateway: regions under 64 blocks) are
 * not searchable by the region-based engine.
 */
export function structureProblem(type, dimension, support) {
    const dim = support.structures[type];
    if (dim === undefined || dim === -100) return `does not generate in ${versionLabelOf(support.mcVersion)}.`;
    const here = dim === dimension || (type === RUINED_PORTAL && dimension === -1);
    if (!here) return `does not generate in ${dimensionName(dimension)}.`;
    if (!(support.regionBlocks[type] >= 64)) return 'is too small-scale to search for.';
    return null;
}

/*
 * { ok, errors } for a search with these criteria. `support` is the version probe
 * (useVersionSupport) or null while it loads: then only the checks that need no
 * support run, and the answer is "not yet" with the checking message.
 */
export function validate(criteria, support) {
    const errors = [];
    const { structures, rangeBlocks, count, dimension } = criteria;
    const [biomes, anyBiomes, excludeBiomes] = biomeLists(criteria);
    const withBiomes = hasBiomeFilter(criteria);
    if (!withBiomes && structures.length === 0) errors.push(NO_CRITERION);
    if (biomes.length > MAX_BIOMES) errors.push(`Pick at most ${MAX_BIOMES} biomes.`);
    if (anyBiomes.length > MAX_BIOMES) errors.push(`Pick at most ${MAX_BIOMES} alternative biomes.`);
    if (excludeBiomes.length > MAX_EXCLUDE_BIOMES) errors.push(`Avoid at most ${MAX_EXCLUDE_BIOMES} biomes.`);
    // The engine refuses a biome that is both wanted and avoided (-7): say which one.
    for (const id of excludeBiomes) {
        if (biomes.includes(id) || anyBiomes.includes(id)) errors.push(`${biomeLabel(id)} is both wanted and avoided.`);
    }
    if (structures.length > MAX_STRUCTURES) errors.push(`Pick at most ${MAX_STRUCTURES} structures.`);
    if (!Number.isInteger(rangeBlocks) || rangeBlocks < MIN_RANGE_BLOCKS || rangeBlocks > MAX_RANGE_BLOCKS) {
        errors.push(`The range must be between ${MIN_RANGE_BLOCKS} and ${thousands(MAX_RANGE_BLOCKS)} blocks.`);
    } else if (withBiomes && rangeBlocks > BIOME_RANGE_CAP) {
        errors.push(`${BIOME_RANGE_CAP_REASON} Pick ${thousands(BIOME_RANGE_CAP)} blocks or less.`);
    }
    if (!COUNT_OPTIONS.includes(count)) errors.push(`Results must be ${COUNT_OPTIONS.slice(0, -1).join(', ')} or ${COUNT_OPTIONS.at(-1)}.`);

    if (!support) return { ok: false, errors: [...errors, CHECKING_SUPPORT] };

    for (const id of new Set([biomes, anyBiomes, excludeBiomes].flat())) {
        const problem = biomeProblem(id, dimension, support);
        if (problem) errors.push(`${biomeLabel(id)} ${problem}`);
    }
    for (const type of structures) {
        const problem = structureProblem(type, dimension, support);
        if (problem) {
            errors.push(`${structureLabel(type)} ${problem}`);
            continue;
        }
        // End cities never generate within 1008 blocks of the centre (engine -9).
        const minDistance = support.minDistance?.[type] ?? 0;
        if (minDistance > 0 && Number.isInteger(rangeBlocks) && rangeBlocks >= MIN_RANGE_BLOCKS && rangeBlocks < minDistance) {
            errors.push(`${structureLabel(type)} only generates more than ${thousands(minDistance)} blocks from the centre: set the range to at least ${thousands(minDistance)} blocks.`);
        }
    }
    return { ok: errors.length === 0, errors };
}

/*
 * The criteria without the selections this support cannot hold (after a version or
 * dimension change), plus what was removed and why: [{ label, problem }], where
 * problem finishes "it …" ("does not exist in 1.12.").
 */
export function dropUnsupported(criteria, support) {
    const removed = [];
    const keepBiomes = (list = []) => list.filter((id) => {
        const problem = biomeProblem(id, criteria.dimension, support);
        if (problem) removed.push({ label: biomeLabel(id), problem });
        return !problem;
    });
    const biomes = keepBiomes(criteria.biomes);
    const anyBiomes = keepBiomes(criteria.anyBiomes);
    const excludeBiomes = keepBiomes(criteria.excludeBiomes);
    const structures = criteria.structures.filter((type) => {
        const problem = structureProblem(type, criteria.dimension, support);
        if (problem) removed.push({ label: structureLabel(type), problem });
        return !problem;
    });
    return { criteria: removed.length ? { ...criteria, biomes, anyBiomes, excludeBiomes, structures } : criteria, removed };
}

// Per-core cost of one biome check, µs per cell of the box (measured; the same
// constants queue.js' shardLenFor uses).
const CELL_COST_US = { overworld: 2.7, nether: 0.13, end: 1.7 };
const cellsFor = (rangeBlocks) => 2 * Math.ceil(rangeBlocks / 4);

// The biome-only rate the user should expect.
function biomeRate({ mcVersion, dimension, rangeBlocks }) {
    if (dimension === -1) return '~300 seeds/s per core';
    if (dimension === 1) return '~25 seeds/s per core';
    if (mcVersion < HEIGHT_FROM) return '~11k seeds/s per core';
    if (rangeBlocks <= 100) return '~120 seeds/s per core';
    if (rangeBlocks <= 300) return '~12 seeds/s per core';
    return '~5 seeds/s per core';
}

/*
 * What speed to expect, in words. With a structure the engine rejects most layouts
 * with RNG alone before any biome is generated, so structures set the pace.
 */
export function rateHint(criteria) {
    if (criteria.structures.length > 0) return 'thousands of layouts per second';
    return biomeRate(criteria);
}

// The finder's slowness warnings, as sentences.
export function warningsFor(criteria) {
    const { structures, rangeBlocks, mcVersion, dimension } = criteria;
    const withBiomes = hasBiomeFilter(criteria);
    const warnings = [];
    if (structures.length > 1) {
        warnings.push('Each extra structure multiplies the odds: matches get much rarer and the search slower.');
    }
    if (withBiomes && dimension === 0 && mcVersion >= HEIGHT_FROM && rangeBlocks > 300) {
        warnings.push(`Biomes on 1.18+ are slow beyond 300 blocks: expect ${biomeRate(criteria)}.`);
    }
    if (structures.length > 0 && rangeBlocks >= 2000) {
        warnings.push('2k blocks covers many regions per structure: each seed takes longer to check.');
    }
    if (dimension === 1 && [...(criteria.biomes ?? []), ...(criteria.anyBiomes ?? [])].some((id) => id !== THE_END)) {
        warnings.push('Within about 1,000 blocks the End has only The End biome: other End biomes will not be found here.');
    }
    return warnings;
}

/*
 * How many candidates a search may scan before it reports "exhausted":
 * structure modes 50 M families; biome-only ≤ 1.17 Overworld 5 M seeds; otherwise
 * about ten minutes of one core, clamp(600e6 µs / (cells² × µs per cell), 1e3, 50e6).
 * The Nether and the End use their own cost per cell, whatever the version (the
 * 1.16+ Nether noise costs the same on every version).
 */
export function maxSeedsToScanFor(criteria) {
    if (criteria.structures.length > 0) return 50_000_000n;
    const { dimension, mcVersion, rangeBlocks } = criteria;
    if (dimension === 0 && mcVersion < HEIGHT_FROM) return 5_000_000n;
    const cost = dimension === -1 ? CELL_COST_US.nether : dimension === 1 ? CELL_COST_US.end : CELL_COST_US.overworld;
    const cells = cellsFor(rangeBlocks);
    const seeds = Math.round(600e6 / (cells * cells * cost));
    return BigInt(Math.min(50e6, Math.max(1e3, seeds)));
}
