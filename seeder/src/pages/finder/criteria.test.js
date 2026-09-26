// The finder's rules, pure: what a search may ask for, how the form
// warns, and how far a search may scan.
import { describe, it, expect } from 'vitest';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { defaultVersionSupport } from '../../test/fakes';
import {
    BIOME_RANGE_CAP, BIOME_RANGE_CAP_REASON, CHECKING_SUPPORT, COUNT_OPTIONS, DEFAULT_CRITERIA, MAX_BIOMES, MAX_STRUCTURES, NO_CRITERION,
    MAX_EXCLUDE_BIOMES, RANGE_OPTIONS_BLOCKS, dropUnsupported, maxSeedsToScanFor, rangeChoices, rateHint, validate, warningsFor,
} from './criteria';

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const ALL_BIOMES = BIOMES.map((b) => b.value);
const ALL_TYPES = STRUCTURES_OPTIONS.map((s) => s.value);

const VILLAGE = structure('Village');
const END_CITY = structure('End City');
const END_GATEWAY = structure('End Gateway');
const FORTRESS = structure('Fortress');
const PLAINS = biome('Plains');
const CRIMSON = biome('Crimson Forest');

// A version probe shaped like the engine's: Overworld by default, a few real facts set.
function support(mcVersion = VERSIONS['26.3'], patch = {}) {
    const s = defaultVersionSupport(mcVersion, ALL_BIOMES, ALL_TYPES);
    for (const id of [biome('Nether Wastes'), CRIMSON]) s.biomeDimensions[id] = -1;
    for (const id of [biome('The End'), biome('End Highlands')]) s.biomeDimensions[id] = 1;
    s.structures[FORTRESS] = -1;
    s.structures[END_CITY] = 1;
    s.structures[END_GATEWAY] = 1;
    s.regionBlocks[END_GATEWAY] = 16;
    s.minDistance[END_CITY] = 1008;
    return { ...s, ...patch };
}
const crit = (patch = {}) => ({ ...DEFAULT_CRITERIA, ...patch });

describe('defaults and options', () => {
    it('defaults to 26.3, the Overworld, Y 256, 300 blocks, 10 results from seed 0', () => {
        expect(DEFAULT_CRITERIA).toEqual({
            mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, biomes: [], anyBiomes: [], excludeBiomes: [], structures: [],
            rangeBlocks: 300, count: 10, startingSeed: 0n,
        });
        expect(typeof DEFAULT_CRITERIA.startingSeed).toBe('bigint');
        expect(RANGE_OPTIONS_BLOCKS).toEqual([100, 300, 500, 750, 1000, 2000]);
        expect(COUNT_OPTIONS).toEqual([10, 25, 50]);
        expect(BIOME_RANGE_CAP).toBe(1000);
    });
});

describe('rangeChoices', () => {
    it('labels every range in blocks and flags 2k as slow', () => {
        const choices = rangeChoices(crit());
        expect(choices.map((c) => c.label)).toEqual(['100 blocks', '300 blocks', '500 blocks', '750 blocks', '1k blocks', '2k blocks']);
        expect(choices.filter((c) => c.slow).map((c) => c.value)).toEqual([2000]);
        expect(choices.every((c) => !c.disabled && c.reason === null)).toBe(true);
    });

    it('disables 2k with the memory reason as soon as a biome is selected', () => {
        const choices = rangeChoices(crit({ biomes: [PLAINS] }));
        const twoK = choices.find((c) => c.value === 2000);
        expect(twoK).toMatchObject({ disabled: true, slow: true, reason: BIOME_RANGE_CAP_REASON });
        expect(BIOME_RANGE_CAP_REASON).toBe("Biome boxes above 1,000 blocks do not fit in the engine's memory.");
        expect(choices.filter((c) => c.disabled)).toHaveLength(1);
    });
});

describe('validate', () => {
    it('accepts a structure search the version supports', () => {
        expect(validate(crit({ structures: [VILLAGE] }), support())).toEqual({ ok: true, errors: [] });
    });

    it('needs at least one criterion', () => {
        expect(validate(crit(), support())).toEqual({ ok: false, errors: [NO_CRITERION] });
    });

    it('rejects a structure the version does not have', () => {
        const s = support(VERSIONS['1.12'], {});
        s.structures[structure('Trial Chamber')] = -100;
        const { ok, errors } = validate(crit({ mcVersion: VERSIONS['1.12'], structures: [structure('Trial Chamber')] }), s);
        expect(ok).toBe(false);
        expect(errors).toEqual(['Trial Chamber does not generate in 1.12.']);
    });

    it('rejects a structure of another dimension', () => {
        expect(validate(crit({ structures: [FORTRESS] }), support()).errors).toEqual(['Fortress does not generate in the Overworld.']);
    });

    it('rejects the chunk-scale End Gateway', () => {
        const { errors } = validate(crit({ dimension: 1, structures: [END_GATEWAY], rangeBlocks: 2000 }), support());
        expect(errors).toEqual(['End Gateway is too small-scale to search for.']);
    });

    it('accepts Ruined Portal in the Nether (the engine maps it to the Nether portal)', () => {
        expect(validate(crit({ dimension: -1, structures: [structure('Ruined Portal')] }), support()).ok).toBe(true);
    });

    it('rejects a biome of another dimension, and one the version does not have', () => {
        expect(validate(crit({ biomes: [CRIMSON] }), support()).errors).toEqual(['Crimson Forest does not generate in the Overworld.']);
        const old = support(VERSIONS['1.12'], { biomes: ALL_BIOMES.filter((id) => id !== biome('Cherry Grove')) });
        expect(validate(crit({ mcVersion: VERSIONS['1.12'], biomes: [biome('Cherry Grove')] }), old).errors)
            .toEqual(['Cherry Grove does not exist in 1.12.']);
    });

    it('rejects End City closer than its minimum distance', () => {
        const { ok, errors } = validate(crit({ dimension: 1, structures: [END_CITY], rangeBlocks: 300 }), support());
        expect(ok).toBe(false);
        expect(errors).toEqual(['End City only generates more than 1,008 blocks from the centre: set the range to at least 1,008 blocks.']);
        expect(validate(crit({ dimension: 1, structures: [END_CITY], rangeBlocks: 2000 }), support()).ok).toBe(true);
    });

    it('rejects a range outside 1..2048', () => {
        for (const rangeBlocks of [0, 3000, -5, 1.5]) {
            const { ok, errors } = validate(crit({ structures: [VILLAGE], rangeBlocks }), support());
            expect(ok, String(rangeBlocks)).toBe(false);
            expect(errors).toEqual(['The range must be between 1 and 2,048 blocks.']);
        }
        expect(validate(crit({ structures: [VILLAGE], rangeBlocks: 2048 }), support()).ok).toBe(true);
    });

    it('rejects a range that is not a whole number, whatever the criteria', () => {
        for (const rangeBlocks of [NaN, Infinity, 299.5, '300', null, undefined]) {
            const biomeSearch = validate(crit({ biomes: [PLAINS], rangeBlocks }), support());
            expect(biomeSearch.ok, String(rangeBlocks)).toBe(false);
            expect(biomeSearch.errors, String(rangeBlocks)).toEqual(['The range must be between 1 and 2,048 blocks.']);
            // Nor does a bad range reach the End City distance check.
            expect(validate(crit({ dimension: 1, structures: [END_CITY], rangeBlocks }), support()).errors, String(rangeBlocks))
                .toEqual(['The range must be between 1 and 2,048 blocks.']);
        }
    });

    it(`accepts at most ${MAX_BIOMES} biomes and ${MAX_STRUCTURES} structures`, () => {
        expect(MAX_BIOMES).toBe(32);
        expect(MAX_STRUCTURES).toBe(8);
        const biomes = (n) => Array.from({ length: n }, () => PLAINS);
        const structures = (n) => Array.from({ length: n }, () => VILLAGE);
        expect(validate(crit({ biomes: biomes(MAX_BIOMES) }), support()).ok).toBe(true);
        expect(validate(crit({ biomes: biomes(MAX_BIOMES + 1) }), support()))
            .toEqual({ ok: false, errors: ['Pick at most 32 biomes.'] });
        expect(validate(crit({ structures: structures(MAX_STRUCTURES) }), support()).ok).toBe(true);
        expect(validate(crit({ structures: structures(MAX_STRUCTURES + 1) }), support()))
            .toEqual({ ok: false, errors: ['Pick at most 8 structures.'] });
        // Both limits are support-free: they show while the version is still being checked.
        expect(validate(crit({ biomes: biomes(MAX_BIOMES + 1), structures: structures(MAX_STRUCTURES + 1) }), null).errors)
            .toEqual(['Pick at most 32 biomes.', 'Pick at most 8 structures.', CHECKING_SUPPORT]);
    });

    it('caps biome searches at 1000 blocks', () => {
        const { ok, errors } = validate(crit({ biomes: [PLAINS], rangeBlocks: 2000 }), support());
        expect(ok).toBe(false);
        expect(errors).toEqual([`${BIOME_RANGE_CAP_REASON} Pick 1,000 blocks or less.`]);
        expect(validate(crit({ biomes: [PLAINS], rangeBlocks: 1000 }), support()).ok).toBe(true);
    });

    it('accepts only 10, 25 or 50 results', () => {
        expect(validate(crit({ structures: [VILLAGE], count: 7 }), support()).errors).toEqual(['Results must be 10, 25 or 50.']);
    });

    it('while the version is being checked: never ok, only the support-free checks, plus the checking message', () => {
        expect(validate(crit({ structures: [VILLAGE] }), null)).toEqual({ ok: false, errors: [CHECKING_SUPPORT] });
        expect(validate(crit({ structures: [FORTRESS], count: 7 }), null).errors)
            .toEqual(['Results must be 10, 25 or 50.', CHECKING_SUPPORT]);
        expect(CHECKING_SUPPORT).toBe('Checking what this version supports…');
    });
});

describe('dropUnsupported', () => {
    it('removes what the support cannot hold and says why', () => {
        const s = support(VERSIONS['1.12'], { biomes: ALL_BIOMES.filter((id) => id !== biome('Cherry Grove')) });
        const { criteria, removed } = dropUnsupported(crit({ biomes: [PLAINS, biome('Cherry Grove')], structures: [VILLAGE, FORTRESS] }), s);
        expect(criteria.biomes).toEqual([PLAINS]);
        expect(criteria.structures).toEqual([VILLAGE]);
        expect(removed).toEqual([
            { label: 'Cherry Grove', problem: 'does not exist in 1.12.' },
            { label: 'Fortress', problem: 'does not generate in the Overworld.' },
        ]);
    });

    it('returns the same object when nothing goes', () => {
        const c = crit({ structures: [VILLAGE] });
        expect(dropUnsupported(c, support()).criteria).toBe(c);
    });
});

describe('warningsFor', () => {
    it('none for Village at 300 blocks', () => {
        expect(warningsFor(crit({ structures: [VILLAGE] }))).toEqual([]);
    });

    it('more than one structure', () => {
        expect(warningsFor(crit({ structures: [VILLAGE, structure('Mansion')] })))
            .toEqual(['Each extra structure multiplies the odds: matches get much rarer and the search slower.']);
    });

    it('a biome beyond 300 blocks on 1.18+ (Overworld), with the rate', () => {
        expect(warningsFor(crit({ biomes: [PLAINS], rangeBlocks: 500 })))
            .toEqual(['Biomes on 1.18+ are slow beyond 300 blocks: expect ~5 seeds/s per core.']);
        expect(warningsFor(crit({ biomes: [PLAINS], rangeBlocks: 300 }))).toEqual([]);
        expect(warningsFor(crit({ mcVersion: VERSIONS['1.17'], biomes: [PLAINS], rangeBlocks: 500 }))).toEqual([]);
        expect(warningsFor(crit({ mcVersion: VERSIONS['1.18'], biomes: [PLAINS], rangeBlocks: 500 }))).toHaveLength(1);
    });

    it('2k blocks with a structure', () => {
        expect(warningsFor(crit({ structures: [VILLAGE], rangeBlocks: 2000 })))
            .toEqual(['2k blocks covers many regions per structure: each seed takes longer to check.']);
    });

    it('an End biome other than The End', () => {
        expect(warningsFor(crit({ dimension: 1, biomes: [biome('End Highlands')] })))
            .toEqual(['Within about 1,000 blocks the End has only The End biome: other End biomes will not be found here.']);
        expect(warningsFor(crit({ dimension: 1, biomes: [biome('The End')] }))).toEqual([]);
    });
});

describe('maxSeedsToScanFor', () => {
    it('structures: 50 M families', () => {
        expect(maxSeedsToScanFor(crit({ structures: [VILLAGE] }))).toBe(50_000_000n);
        expect(maxSeedsToScanFor(crit({ structures: [VILLAGE], biomes: [PLAINS] }))).toBe(50_000_000n);
    });

    it('biomes up to 1.17: 5 M seeds', () => {
        expect(maxSeedsToScanFor(crit({ mcVersion: VERSIONS['1.17'], biomes: [PLAINS] }))).toBe(5_000_000n);
    });

    it('biomes on 26.3: about ten core-minutes, larger for smaller boxes', () => {
        const at300 = maxSeedsToScanFor(crit({ biomes: [PLAINS], rangeBlocks: 300 }));
        const at100 = maxSeedsToScanFor(crit({ biomes: [PLAINS], rangeBlocks: 100 }));
        expect(typeof at300).toBe('bigint');
        expect(at300).toBeGreaterThanOrEqual(5_000n);
        expect(at300).toBeLessThanOrEqual(15_000n);
        expect(at100).toBeLessThanOrEqual(50_000_000n);
        expect(at100).toBeGreaterThanOrEqual(at300);
        expect(maxSeedsToScanFor(crit({ biomes: [PLAINS], rangeBlocks: 1000 }))).toBeGreaterThanOrEqual(1_000n);
    });
});

describe('rateHint', () => {
    it('names the pace of each mode', () => {
        expect(rateHint(crit({ biomes: [PLAINS], rangeBlocks: 100 }))).toBe('~120 seeds/s per core');
        expect(rateHint(crit({ biomes: [PLAINS], rangeBlocks: 300 }))).toBe('~12 seeds/s per core');
        expect(rateHint(crit({ biomes: [PLAINS], rangeBlocks: 500 }))).toBe('~5 seeds/s per core');
        expect(rateHint(crit({ mcVersion: VERSIONS['1.17'], biomes: [PLAINS] }))).toBe('~11k seeds/s per core');
        expect(rateHint(crit({ dimension: -1, biomes: [CRIMSON] }))).toBe('~300 seeds/s per core');
        expect(rateHint(crit({ dimension: 1, biomes: [biome('The End')] }))).toBe('~25 seeds/s per core');
        expect(rateHint(crit({ structures: [VILLAGE] }))).toBe('thousands of layouts per second');
        expect(rateHint(crit({ structures: [VILLAGE], biomes: [PLAINS] }))).toBe('thousands of layouts per second');
    });
});

describe('any-of and avoid lists', () => {
    const OCEAN = biome('Ocean');
    const DEEP_OCEAN = biome('Deep Ocean');
    const SNOWY = biome('Snowy Plains');
    const ICE_SPIKES = biome('Ice Spikes');

    it('each list counts as a criterion on its own', () => {
        expect(validate(crit({ excludeBiomes: [OCEAN] }), support())).toEqual({ ok: true, errors: [] });
        expect(validate(crit({ anyBiomes: [SNOWY, ICE_SPIKES] }), support())).toEqual({ ok: true, errors: [] });
    });

    it('caps each list at the engine limit, separately', () => {
        const overworld = ALL_BIOMES.filter((id) => support().biomeDimensions[id] === 0);
        expect(validate(crit({ anyBiomes: overworld.slice(0, MAX_BIOMES + 1) }), support()).errors).toEqual([`Pick at most ${MAX_BIOMES} alternative biomes.`]);
        expect(validate(crit({ anyBiomes: overworld.slice(0, MAX_BIOMES) }), support()).errors).toEqual([]);
        // Avoiding every land biome but one takes 44 ids on 26.3: the avoid list allows 64.
        expect(MAX_EXCLUDE_BIOMES).toBe(64);
        expect(validate(crit({ excludeBiomes: overworld.slice(0, MAX_EXCLUDE_BIOMES) }), support()).errors).toEqual([]);
        expect(validate(crit({ excludeBiomes: ALL_BIOMES.slice(0, MAX_EXCLUDE_BIOMES + 1) }), support()).errors).toContain(`Avoid at most ${MAX_EXCLUDE_BIOMES} biomes.`);
    });

    it('names a biome that is both wanted and avoided', () => {
        expect(validate(crit({ biomes: [PLAINS], excludeBiomes: [PLAINS] }), support()).errors).toEqual(['Plains is both wanted and avoided.']);
        expect(validate(crit({ anyBiomes: [SNOWY, OCEAN], excludeBiomes: [OCEAN] }), support()).errors).toEqual(['Ocean is both wanted and avoided.']);
    });

    it('applies the biome memory cap when only an avoid list is set', () => {
        const { errors } = validate(crit({ excludeBiomes: [OCEAN], rangeBlocks: 1500 }), support());
        expect(errors).toEqual([`${BIOME_RANGE_CAP_REASON} Pick 1,000 blocks or less.`]);
        expect(rangeChoices(crit({ anyBiomes: [SNOWY] })).find((c) => c.value === 2000).disabled).toBe(true);
    });

    it('checks every id of every list against the version and the dimension', () => {
        const s = support(VERSIONS['1.12'], { biomes: ALL_BIOMES.filter((id) => id !== biome('Cherry Grove')) });
        const { errors } = validate(crit({ mcVersion: VERSIONS['1.12'], anyBiomes: [biome('Cherry Grove'), SNOWY], excludeBiomes: [CRIMSON] }), s);
        expect(errors).toEqual(['Cherry Grove does not exist in 1.12.', 'Crimson Forest does not generate in the Overworld.']);
    });

    it('dropUnsupported cleans all three lists', () => {
        const s = support(VERSIONS['1.12'], { biomes: ALL_BIOMES.filter((id) => id !== biome('Cherry Grove')) });
        const { criteria, removed } = dropUnsupported(crit({ biomes: [PLAINS], anyBiomes: [biome('Cherry Grove'), SNOWY], excludeBiomes: [OCEAN, CRIMSON] }), s);
        expect(criteria).toMatchObject({ biomes: [PLAINS], anyBiomes: [SNOWY], excludeBiomes: [OCEAN] });
        expect(removed.map((r) => r.label)).toEqual(['Cherry Grove', 'Crimson Forest']);
    });

    it('warns about slow 1.18+ biome boxes whichever list is set', () => {
        expect(warningsFor(crit({ excludeBiomes: [OCEAN], rangeBlocks: 500 }))).toEqual([`Biomes on 1.18+ are slow beyond 300 blocks: expect ${rateHint(crit({ rangeBlocks: 500 }))}.`]);
    });

    it('the scan cap never grows with exclusions: it already prices every check at the whole box', () => {
        for (const rangeBlocks of [100, 300, 1000]) {
            const plain = maxSeedsToScanFor(crit({ biomes: [PLAINS], rangeBlocks }));
            const avoiding = maxSeedsToScanFor(crit({ biomes: [PLAINS], excludeBiomes: [OCEAN, DEEP_OCEAN], rangeBlocks }));
            expect(avoiding).toBeLessThanOrEqual(plain);
            expect(maxSeedsToScanFor(crit({ excludeBiomes: [OCEAN], rangeBlocks }))).toBeLessThanOrEqual(plain);
        }
        expect(maxSeedsToScanFor(crit({ mcVersion: VERSIONS['1.17'], excludeBiomes: [OCEAN] }))).toBe(5_000_000n);
    });
});
