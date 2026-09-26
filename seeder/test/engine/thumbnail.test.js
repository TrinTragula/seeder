// The finder's row thumbnail is one GET_AREA as large as the opened map's first frame
// (1 px per cell, library/thumbnail.js): a full desktop row by max(60vh, 320px). The
// engine's heap is fixed and a malloc failure aborts instead of returning
// NULL, so the largest box a real screen asks for must fit in one call.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadSeeder } from './harness.js';
import { VERSIONS } from '../../src/util/constants';
import { THUMB_STRIP_CELLS } from '../../src/library/thumbnail';

// A 1280-wide row (~906 px) on a 1600 px tall screen: 60vh = 960 px.
const W = 906;
const H = 960;

let seeder;
beforeAll(async () => { seeder = await loadSeeder(); });

describe('a thumbnail-sized area', () => {
    it(`${W}×${H} cells on 26.3 come back whole, twice in a row (no heap growth)`, () => {
        for (let i = 0; i < 2; i++) {
            const t0 = performance.now();
            const { ids, rgba } = seeder.getArea(VERSIONS['26.3'], '8091867987493326313', -453, -480, W, H, 0, 256);
            console.log(`${W}×${H} GET_AREA on 26.3: ${Math.round(performance.now() - t0)} ms`);
            expect(ids).toHaveLength(W * H);
            expect(rgba).toHaveLength(W * H * 4);
            expect(ids.some((id) => id !== ids[0])).toBe(true);
        }
    }, 60_000);

    // thumbnail.js asks for its area in strips of rows on several workers and stacks them:
    // the picture must be the one a single call draws (and the map's tiles draw).
    it('strips of THUMB_STRIP_CELLS rows stacked are the same picture as one call', () => {
        const [w, h, x, z] = [200, 150, -100, -75];
        for (const [label, dim] of [['26.3', 0], ['1.12', 0], ['1.16.5', -1]]) {
            const mc = VERSIONS[label];
            const whole = seeder.getArea(mc, '8091867987493326313', x, z, w, h, dim, 256).ids;
            const stacked = new Int32Array(w * h);
            for (let row = 0; row < h; row += THUMB_STRIP_CELLS) {
                const rows = Math.min(THUMB_STRIP_CELLS, h - row);
                stacked.set(seeder.getArea(mc, '8091867987493326313', x, z + row, w, rows, dim, 256).ids, row * w);
            }
            expect([...stacked], `${label} dim ${dim}`).toEqual([...whole]);
        }
    }, 60_000);
});
