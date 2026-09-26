import { BIOMES, STRUCTURES_OPTIONS } from '../../util/constants';
import { useSeedQuery } from './useSeedQuery';

// Every structure type the UI offers (StructureType ints).
export const ALL_STRUCTURE_TYPES = STRUCTURES_OPTIONS.map((s) => s.value);

// Every biome the UI knows (BiomeID ints), e.g. for the biome locator's choices.
export const ALL_BIOME_IDS = BIOMES.map((b) => b.value);

const RUINED_PORTAL = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Ruined Portal').value;

/*
 * What a Minecraft version has: GET_VERSION_SUPPORT through useSeedQuery, so the answer
 * is cached per (version, biomeIds, structTypes) and shared by every caller (the
 * dashboard's Structures and Farms sections, the finder). High priority: it gates what
 * a section lists, and it costs well under a millisecond.
 *
 * `support` is the engine's reply, or null until it lands:
 *   { mcVersion, newest, biomes: [ids that exist], biomeDimensions: { id: dim },
 *     structures: { type: dim | -100 }, regionBlocks: { type: n }, minDistance: { type: n } }
 * where structures[type] is the dimension the type generates in on this version, or
 * -100 when it does not exist there. A failed request (the engine threw, or the worker
 * crashed) carries `error` instead, which useSeedQuery reports as the error.
 *
 * Caveat: Ruined Portal (11) reports the Overworld only, but it also generates in the
 * Nether, and NEAREST_STRUCTURES / STRUCTURE_VARIANT accept type 11 with dimension -1
 * (the engine maps it to Ruined_Portal_N). Callers that list Nether structures add it
 * whenever structures[11] !== -100: structureTypesIn() below does.
 */
export function useVersionSupport(mcVersion, { biomeIds = [], structTypes = ALL_STRUCTURE_TYPES } = {}) {
    const { data, loading, error } = useSeedQuery(
        'GET_VERSION_SUPPORT', { mcVersion, biomeIds, structTypes }, { priority: 'high' });
    return { support: data, loading, error };
}

/*
 * The structure types to offer for this version and dimension: those whose
 * structure_info dimension is this one, plus Ruined Portal in the Nether (see the
 * caveat above). No region-size rule: the map and the dashboard show chunk-scale
 * features too (the finder adds its own, see criteria.js).
 */
export function structureTypesIn(support, dimension) {
    const dims = support.structures;
    return ALL_STRUCTURE_TYPES.filter((type) => dims[type] === dimension
        || (type === RUINED_PORTAL && dimension === -1 && dims[type] != null && dims[type] !== -100));
}

// The biome ids (of those asked for) that exist on this version and generate in this dimension.
export function biomesIn(support, dimension) {
    return support.biomes.filter((id) => support.biomeDimensions[id] === dimension);
}

export default useVersionSupport;
