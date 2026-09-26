import { describe, it, expect } from 'vitest';
import {
    distanceBlocks, formatDistance, formatCoords, biomeLabel, DIMENSION_LABELS, dimensionLabel,
    nether, overworld, shadowSeed,
} from './format';
import { BIOMES } from '../util/constants';

describe('distanceBlocks', () => {
    it('is the Euclidean distance, rounded to a whole block', () => {
        expect(distanceBlocks(0, 0, 3, 4)).toBe(5);
        expect(distanceBlocks(-32, 80, -32, 80)).toBe(0);
        expect(distanceBlocks(-32, 80, -1356, 164)).toBe(Math.round(Math.hypot(1324, 84)));
        expect(distanceBlocks(0, 0, 1, 1)).toBe(1);                 // 1.414 -> 1
        expect(distanceBlocks(0, 0, 2, 2)).toBe(3);                 // 2.828 -> 3
        expect(distanceBlocks(5, 5, 0, 0)).toBe(distanceBlocks(0, 0, 5, 5));
    });
});

describe('formatDistance', () => {
    it('counts blocks under 1 000', () => {
        expect(formatDistance(0)).toBe('0 blocks');
        expect(formatDistance(340)).toBe('340 blocks');
        expect(formatDistance(999)).toBe('999 blocks');
    });
    it('uses thousands with one decimal from 1 000', () => {
        expect(formatDistance(1000)).toBe('1.0k blocks');
        expect(formatDistance(1234)).toBe('1.2k blocks');
        expect(formatDistance(1250)).toBe('1.3k blocks');
        expect(formatDistance(9949)).toBe('9.9k blocks');
    });
    it('uses whole thousands from 10 000, and never prints "10.0k"', () => {
        expect(formatDistance(9999)).toBe('10k blocks');
        expect(formatDistance(10000)).toBe('10k blocks');
        expect(formatDistance(12499)).toBe('12k blocks');
        expect(formatDistance(123456)).toBe('123k blocks');
    });
});

describe('formatCoords', () => {
    it('prints (x, z)', () => {
        expect(formatCoords(-32, 80)).toBe('(-32, 80)');
        expect(formatCoords(0, -1484)).toBe('(0, -1484)');
    });
});

describe('biomeLabel', () => {
    it('names every biome like the legend does, and anything else "Unknown"', () => {
        for (const { value, label } of BIOMES) expect(biomeLabel(value)).toBe(label);
        expect(biomeLabel(1)).toBe('Plains');
        expect(biomeLabel(-1)).toBe('Unknown');
        expect(biomeLabel(999)).toBe('Unknown');
        expect(biomeLabel(undefined)).toBe('Unknown');
    });
});

describe('dimensionLabel / DIMENSION_LABELS', () => {
    it('names the three dimensions by their cubiomes id', () => {
        expect(DIMENSION_LABELS).toEqual({ 0: 'Overworld', '-1': 'Nether', 1: 'End' });
        expect(dimensionLabel(0)).toBe('Overworld');
        expect(dimensionLabel(-1)).toBe('Nether');
        expect(dimensionLabel(1)).toBe('End');
        expect(dimensionLabel('-1')).toBe('Nether');
    });
    it('falls back to the Overworld, like the URL contract', () => {
        expect(dimensionLabel(7)).toBe('Overworld');
        expect(dimensionLabel(undefined)).toBe('Overworld');
    });
    it('is the list the dashboard re-exports', async () => {
        const dashboard = await import('../pages/seed/dashboard/format');
        expect(dashboard.DIMENSION_LABELS).toBe(DIMENSION_LABELS);
    });
});

describe('nether / overworld', () => {
    it('divides by 8 rounding down, and multiplies by 8', () => {
        expect(nether(800)).toBe(100);
        expect(nether(-32)).toBe(-4);
        expect(nether(7)).toBe(0);
        expect(nether(-1)).toBe(-1);                                // floor, not truncation
        expect(nether(-9)).toBe(-2);
        expect(overworld(100)).toBe(800);
        expect(overworld(-4)).toBe(-32);
    });
});

describe('shadowSeed', () => {
    it('is exact for a seed beyond 2^53, as a decimal string', () => {
        // -7379792620528906219 - 8091867987493326313 = -15471660608022232532, wrapped to 64 bits.
        expect(shadowSeed('8091867987493326313')).toBe('2975083465687319084');
        expect(shadowSeed(8091867987493326313n)).toBe('2975083465687319084');
    });
    it('is exact for a negative seed', () => {
        // -7379792620528906219 + 8091867987493326313 fits in a long without wrapping.
        expect(shadowSeed('-8091867987493326313')).toBe('712075366964420094');
        expect(shadowSeed('0')).toBe('-7379792620528906219');
    });
    it('wraps at the 64-bit edges like a Java long', () => {
        expect(shadowSeed('-9223372036854775808')).toBe('1843579416325869589');
        expect(shadowSeed('9223372036854775807')).toBe('1843579416325869590');
    });
    it('is its own inverse', () => {
        for (const seed of ['8091867987493326313', '-77', '12345', '-9223372036854775808']) {
            expect(shadowSeed(shadowSeed(seed))).toBe(seed);
        }
    });
});
