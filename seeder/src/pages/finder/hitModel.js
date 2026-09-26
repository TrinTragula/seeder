import { STRUCTURES_OPTIONS, BIOMES } from '../../util/constants';
import { STRUCTURE_ICONS } from '../../library/draw';
import { dimensionLabel, distanceBlocks } from '../../shared/format';
import { versionLabelOf } from '../../shared/seedUrl';
import { rangeLabel } from './criteria';

/*
 * What a result card shows, derived once per hit. The coordinator's hit
 * carries a BigInt seed; React state holds it as a decimal string (never Number, never
 * JSON-serialised as a BigInt), and every query the card makes keys on that string.
 */

const structureNames = new Map(STRUCTURES_OPTIONS.map((s) => [s.value, s.pureText]));
const biomeNames = new Map(BIOMES.map((b) => [b.value, b.label]));

/*
 * toHitView(hit, criteria) -> {
 *   seed: "decimal", mcVersion, largeBiomes, dimension, yHeight, rangeBlocks,
 *   spawn: { x, z },
 *   structures: [{ type, name, icon, x, z, distance, verified }]   nearest to the origin first,
 *   index,                                                          the hit's position in the run
 * }
 * Distances are measured from the origin, not from the spawn: the search box is
 * [-range, +range]² around (0, 0) in every mode, so that is what "found within" means.
 * A shared seed's structure the engine did not find in the box (seeds mode)
 * arrives as { type, x: null, z: null, verified: false }: it keeps its name, has no
 * distance and sorts after every found one. Search hits are always verified.
 */
export function toHitView(hit, criteria) {
    const structures = (hit.structures ?? [])
        .map(({ type, x, z, verified = true }) => {
            const located = x != null && z != null;
            return {
                type,
                name: structureNames.get(type) ?? `Structure ${type}`,
                icon: STRUCTURE_ICONS[type] ?? null,
                x: located ? x : null,
                z: located ? z : null,
                distance: located ? distanceBlocks(0, 0, x, z) : null,
                verified: verified && located,
            };
        })
        // Stable: unlocated rows keep their criteria order at the end.
        .sort((a, b) => {
            if (a.distance == null || b.distance == null) return (a.distance == null) - (b.distance == null);
            return a.distance - b.distance;
        });
    return {
        seed: String(hit.seed),
        mcVersion: criteria.mcVersion,
        largeBiomes: !!criteria.largeBiomes,
        dimension: criteria.dimension ?? 0,
        yHeight: criteria.yHeight ?? 256,
        // The box the row was found in: what an unverified row's "Not found within" names.
        rangeBlocks: criteria.rangeBlocks,
        spawn: { x: hit.spawnX, z: hit.spawnZ },
        structures,
        index: hit.index,
    };
}

/*
 * Where a row's preview looks: the nearest found structure, else (a biome-only hit)
 * the spawn in the Overworld - the coordinator's spawn is the Overworld's - and the
 * origin elsewhere. The thumbnail is centred on it and the opened map starts there (the
 * thumbnail is the map's first frame), so pass the view with found structures only. Returns { x, z, label } in blocks.
 */
export function previewTarget(view) {
    const [first] = view.structures;
    if (first) return { x: first.x, z: first.z, label: first.name };
    if (view.dimension === 0) return { x: view.spawn.x, z: view.spawn.z, label: 'Spawn' };
    return { x: 0, z: 0, label: 'Origin' };
}

/*
 * One line for the phone's collapsed criteria, the share card and the CSV:
 * "Village · Cherry Grove · any of Snowy Plains, Ice Spikes · no Ocean · 300 blocks ·
 * 26.3 · Overworld" (structures, biomes, alternatives, avoided biomes, range, version,
 * dimension). Each alternative / avoided list is one part, so its names stay together;
 * past SUMMARY_NAMES names it is counted instead ("avoids 44 biomes": Survival island).
 */
const SUMMARY_NAMES = 4;
export function summaryOf(criteria) {
    const biomeName = (id) => biomeNames.get(id) ?? `Biome ${id}`;
    const list = (prefix, counted, ids = []) => {
        if (ids.length === 0) return [];
        return [ids.length > SUMMARY_NAMES ? `${counted} ${ids.length} biomes` : `${prefix} ${ids.map(biomeName).join(', ')}`];
    };
    return [
        ...criteria.structures.map((type) => structureNames.get(type) ?? `Structure ${type}`),
        ...criteria.biomes.map(biomeName),
        ...list('any of', 'any of', criteria.anyBiomes),
        ...list('no', 'avoids', criteria.excludeBiomes),
        rangeLabel(criteria.rangeBlocks),
        versionLabelOf(criteria.mcVersion),
        // The world type only when it is not Default (owner, 2026-09-26).
        ...(criteria.largeBiomes ? ['Large Biomes'] : []),
        dimensionLabel(criteria.dimension),
    ].join(' · ');
}
