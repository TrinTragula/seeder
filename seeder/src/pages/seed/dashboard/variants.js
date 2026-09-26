import { BIOMES, STRUCTURES_OPTIONS } from '../../../util/constants';

/*
 * Variant badges for a structure instance, from STRUCTURE_VARIANT's `variant` object,
 * i.e. from what cubiomes' getVariant (finders.c) actually sets. Ids are looked up by
 * label: constants.jsx mirrors cubiomes' enums and is the only place numbers live.
 */

function idsByLabel(list, key, labels) {
    return labels.map((label) => {
        const entry = list.find((item) => item[key] === label);
        if (!entry) throw new Error(`variants.js: no "${label}" in constants.jsx`);
        return entry.value;
    });
}
const biomeId = (label) => idsByLabel(BIOMES, 'label', [label])[0];
const typeId = (pureText) => idsByLabel(STRUCTURES_OPTIONS, 'pureText', [pureText])[0];

const IGLOO = typeId('Igloo');
const VILLAGE = typeId('Village');
const SHIPWRECK = typeId('Shipwreck');
const RUINED_PORTAL = typeId('Ruined Portal');
const BASTION = typeId('Bastion');
const END_CITY = typeId('End City');

/*
 * The types that can carry a badge; only these get a STRUCTURE_VARIANT request.
 * Shipwreck is in: getVariant tells beached wrecks apart (`isBeached = !isOceanic(biome)`,
 * which picks the wreck's template set), and the engine returns that biome.
 */
export const VARIANT_TYPES = new Set([IGLOO, VILLAGE, SHIPWRECK, RUINED_PORTAL, BASTION, END_CITY]);

// Village types by the biome getVariant chose the start piece for (1.14+; meadow is
// already reported as plains). cubiomes calls snowy plains snowy_tundra.
export const VILLAGE_BIOME_LABELS = {
    [biomeId('Plains')]: 'Plains village',
    [biomeId('Desert')]: 'Desert village',
    [biomeId('Savanna')]: 'Savanna village',
    [biomeId('Taiga')]: 'Taiga village',
    [biomeId('Snowy Plains')]: 'Snowy village',
};

// Ruined portal looks by getVariant's biome category. Plains is the standard portal
// (no badge); "mountains" is cubiomes' name for windswept hills.
export const PORTAL_BIOME_LABELS = {
    [biomeId('Desert')]: 'Desert portal',
    [biomeId('Jungle')]: 'Jungle portal',
    [biomeId('Swamp')]: 'Swamp portal',
    [biomeId('Ocean')]: 'Ocean portal',
    [biomeId('Nether Wastes')]: 'Nether portal',
    [biomeId('Windswept Hills')]: 'Mountain portal',
};

// getVariant's `start` for a bastion (swapped with the rotation on 1.16.1, which
// getVariant already undoes).
const BASTION_LABELS = ['Housing units', 'Hoglin stables', 'Treasure room', 'Bridge'];

// cubiomes' isOceanic(): a wreck anywhere else (beach, snowy beach) is a beached one.
const OCEANS = new Set(idsByLabel(BIOMES, 'label', [
    'Ocean', 'Frozen Ocean', 'Deep Ocean', 'Warm Ocean', 'Lukewarm Ocean', 'Cold Ocean',
    'Deep Warm Ocean', 'Deep Lukewarm Ocean', 'Deep Cold Ocean', 'Deep Frozen Ocean',
]));

const badge = (key, label, tone) => ({ key, label, tone });

/*
 * badgesFor(type, variant) -> [{ key, label, tone: 'accent' | 'muted' | 'danger' }].
 * Pure. `supported 0` (no getVariant data) means no badges, except for End cities,
 * whose `endShip` comes from their pieces, not from getVariant. Rotation, mirror and
 * sizes never become badges; unknown values are skipped.
 */
export function badgesFor(type, variant) {
    if (!variant) return [];
    if (type === END_CITY) {
        if (variant.endShip === 1) return [badge('end-ship', 'Has ship (elytra)', 'accent')];
        if (variant.endShip === 0) return [badge('end-ship', 'No ship', 'muted')];
        return [];
    }
    if (variant.supported !== 1) return [];
    const badges = [];
    switch (type) {
    case VILLAGE:
        if (variant.abandoned === 1) badges.push(badge('abandoned', 'Zombie village', 'danger'));
        // Before 1.14 getVariant has no start piece (start -1) and does not pick a
        // village type; the biome the engine then reports is only the sampled one, so
        // no type badge there.
        if (variant.start >= 0 && VILLAGE_BIOME_LABELS[variant.biome]) {
            badges.push(badge('village-biome', VILLAGE_BIOME_LABELS[variant.biome], 'accent'));
        }
        break;
    case RUINED_PORTAL:
        if (variant.giant === 1) badges.push(badge('giant', 'Giant', 'accent'));
        if (variant.underground === 1) badges.push(badge('underground', 'Underground', 'muted'));
        if (variant.airpocket === 1) badges.push(badge('airpocket', 'Air pocket', 'muted'));
        if (PORTAL_BIOME_LABELS[variant.biome]) badges.push(badge('portal-biome', PORTAL_BIOME_LABELS[variant.biome], 'muted'));
        break;
    case BASTION:
        if (BASTION_LABELS[variant.start]) badges.push(badge('bastion', BASTION_LABELS[variant.start], 'accent'));
        break;
    case IGLOO:
        if (variant.basement === 1) badges.push(badge('basement', 'With basement', 'accent'));
        break;
    case SHIPWRECK:
        // A muted "Beached" badge; an ocean wreck has none.
        if (variant.biome >= 0 && !OCEANS.has(variant.biome)) badges.push(badge('beached', 'Beached', 'muted'));
        break;
    default:
        break;
    }
    return badges;
}
