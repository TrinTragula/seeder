// The preset catalogue: ids resolve, groups and the pinned group follow the proposal
// (docs/presets-proposal.md), availability is decided by the version probe, and a pinned
// preset switches an older version to the newest one.
import { describe, it, expect } from 'vitest';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { defaultVersionSupport } from '../../test/fakes';
import { CHECKING_SUPPORT, DEFAULT_CRITERIA, validate } from './criteria';
import {
    NEWEST_MC, PINNED_GROUP, PRESETS, PRESET_GROUPS, presetAvailable, presetBadge, presetCaption, presetCriteria, presetVersion, presetsOf,
} from './presets.js';   // explicit: Presets.jsx differs only in case

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const bySlug = (slug) => PRESETS.find((p) => p.slug === slug);
const ALL_BIOMES = BIOMES.map((b) => b.value);
const ALL_TYPES = STRUCTURES_OPTIONS.map((s) => s.value);
const NETHER = ['Fortress', 'Bastion'].map(structure);
const NETHER_BIOMES = ['Nether Wastes', 'Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Delta'].map(biome);
const newestLabel = Object.keys(VERSIONS).find((k) => VERSIONS[k] === NEWEST_MC);
const yearOf = (label) => label.split('.')[0];

// Every biome and structure exists, each in its real dimension.
function support(mcVersion, patch = {}) {
    const s = defaultVersionSupport(mcVersion, ALL_BIOMES, ALL_TYPES);
    for (const t of NETHER) s.structures[t] = -1;
    s.structures[structure('End City')] = 1;
    for (const id of NETHER_BIOMES) s.biomeDimensions[id] = -1;
    s.minDistance[structure('End City')] = 1008;
    return { ...s, ...patch };
}

describe('PRESETS', () => {
    it('has the seven groups, pinned first, and the thirty-eight slugs in order', () => {
        expect(PRESET_GROUPS.map((g) => g.title)).toEqual([
            `New in ${newestLabel}`, 'Survival starts', 'Speedrun', 'Jackpot seeds', "Builders' biomes", 'Structure hunts', 'Nether & End',
        ]);
        expect(PRESET_GROUPS[0].id).toBe(PINNED_GROUP);
        expect(new Set(PRESETS.map((p) => p.group))).toEqual(new Set(PRESET_GROUPS.map((g) => g.id)));
        expect(PRESET_GROUPS.flatMap((g) => presetsOf(g.id).map((p) => p.slug))).toEqual([
            'camp-at-spawn', 'autumn-camp', 'haunted-camp', 'autumn-blossom', 'everything-new', 'sulfur-village',
            'village-at-spawn', 'villagers-pillagers', 'witch-next-door', 'village-lush-caves', 'mushroom-island', 'island-monument', 'survival-island',
            'classic-fast-start', 'shipwreck-start', 'temple-start', 'triple-start', 'bastion-fortress',
            'structure-jackpot', 'six-pack', 'loot-run', 'pale-manor', 'mansion-village',
            'cherry-grove', 'cherry-village', 'pale-garden', 'alpine-meadow', 'ice-spikes', 'flower-village',
            'mansion-near-spawn', 'ancient-city', 'monument', 'trail-ruin', 'jungle-temple-bamboo',
            'happy-ghast-start', 'safe-nether-base', 'nether-sampler', 'first-end-city',
        ]);
        expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
    });

    it('resolves every id in constants.jsx and never carries a version', () => {
        const biomeIds = new Set(ALL_BIOMES);
        const types = new Set(ALL_TYPES);
        for (const p of PRESETS) {
            expect(p.criteria.biomes.every((id) => biomeIds.has(id)), p.slug).toBe(true);
            expect(p.criteria.structures.every((t) => types.has(t)), p.slug).toBe(true);
            expect(p.criteria.biomes.length + p.criteria.structures.length, p.slug).toBeGreaterThan(0);
            expect(p.criteria).not.toHaveProperty('mcVersion');
        }
        expect(bySlug('village-at-spawn').criteria).toMatchObject({ biomes: [], structures: [structure('Village')], rangeBlocks: 100 });
        expect(bySlug('pale-manor').criteria).toMatchObject({ biomes: [biome('Pale Garden')], structures: [structure('Mansion')], rangeBlocks: 300 });
        expect(bySlug('six-pack').criteria.structures).toHaveLength(6);
    });

    it('sets a dimension on the Nether and End presets only, and a low Y on the cave ones only', () => {
        expect(PRESETS.filter((p) => p.criteria.dimension === -1).map((p) => p.slug))
            .toEqual(['bastion-fortress', 'happy-ghast-start', 'safe-nether-base', 'nether-sampler']);
        expect(PRESETS.filter((p) => p.criteria.dimension === 1).map((p) => p.slug)).toEqual(['first-end-city']);
        expect(PRESETS.filter((p) => p.criteria.yHeight !== DEFAULT_CRITERIA.yHeight).map((p) => [p.slug, p.criteria.yHeight]))
            .toEqual([['everything-new', 0], ['sulfur-village', 0], ['village-lush-caves', 0], ['survival-island', 62]]);
        // Ruined Portal presets search the Overworld.
        for (const slug of ['classic-fast-start', 'shipwreck-start', 'temple-start', 'triple-start']) expect(bySlug(slug).criteria.dimension).toBe(0);
    });

    it('Survival island: Mushroom Fields in open ocean at sea level, every land biome avoided', () => {
        const { criteria, since, group } = bySlug('survival-island');
        expect(group).toBe('survival');
        expect(since).toBe(VERSIONS['26.3']);
        expect(criteria).toMatchObject({ biomes: [biome('Mushroom Fields')], anyBiomes: [], rangeBlocks: 150, yHeight: 62, dimension: 0 });
        const avoided = criteria.excludeBiomes.map((id) => BIOMES.find((b) => b.value === id).label);
        expect(avoided).toEqual(expect.arrayContaining(['Plains', 'Beach', 'Stony Shore', 'Cherry Grove', 'Dappled Forest', 'Deep Dark']));
        expect(avoided.some((label) => /Ocean|River|Mushroom/.test(label))).toBe(false);
        expect(new Set(criteria.excludeBiomes).size).toBe(criteria.excludeBiomes.length);
        // The pinned-group rule: an older version switches to the newest instead of greying out.
        expect(presetVersion(bySlug('survival-island'), VERSIONS['1.21.1'])).toBe(NEWEST_MC);
    });

    it('badges only pinned presets from an earlier drop: Survival island\'s `since` never shows', () => {
        expect(presetBadge(bySlug('sulfur-village'))).toBe('26.2');
        expect(presetBadge(bySlug('camp-at-spawn'))).toBeNull();
        expect(presetBadge(bySlug('village-at-spawn'))).toBeNull();
        // After the next version, a `since` older than the newest: still no badge outside the pinned group.
        const older = VERSIONS['26.2'];
        expect(presetBadge({ ...bySlug('survival-island'), since: older })).toBeNull();
        expect(presetBadge({ ...bySlug('camp-at-spawn'), since: older })).toBe('26.2');
    });

    it('passes the form\'s validation on the newest version: ranges, caps, the End city distance', () => {
        const s = support(NEWEST_MC);
        for (const p of PRESETS) expect(validate(presetCriteria(p, NEWEST_MC), s), p.slug).toEqual({ ok: true, errors: [] });
    });
});

describe('the pinned group', () => {
    const pinned = presetsOf(PINNED_GROUP);

    it('only its presets (and Survival island) carry the version that added their content, newest drop first', () => {
        for (const p of PRESETS) expect(p.since != null, p.slug).toBe(p.group === PINNED_GROUP || p.slug === 'survival-island');
        const since = pinned.map((p) => p.since);
        expect(since).toEqual([...since].sort((a, b) => b - a));
        expect(bySlug('sulfur-village').since).toBe(VERSIONS['26.2']);
        expect(bySlug('camp-at-spawn').since).toBe(VERSIONS['26.3']);
    });

    // Fails on the first version bump of a new year, or when the group grows past 6:
    // refresh the group (UPDATING.MD, "Refresh the pinned presets").
    it('holds 1 to 6 presets, all from the newest version\'s year', () => {
        expect(pinned.length).toBeGreaterThanOrEqual(1);
        expect(pinned.length).toBeLessThanOrEqual(6);
        for (const p of pinned) {
            const label = Object.keys(VERSIONS).find((k) => VERSIONS[k] === p.since);
            expect(yearOf(label), p.slug).toBe(yearOf(newestLabel));
            expect(p.since).toBeLessThanOrEqual(NEWEST_MC);
        }
    });

    it('switches an older version to the newest one; the version of its content or later stays', () => {
        const camp = bySlug('camp-at-spawn');
        const sulfur = bySlug('sulfur-village');
        expect(presetVersion(camp, VERSIONS['1.20'])).toBe(NEWEST_MC);
        expect(presetVersion(camp, VERSIONS['26.3'])).toBe(VERSIONS['26.3']);
        expect(presetVersion(sulfur, VERSIONS['26.1'])).toBe(NEWEST_MC);
        expect(presetVersion(sulfur, VERSIONS['26.2'])).toBe(VERSIONS['26.2']);
        expect(presetCriteria(camp, VERSIONS['1.20']).mcVersion).toBe(NEWEST_MC);
        // Every other group applies on the current version.
        expect(presetVersion(bySlug('village-at-spawn'), VERSIONS['1.20'])).toBe(VERSIONS['1.20']);
    });

    it('is available on a version without its content, since it switches', () => {
        const old = support(VERSIONS['1.20'], { biomes: ALL_BIOMES.filter((id) => ![biome('Dappled Forest'), biome('Sulfur Caves')].includes(id)) });
        old.structures[structure('Abandoned Camp')] = -100;
        for (const p of pinned) expect(presetAvailable(p, old), p.slug).toEqual({ ok: true, reason: null });
        expect(presetAvailable(bySlug('camp-at-spawn'), null)).toEqual({ ok: false, reason: CHECKING_SUPPORT });
    });
});

describe('presetCaption', () => {
    it('lists the biomes, then the structures, then the range, the dimension and a non-default Y', () => {
        expect(presetCaption(bySlug('village-at-spawn'))).toBe('Village, 100 blocks');
        expect(presetCaption(bySlug('pale-manor'))).toBe('Pale Garden + Mansion, 300 blocks');
        expect(presetCaption(bySlug('sulfur-village'))).toBe('Sulfur Caves + Village, 300 blocks, Y 0');
        expect(presetCaption(bySlug('bastion-fortress'))).toBe('Bastion + Fortress, 200 blocks, Nether');
        expect(presetCaption(bySlug('first-end-city'))).toBe('End City, 1,100 blocks, End');
    });

    it('reads alternatives as "or", names a short avoid list and counts a long one', () => {
        expect(presetCaption(bySlug('survival-island'))).toBe(`Mushroom Fields, avoids ${bySlug('survival-island').criteria.excludeBiomes.length} biomes, 150 blocks, Y 62`);
        const made = (criteria) => presetCaption({ criteria: { biomes: [], anyBiomes: [], excludeBiomes: [], structures: [], rangeBlocks: 300, dimension: 0, yHeight: 256, ...criteria } });
        expect(made({ anyBiomes: [biome('Snowy Plains'), biome('Ice Spikes')], structures: [structure('Village')] })).toBe('Snowy Plains or Ice Spikes + Village, 300 blocks');
        expect(made({ biomes: [biome('Plains')], excludeBiomes: [biome('Ocean'), biome('Deep Ocean')] })).toBe('Plains, no Ocean or Deep Ocean, 300 blocks');
    });

    it('never uses "·", which the pixel font draws as a minus', () => {
        for (const p of PRESETS) expect(presetCaption(p), p.slug).not.toContain('·');
    });
});

describe('presetAvailable', () => {
    it('is available when everything exists in the preset\'s dimension', () => {
        const s = support(VERSIONS['26.3']);
        for (const p of PRESETS) expect(presetAvailable(p, s), p.slug).toEqual({ ok: true, reason: null });
    });

    it('names a biome missing from the version', () => {
        const s = support(VERSIONS['1.12'], { biomes: ALL_BIOMES.filter((id) => id !== biome('Cherry Grove')) });
        expect(presetAvailable(bySlug('cherry-grove'), s)).toEqual({ ok: false, reason: 'Cherry Grove does not exist in 1.12.' });
        expect(presetAvailable(bySlug('cherry-village'), s)).toEqual({ ok: false, reason: 'Cherry Grove does not exist in 1.12.' });
    });

    it('names a structure missing from the version', () => {
        const s = support(VERSIONS['1.16.5']);
        s.structures[structure('Trial Chamber')] = -100;
        expect(presetAvailable(bySlug('loot-run'), s)).toEqual({ ok: false, reason: 'Trial Chamber does not generate in 1.16.5.' });
    });

    it('names a structure of another dimension', () => {
        const s = support(VERSIONS['26.3']);
        s.structures[structure('Fortress')] = 0;
        expect(presetAvailable(bySlug('bastion-fortress'), s)).toEqual({ ok: false, reason: 'Fortress does not generate in the Nether.' });
    });

    it('waits while the version is being checked', () => {
        expect(presetAvailable(bySlug('village-at-spawn'), null)).toEqual({ ok: false, reason: CHECKING_SUPPORT });
    });
});

describe('presetCriteria', () => {
    it('applies on top of the current version and starts over from seed 0', () => {
        const c = presetCriteria(bySlug('bastion-fortress'), VERSIONS['1.16.5']);
        expect(c).toEqual({
            ...DEFAULT_CRITERIA, mcVersion: VERSIONS['1.16.5'], dimension: -1,
            structures: [structure('Bastion'), structure('Fortress')], biomes: [], rangeBlocks: 200, yHeight: 256, startingSeed: 0n,
        });
        expect(typeof c.startingSeed).toBe('bigint');
    });

    it('carries the preset\'s Y', () => {
        expect(presetCriteria(bySlug('village-lush-caves'), VERSIONS['26.3']).yHeight).toBe(0);
    });
});
