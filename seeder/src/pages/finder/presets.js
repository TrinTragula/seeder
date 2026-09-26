import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { versionLabelOf } from '../../shared/seedUrl';
import { CHECKING_SUPPORT, DEFAULT_CRITERIA, biomeProblem, dimensionName } from './criteria';

/*
 * Ready-made searches, grouped (docs/presets-proposal.md). A preset carries only what
 * defines it - biomes, structures, range, dimension, height - never a version: it
 * applies on top of the version the visitor is looking at, and is greyed out where it
 * cannot work. The pinned first group is the exception: its presets carry the version
 * that added their content (`since`), and on an older version they switch to the newest
 * one instead of greying out. Ids are looked up by label / pureText (a typo throws at
 * import, which the tests see).
 */

const biome = (label) => {
    const found = BIOMES.find((b) => b.label === label);
    if (!found) throw new Error(`presets: unknown biome "${label}"`);
    return found.value;
};
const structure = (pureText) => {
    const found = STRUCTURES_OPTIONS.find((s) => s.pureText === pureText);
    if (!found) throw new Error(`presets: unknown structure "${pureText}"`);
    return found.value;
};
const version = (label) => {
    if (!(label in VERSIONS)) throw new Error(`presets: unknown version "${label}"`);
    return VERSIONS[label];
};

export const NEWEST_MC = Math.max(...Object.values(VERSIONS));

// The pinned group: what the newest drops added to world generation. Its title follows
// the version list; its presets are refreshed on every version update (UPDATING.MD).
export const PINNED_GROUP = 'new';

export const PRESET_GROUPS = [
    { id: PINNED_GROUP, title: `New in ${versionLabelOf(NEWEST_MC)}` },
    { id: 'survival', title: 'Survival starts' },
    { id: 'speedrun', title: 'Speedrun' },
    { id: 'jackpot', title: 'Jackpot seeds' },
    { id: 'builders', title: "Builders' biomes" },
    { id: 'structures', title: 'Structure hunts' },
    { id: 'nether-end', title: 'Nether & End' },
];

const preset = (slug, group, label, { biomes = [], structures = [], rangeBlocks, dimension = 0, yHeight = DEFAULT_CRITERIA.yHeight, since = null }) => ({
    slug, group, label, since: since && version(since),
    criteria: { biomes: biomes.map(biome), structures: structures.map(structure), rangeBlocks, dimension, yHeight },
});

// Cave biomes only exist underground: Y 0 is where Sulfur Caves and Lush Caves peak.
const CAVES = 0;

export const PRESETS = [
    // Newest drop first, then the earlier drops of the same year.
    preset('camp-at-spawn', 'new', 'Camp at spawn', { structures: ['Abandoned Camp'], rangeBlocks: 100, since: '26.3' }),
    preset('autumn-camp', 'new', 'Autumn camp', { biomes: ['Dappled Forest'], structures: ['Abandoned Camp'], rangeBlocks: 300, since: '26.3' }),
    preset('haunted-camp', 'new', 'Haunted camp', { biomes: ['Pale Garden'], structures: ['Abandoned Camp'], rangeBlocks: 300, since: '26.3' }),
    preset('autumn-blossom', 'new', 'Autumn blossom', { biomes: ['Dappled Forest', 'Cherry Grove'], rangeBlocks: 300, since: '26.3' }),
    preset('everything-new', 'new', 'Everything new', {
        biomes: ['Sulfur Caves', 'Dappled Forest'], structures: ['Abandoned Camp'], rangeBlocks: 300, yHeight: CAVES, since: '26.3',
    }),
    preset('sulfur-village', 'new', 'Sulfur village', { biomes: ['Sulfur Caves'], structures: ['Village'], rangeBlocks: 300, yHeight: CAVES, since: '26.2' }),

    preset('village-at-spawn', 'survival', 'Village at spawn', { structures: ['Village'], rangeBlocks: 100 }),
    preset('villagers-pillagers', 'survival', 'Villagers & Pillagers', { structures: ['Village', 'Outpost'], rangeBlocks: 300 }),
    preset('witch-next-door', 'survival', 'Witch next door', { structures: ['Village', 'Swamp Hut'], rangeBlocks: 150 }),
    preset('village-lush-caves', 'survival', 'Village + Lush Caves', { biomes: ['Lush Caves'], structures: ['Village'], rangeBlocks: 300, yHeight: CAVES }),
    preset('mushroom-island', 'survival', 'Mushroom island at spawn', { biomes: ['Mushroom Fields'], rangeBlocks: 100 }),
    preset('island-monument', 'survival', 'Island + Monument', { biomes: ['Mushroom Fields'], structures: ['Monument'], rangeBlocks: 300 }),

    preset('classic-fast-start', 'speedrun', 'Classic fast start', { structures: ['Village', 'Ruined Portal'], rangeBlocks: 150 }),
    preset('shipwreck-start', 'speedrun', 'Shipwreck start', { structures: ['Shipwreck', 'Ruined Portal'], rangeBlocks: 150 }),
    preset('temple-start', 'speedrun', 'Temple start', { structures: ['Desert Pyramid', 'Ruined Portal'], rangeBlocks: 150 }),
    preset('triple-start', 'speedrun', 'Triple start', { structures: ['Village', 'Shipwreck', 'Ruined Portal'], rangeBlocks: 200 }),
    preset('bastion-fortress', 'speedrun', 'Bastion + Fortress', { structures: ['Bastion', 'Fortress'], rangeBlocks: 200, dimension: -1 }),

    preset('structure-jackpot', 'jackpot', 'Structure jackpot', { structures: ['Village', 'Ruined Portal', 'Desert Pyramid', 'Outpost'], rangeBlocks: 300 }),
    preset('six-pack', 'jackpot', 'Six-pack', {
        structures: ['Village', 'Ruined Portal', 'Desert Pyramid', 'Outpost', 'Trial Chamber', 'Ancient City'], rangeBlocks: 300,
    }),
    preset('loot-run', 'jackpot', 'Loot run', { structures: ['Ancient City', 'Trial Chamber'], rangeBlocks: 150 }),
    preset('pale-manor', 'jackpot', 'Pale manor', { biomes: ['Pale Garden'], structures: ['Mansion'], rangeBlocks: 300 }),
    preset('mansion-village', 'jackpot', 'Mansion + Village', { structures: ['Mansion', 'Village'], rangeBlocks: 300 }),

    preset('cherry-grove', 'builders', 'Cherry Grove at spawn', { biomes: ['Cherry Grove'], rangeBlocks: 100 }),
    preset('cherry-village', 'builders', 'Cherry village', { biomes: ['Cherry Grove'], structures: ['Village'], rangeBlocks: 150 }),
    preset('pale-garden', 'builders', 'Pale Garden at spawn', { biomes: ['Pale Garden'], rangeBlocks: 100 }),
    preset('alpine-meadow', 'builders', 'Alpine meadow', { biomes: ['Meadow', 'Cherry Grove'], rangeBlocks: 300 }),
    preset('ice-spikes', 'builders', 'Ice Spikes', { biomes: ['Ice Spikes'], rangeBlocks: 300 }),
    preset('flower-village', 'builders', 'Flower village', { biomes: ['Flower Forest'], structures: ['Village'], rangeBlocks: 300 }),

    preset('mansion-near-spawn', 'structures', 'Mansion near spawn', { structures: ['Mansion'], rangeBlocks: 300 }),
    preset('ancient-city', 'structures', 'Ancient City at spawn', { structures: ['Ancient City'], rangeBlocks: 100 }),
    preset('monument', 'structures', 'Monument at spawn', { structures: ['Monument'], rangeBlocks: 100 }),
    preset('trail-ruin', 'structures', 'Trail Ruin', { structures: ['Trail Ruin'], rangeBlocks: 150 }),
    preset('jungle-temple-bamboo', 'structures', 'Jungle temple in bamboo', { biomes: ['Bamboo Jungle'], structures: ['Jungle Pyramid'], rangeBlocks: 300 }),

    preset('happy-ghast-start', 'nether-end', 'Happy ghast start', { biomes: ['Soul Sand Valley'], structures: ['Fortress'], rangeBlocks: 150, dimension: -1 }),
    preset('safe-nether-base', 'nether-end', 'Safe Nether base', { biomes: ['Warped Forest'], structures: ['Bastion'], rangeBlocks: 150, dimension: -1 }),
    preset('nether-sampler', 'nether-end', 'Nether sampler', {
        biomes: ['Crimson Forest', 'Warped Forest', 'Soul Sand Valley', 'Basalt Delta'], rangeBlocks: 150, dimension: -1,
    }),
    // End cities never generate within 1,008 blocks of the centre.
    preset('first-end-city', 'nether-end', 'First End City', { structures: ['End City'], rangeBlocks: 1100, dimension: 1 }),
];

// A group's presets in display order; the pinned group lists the newest drop first.
export function presetsOf(group) {
    const list = PRESETS.filter((p) => p.group === group);
    return group === PINNED_GROUP ? [...list].sort((a, b) => b.since - a.since) : list;
}

const biomeLabel = (id) => BIOMES.find((b) => b.value === id).label;
const structureLabel = (type) => STRUCTURES_OPTIONS.find((s) => s.value === type).pureText;

/*
 * What a preset searches, in plain words, for the line under its catchy name:
 * "Pale Garden + Mansion, 300 blocks", "Sulfur Caves + Village, 300 blocks, Y 0",
 * "Bastion + Fortress, 200 blocks, Nether". No "·": the pixel font draws it as a minus.
 */
export function presetCaption({ criteria }) {
    const { biomes, structures, rangeBlocks, dimension, yHeight } = criteria;
    const parts = [
        [...biomes.map(biomeLabel), ...structures.map(structureLabel)].join(' + '),
        `${rangeBlocks.toLocaleString('en-US')} blocks`,
    ];
    if (dimension === -1) parts.push('Nether');
    if (dimension === 1) parts.push('End');
    if (yHeight !== DEFAULT_CRITERIA.yHeight) parts.push(`Y ${yHeight}`);
    return parts.join(', ');
}

// The version a preset runs on from `mcVersion`: the same one, except for a pinned
// preset whose content is newer than it, which switches to the newest version.
export function presetVersion(preset, mcVersion) {
    return preset.since != null && mcVersion < preset.since ? NEWEST_MC : mcVersion;
}

/*
 * Whether a preset can run on the probed version: every biome must exist there (in
 * the preset's dimension) and every structure must generate in the preset's
 * dimension (Ruined Portal is an Overworld preset, so no Nether special case here).
 * A pinned preset older than its content does not check: it switches version.
 * `support` null (still loading) -> not yet, with the checking message.
 */
export function presetAvailable(preset, support) {
    if (!support) return { ok: false, reason: CHECKING_SUPPORT };
    if (presetVersion(preset, support.mcVersion) !== support.mcVersion) return { ok: true, reason: null };
    const { biomes, structures, dimension } = preset.criteria;
    for (const id of biomes) {
        const problem = biomeProblem(id, dimension, support);
        if (problem) return { ok: false, reason: `${biomeLabel(id)} ${problem}` };
    }
    for (const type of structures) {
        const dim = support.structures[type];
        if (dim === undefined || dim === -100) {
            return { ok: false, reason: `${structureLabel(type)} does not generate in ${versionLabelOf(support.mcVersion)}.` };
        }
        if (dim !== dimension) return { ok: false, reason: `${structureLabel(type)} does not generate in ${dimensionName(dimension)}.` };
    }
    return { ok: true, reason: null };
}

// The full criteria a preset sets: the defaults, the preset, the version it runs on,
// and the search starting over from seed 0.
export function presetCriteria(preset, mcVersion) {
    return { ...DEFAULT_CRITERIA, ...preset.criteria, mcVersion: presetVersion(preset, mcVersion), startingSeed: 0n };
}
