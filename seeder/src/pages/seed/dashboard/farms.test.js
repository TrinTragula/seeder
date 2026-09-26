import { describe, it, expect } from 'vitest';
import { STRUCTURES_OPTIONS } from '../../../util/constants';
import { QUAD_HUT_REGIONS, SWAMP_HUT, kBlocks, quadHutReach } from './farms';

describe('SWAMP_HUT', () => {
    it('is the Swamp Hut StructureType', () => {
        expect(SWAMP_HUT).toBe(3);
        expect(STRUCTURES_OPTIONS.find((s) => s.value === SWAMP_HUT).pureText).toBe('Swamp Hut');
    });
});

describe('QUAD_HUT_REGIONS', () => {
    it('is the radius api.c scans (QUAD_HUT_RADIUS), so the reach said is the reach scanned', async () => {
        // Vitest runs from the app root (seeder/); api.c is tracked next to it.
        const { readFileSync } = await import('node:fs');
        const api = readFileSync(`${process.cwd()}/../cubiomes-mods/api.c`, 'utf8');
        expect(api).toMatch(new RegExp(`#define QUAD_HUT_RADIUS ${QUAD_HUT_REGIONS}\\b`));
    });
});

describe('quadHutReach and kBlocks', () => {
    it('is the scanned regions times the hut region size, shown in whole thousands', () => {
        expect(quadHutReach(512)).toBe(8192);
        expect(kBlocks(quadHutReach(512))).toBe('8k');
        expect(kBlocks(4096)).toBe('4k');
        expect(kBlocks(10240)).toBe('10k');
    });
});
