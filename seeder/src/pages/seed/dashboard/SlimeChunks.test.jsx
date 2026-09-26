import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SLIME_REACH, SLIME_ROWS, SlimeChunks, slimeRows } from './SlimeChunks';
import { distanceBlocks } from '../../../shared/format';

// A SLIME_CHUNKS answer: a w×h window of cells from chunk (cx0, cz0), 1 = slime chunk.
function windowOf({ cx0, cz0, w, h }, slime = [], fill = 0) {
    const cells = new Array(w * h).fill(fill);
    for (const [cx, cz, value = 1] of slime) cells[(cz - cz0) * w + (cx - cx0)] = value;
    return { cx0, cz0, w, h, cells };
}
const AROUND_ORIGIN = { cx0: -SLIME_REACH, cz0: -SLIME_REACH, w: 2 * SLIME_REACH, h: 2 * SLIME_REACH };
const coords = (rows) => rows.map(({ cx, cz }) => [cx, cz]);

describe('slimeRows', () => {
    it('sorts by distance from the point to the chunk centre', () => {
        const data = windowOf(AROUND_ORIGIN, [[-10, 3], [6, 6], [0, -2], [2, 1]]);
        const rows = slimeRows(data, { x: 100, z: 100 });
        expect(coords(rows)).toEqual([[6, 6], [2, 1], [0, -2], [-10, 3]]);
        expect(rows[0]).toEqual({ cx: 6, cz: 6, distance: distanceBlocks(100, 100, 104, 104) });
        const ds = rows.map((r) => r.distance);
        expect([...ds].sort((a, b) => a - b)).toEqual(ds);
    });

    it('breaks distance ties by cz, then cx, negative chunks included', () => {
        // The four chunks around the origin all have their centre 11 blocks away.
        const data = windowOf(AROUND_ORIGIN, [[0, 0], [-1, 0], [0, -1], [-1, -1]]);
        const rows = slimeRows(data, { x: 0, z: 0 });
        expect(coords(rows)).toEqual([[-1, -1], [0, -1], [-1, 0], [0, 0]]);
        expect(new Set(rows.map((r) => r.distance))).toEqual(new Set([11]));
    });

    it('places negative chunk coordinates from the window origin, centres at chunk × 16 + 8', () => {
        const data = windowOf({ cx0: -40, cz0: -30, w: 4, h: 3 }, [[-38, -29]]);
        expect(slimeRows(data, { x: -600, z: -456 })).toEqual([{ cx: -38, cz: -29, distance: distanceBlocks(-600, -456, -600, -456) }]);
        expect(slimeRows(data, { x: -600, z: -456 })[0].distance).toBe(0);
    });

    it(`keeps the ${SLIME_ROWS} nearest when there are more`, () => {
        const data = windowOf(AROUND_ORIGIN, [], 1);
        const point = { x: 37, z: -91 };
        const rows = slimeRows(data, point);
        expect(rows).toHaveLength(SLIME_ROWS);
        const all = [];
        for (let cz = -SLIME_REACH; cz < SLIME_REACH; cz++) {
            for (let cx = -SLIME_REACH; cx < SLIME_REACH; cx++) all.push(distanceBlocks(point.x, point.z, cx * 16 + 8, cz * 16 + 8));
        }
        all.sort((a, b) => a - b);
        expect(rows.map((r) => r.distance)).toEqual(all.slice(0, SLIME_ROWS));
    });

    it('counts only cells equal to 1', () => {
        const data = windowOf(AROUND_ORIGIN, [[0, 0, 2], [1, 0, 255], [2, 0, -1], [3, 0, true], [4, 0, '1'], [5, 0, 1]]);
        expect(coords(slimeRows(data, { x: 0, z: 0 }))).toEqual([[5, 0]]);
        expect(slimeRows(windowOf(AROUND_ORIGIN), { x: 0, z: 0 })).toEqual([]);
    });
});

describe('SlimeChunks', () => {
    const renderBlock = (query, point = { x: 0, z: 0 }) => render(
        <SlimeChunks query={query} point={point} onShow={vi.fn()} slimeOverlay={false} setSlimeOverlay={vi.fn()} />,
    );

    it('lists the nearest chunks in order', () => {
        renderBlock({ data: windowOf(AROUND_ORIGIN, [[0, 0], [-1, -1], [5, 5]]) });
        const items = within(screen.getByRole('list', { name: 'Nearest slime chunks' })).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveTextContent('Chunk (-1, -1)');
        expect(items[1]).toHaveTextContent('Chunk (0, 0)');
        expect(items[2]).toHaveTextContent('Chunk (5, 5)');
    });

    it('says so when the window has no slime chunk', () => {
        renderBlock({ data: windowOf(AROUND_ORIGIN) });
        expect(screen.getByText('No slime chunks within 256 blocks.')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Nearest slime chunks' })).toBeNull();
    });
});
