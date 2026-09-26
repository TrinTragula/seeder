import { STRUCTURES_OPTIONS } from '../../../util/constants';

// The Swamp Hut StructureType (cubiomes' enum), by its STRUCTURES_OPTIONS name.
export const SWAMP_HUT = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Swamp Hut').value;

// QUAD_HUTS scans this many regions each way around the origin (QUAD_HUT_RADIUS in api.c).
export const QUAD_HUT_REGIONS = 16;

// How far that scan reaches from the origin, in blocks, for a version's hut region size.
export const quadHutReach = (regionBlocks) => QUAD_HUT_REGIONS * regionBlocks;

// A block distance as "8k" (whole thousands), for the reach sentences.
export const kBlocks = (blocks) => `${Math.round(blocks / 1000)}k`;
