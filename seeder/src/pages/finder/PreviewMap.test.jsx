import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import PreviewMap from './PreviewMap';
import { toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { FakeDrawSeed, FakeQueueManager } from '../../test/fakes';
import { resetQueueManagerForTests } from '../../shared/engine';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));
vi.mock('../../library/draw', async (importOriginal) => ({
    ...(await importOriginal()),
    DrawSeed: (await import('../../test/fakes')).FakeDrawSeed,
}));

const drawer = () => FakeDrawSeed.latest();
// panTo(x, z) through MapCanvas' api, whose third argument (opts) is passed on as is.
const pans = () => drawer().callsOf('panTo').map(([x, z]) => [x, z]);
const flush = () => act(async () => { await Promise.resolve(); });
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');
const PORTAL = structure('Ruined Portal');
const criteria = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE, PORTAL], yHeight: 128 };
const view = (over = {}, crit = criteria) => toHitView({
    seed: 3774n, spawnX: -32, spawnZ: 80, index: 0,
    structures: [{ type: PORTAL, x: 250, z: 10 }, { type: VILLAGE, x: 96, z: -80 }, { type: VILLAGE, x: -200, z: 150 }],
    ...over,
}, crit);

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    FakeDrawSeed.reset();
    delete window.__seederDrawer;
});
afterEach(() => {
    delete window.__seederDrawer;
});

describe('PreviewMap', () => {
    it('shows the selected seed with its structure types, and exposes the renderer', async () => {
        render(<PreviewMap view={view()} />);
        await flush();
        const d = drawer();
        expect(screen.getByLabelText('Biome map')).toBe(d.canvas);
        expect(d.seed).toBe('3774');
        expect(d.mcVersion).toBe(VERSIONS['26.3']);
        expect(d.dimension).toBe(0);
        expect(d.yHeight).toBe(128);
        expect(d.structuresShown).toEqual([VILLAGE, PORTAL]);
        expect(d.showStructureCoords).toBe(false);
        expect(window.__seederDrawer).toBe(d);
    });

    it('pans to the nearest structure and highlights it with its name', async () => {
        render(<PreviewMap view={view()} />);
        await flush();
        expect(pans()).toEqual([[96, -80]]);
        // No glide from the origin: the first frame is the thumbnail the map replaces.
        expect(drawer().callsOf('panTo')[0][2]).toEqual({ animate: false });
        expect(drawer().highlight).toEqual({ x: 96, z: -80, label: 'Village' });
        // After the world effect's clear(), never before it.
        const names = drawer().calls.map((c) => c.name);
        expect(names.lastIndexOf('clear')).toBeLessThan(names.indexOf('panTo'));
    });

    it('moves to the next selection', async () => {
        const { rerender } = render(<PreviewMap view={view()} />);
        await flush();
        rerender(<PreviewMap view={view({ seed: 42n, structures: [{ type: PORTAL, x: -16, z: 32 }] })} />);
        await flush();
        expect(drawer().seed).toBe('42');
        expect(pans().at(-1)).toEqual([-16, 32]);
        expect(drawer().highlight).toEqual({ x: -16, z: 32, label: 'Ruined Portal' });
        expect(FakeDrawSeed.instances).toHaveLength(1);
    });

    it('a biome-only hit is shown at its spawn', async () => {
        render(<PreviewMap view={view({ structures: [] })} />);
        await flush();
        expect(pans()).toEqual([[-32, 80]]);
        expect(drawer().highlight).toEqual({ x: -32, z: 80, label: 'Spawn' });
    });

    it('outside the Overworld a biome-only hit is shown at the origin (its spawn is the Overworld\'s)', async () => {
        render(<PreviewMap view={view({ structures: [] }, { ...criteria, structures: [], dimension: -1 })} />);
        await flush();
        expect(drawer().dimension).toBe(-1);
        expect(drawer().highlight).toEqual({ x: 0, z: 0, label: 'Origin' });
    });

    it('unmounting (the row closes) destroys the renderer', async () => {
        const { unmount } = render(<PreviewMap view={view()} />);
        await flush();
        const d = drawer();
        unmount();
        expect(d.destroy).toHaveBeenCalled();
        expect(window.__seederDrawer).toBeUndefined();
    });
});
