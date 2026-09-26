import { BIOMES } from '../util/constants';

// Display helpers shared by the seed page's dashboard and the finder.

const biomeLabels = new Map(BIOMES.map((b) => [b.value, b.label]));

// Straight-line distance between two block positions, rounded to a whole block.
export function distanceBlocks(ax, az, bx, bz) {
    return Math.round(Math.hypot(bx - ax, bz - az));
}

// "340 blocks", "1.2k blocks" from 1 000, "12k blocks" from 10 000.
// 9 950 and up round to "10k", never to "10.0k".
export function formatDistance(blocks) {
    if (blocks < 1000) return `${blocks} blocks`;
    const tenths = Math.round(blocks / 100);
    if (tenths < 100) return `${(tenths / 10).toFixed(1)}k blocks`;
    return `${Math.round(blocks / 1000)}k blocks`;
}

export function formatCoords(x, z) {
    return `(${x}, ${z})`;
}

// The biome's name as the map's legend shows it.
export function biomeLabel(id) {
    return biomeLabels.get(id) ?? 'Unknown';
}

// Plain-text dimension names. DIMENSIONS_OPTIONS' labels are JSX (icon + name), which
// cannot go into a table cell's data-label or a sentence.
export const DIMENSION_LABELS = { 0: 'Overworld', '-1': 'Nether', 1: 'End' };

export function dimensionLabel(dimension) {
    return DIMENSION_LABELS[dimension] ?? DIMENSION_LABELS[0];
}

// One Nether block is eight in the Overworld. floor, not truncation: -1 is in Nether block -1.
export const nether = (overworldCoord) => Math.floor(overworldCoord / 8);
export const overworld = (netherCoord) => netherCoord * 8;

/*
 * The shadow seed, as a decimal string: cubiomes' getShadow (finders.h),
 * -7379792620528906219 - seed on unsigned 64 bits, read back as the signed long
 * Minecraft prints. BigInt all the way: a seed never goes through Number.
 */
export function shadowSeed(seed) {
    return String(BigInt.asIntN(64, -7379792620528906219n - BigInt(seed)));
}
