// The Strongholds section's body inside a DashboardProvider, over the recording
// FakeQueueManager: the test answers SEED_SUMMARY / STRONGHOLDS_LIST / STRONGHOLD_ANALYSE
// itself with resolveRequest.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StrongholdsSection from './StrongholdsSection';
import { DashboardProvider } from './DashboardContext';
import { VERSIONS } from '../../../util/constants';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };
const SPAWN = { spawnX: -32, spawnZ: 80, spawnBiome: 1, approxHeight: 71 };
// Generation order, as the engine answers (not sorted by distance). The first ring is
// the documented vector of this seed; the rest is made up.
const FIRST = [
    { x: -1356, z: 164, ring: 0, index: 0 },       // 1327 from the spawn, 1366 from the origin
    { x: 644, z: -1484, ring: 0, index: 1 },       // 1704
    { x: 1108, z: 1524, ring: 0, index: 2 },       // 1840
    { x: 4500, z: 900, ring: 1, index: 3 },        // 4606
    { x: -3900, z: 3000, ring: 1, index: 4 },      // 4846
    { x: 300, z: -4400, ring: 1, index: 5 },       // 4492
    { x: -4800, z: -1200, ring: 1, index: 6 },     // 4937
    { x: 2600, z: 3900, ring: 1, index: 7 },       // 4639
];
const NEAREST_FIRST = ['(-1356, 164)', '(644, -1484)', '(1108, 1524)', '(300, -4400)', '(4500, 900)', '(2600, 3900)', '(-3900, 3000)', '(-4800, -1200)'];
// All 128, the way approx mode answers: every position a little off, rings 3 + 6 + 10 + … + 9.
const RING_SIZES = [3, 6, 10, 15, 21, 28, 36, 9];
const ALL = (() => {
    const list = [];
    RING_SIZES.forEach((size, ring) => {
        for (let k = 0; k < size; k++) {
            const index = list.length;
            const angle = (2 * Math.PI * k) / size + ring;
            const radius = 1500 + ring * 3072;
            const exact = FIRST[index];
            list.push(exact
                ? { ...exact, x: exact.x + 48, z: exact.z - 40 }
                : { x: Math.round(radius * Math.cos(angle)), z: Math.round(radius * Math.sin(angle)), ring, index });
        }
    });
    return list;
})();

const qm = () => FakeQueueManager.latest();
const answer = (kind, result) => act(async () => { qm().resolveRequest(kind, result); });
const ofKind = (kind) => qm().requests.filter((r) => r.kind === kind);

function Harness({ world, mapApi, sheetApi }) {
    const value = {
        world, mapApi, sheetApi, structuresToShow: [], setStructuresToShow: vi.fn(), worlds: { worlds: [] }, showSection: vi.fn(),
    };
    return <DashboardProvider value={value}><StrongholdsSection /></DashboardProvider>;
}
function renderStrongholds(world = {}) {
    const mapApi = { current: { panTo: vi.fn(), setHighlight: vi.fn() } };
    const sheetApi = { current: { open: vi.fn(), close: vi.fn(), getSnap: () => 'full' } };
    const utils = render(<Harness world={{ ...WORLD, ...world }} mapApi={mapApi} sheetApi={sheetApi} />);
    const rerender = (next) => utils.rerender(<Harness world={{ ...WORLD, ...world, ...next }} mapApi={mapApi} sheetApi={sheetApi} />);
    return { mapApi, sheetApi, rerender };
}
// Render and answer both first queries.
async function loaded(world = {}, strongholds = FIRST, spawn = SPAWN) {
    const handles = renderStrongholds(world);
    await answer('SEED_SUMMARY', spawn);
    await answer('STRONGHOLDS_LIST', { strongholds });
    return handles;
}

const rows = () => within(screen.getByRole('list', { name: 'Nearest strongholds' })).getAllByRole('listitem');
const coordsOf = (row) => within(row).getByText(/\(-?\d+, -?\d+\)/).textContent;
const rowAt = (coords) => rows().find((row) => coordsOf(row).endsWith(coords));
// Buttons inside closed rows are hidden: count them with { hidden: true }.
const allButtons = (name, scope = screen) => scope.queryAllByRole('button', { name, hidden: true });
const openRow = (user, row) => user.click(within(row).getByRole('button', { expanded: false }));
const showMore = (user) => user.click(screen.getByRole('button', { name: 'Show 7 more' }));

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
});

describe('StrongholdsSection', () => {
    it('asks for the spawn and the first 8 strongholds, at low priority, and waits for both', async () => {
        renderStrongholds();
        expect(ofKind('SEED_SUMMARY').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, yHeight: 256 }]);
        expect(ofKind('STRONGHOLDS_LIST').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, howMany: 8 }]);
        for (const r of qm().requests) expect(r.opts.priority).toBe('low');
        expect(screen.getByRole('status')).toBeInTheDocument();
        await answer('STRONGHOLDS_LIST', { strongholds: FIRST });
        expect(screen.getByRole('status')).toBeInTheDocument();          // the spawn is still missing
        await answer('SEED_SUMMARY', SPAWN);
        expect(screen.queryByRole('status')).toBeNull();
        expect(rows()).toHaveLength(1);                                   // collapsed: the nearest one
    });

    it('shows the nearest, then the 8 nearest first from the spawn with ring and distance, and folds back', async () => {
        const user = userEvent.setup();
        await loaded();
        expect(rows().map(coordsOf)).toEqual(NEAREST_FIRST.slice(0, 1));
        expect(within(rows()[0]).getByText('Ring 1 · 1.3k blocks')).toBeInTheDocument();
        await showMore(user);
        expect(rows().map(coordsOf)).toEqual(NEAREST_FIRST);
        expect(within(rowAt('(300, -4400)')).getByText('Ring 2 · 4.5k blocks')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show 7 more' })).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Show fewer' }));
        expect(rows()).toHaveLength(1);
        expect(screen.getByText('Strongholds generate in rings; the first ring holds 3 within about 2.8k blocks of the origin.')).toBeInTheDocument();
    });

    it('a row opens its Copy, "Show on map" and Analyse', async () => {
        const user = userEvent.setup();
        await loaded();
        const [row] = rows();
        expect(within(row).queryByRole('button', { name: 'Show on map' })).toBeNull();   // closed
        await openRow(user, row);
        for (const name of ['Copy', 'Show on map', 'Analyse']) expect(within(row).getByRole('button', { name })).toBeVisible();
    });

    it('"Show on map" pans to the stronghold, highlights it and closes the sheet', async () => {
        const user = userEvent.setup();
        const { mapApi, sheetApi } = await loaded();
        await showMore(user);
        const row = rowAt('(644, -1484)');
        await openRow(user, row);
        await user.click(within(row).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(644, -1484);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: 644, z: -1484, label: 'Stronghold' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('in the Nether keeps the list, measured from the origin, with a notice and no "Show on map"', async () => {
        const user = userEvent.setup();
        await loaded({ dimension: -1 }, FIRST, { spawnX: 0, spawnZ: 0, spawnBiome: 8, approxHeight: null });
        expect(screen.getByText('Overworld coordinates. Switch to the Overworld to see them on the map.')).toBeInTheDocument();
        await showMore(user);
        expect(rows()).toHaveLength(8);
        expect(within(rows()[0]).getByText('Ring 1 · 1.4k blocks')).toBeInTheDocument();   // 1366 from (0, 0), not 1327 from the spawn
        expect(allButtons('Show on map')).toHaveLength(0);
        expect(allButtons('Analyse')).toHaveLength(8);
    });

    it('does not need the spawn outside the Overworld', async () => {
        const user = userEvent.setup();
        renderStrongholds({ dimension: 1 });
        await answer('STRONGHOLDS_LIST', { strongholds: FIRST });
        await showMore(user);
        expect(rows()).toHaveLength(8);
    });

    it('"Analyse" asks about that one stronghold and shows its portal room', async () => {
        const user = userEvent.setup();
        await loaded();
        await showMore(user);
        expect(ofKind('STRONGHOLD_ANALYSE')).toHaveLength(0);           // nothing is analysed up front
        const row = rowAt('(644, -1484)');
        await openRow(user, row);
        await user.click(within(row).getByRole('button', { name: 'Analyse' }));
        expect(ofKind('STRONGHOLD_ANALYSE').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, x: 644, z: -1484 }]);
        expect(within(row).getByRole('status')).toBeInTheDocument();
        await answer('STRONGHOLD_ANALYSE', { eyes: 3, libraries: 2, portalX: 660, portalZ: -1500, pieces: 140 });
        expect(within(row).getByText('3 / 12 eyes in the portal room')).toBeInTheDocument();
        expect(within(row).getByText('2 libraries')).toBeInTheDocument();
        expect(within(row).getByText('Portal room at (660, -1500)')).toBeInTheDocument();
        expect(within(row).queryByRole('button', { name: 'Analyse' })).toBeNull();
        expect(allButtons('Analyse')).toHaveLength(7);
        expect(ofKind('STRONGHOLD_ANALYSE')).toHaveLength(1);
    });

    it('says the eye count is unknown when the engine cannot tell (before 1.13)', async () => {
        const user = userEvent.setup();
        await loaded({ mcVersion: VERSIONS['1.12'], versionLabel: '1.12' });
        await openRow(user, rows()[0]);
        await user.click(within(rows()[0]).getByRole('button', { name: 'Analyse' }));
        await answer('STRONGHOLD_ANALYSE', { eyes: -1, libraries: 1, portalX: -1340, portalZ: 170, pieces: 9 });
        expect(screen.getByText('Eye count unknown before 1.13')).toBeInTheDocument();
        expect(screen.getByText('1 library')).toBeInTheDocument();
        expect(screen.queryByText(/\/ 12 eyes/)).toBeNull();
    });

    it('offers no Analyse before 1.8, and no "Show all" when the version has only 3', async () => {
        const user = userEvent.setup();
        await loaded({ mcVersion: VERSIONS['1.7'], versionLabel: '1.7' }, FIRST.slice(0, 3));
        await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
        expect(rows()).toHaveLength(3);
        expect(allButtons('Analyse')).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    });

    it('3 strongholds (1.8) have Analyse but no "Show all"', async () => {
        const user = userEvent.setup();
        await loaded({ mcVersion: VERSIONS['1.8'], versionLabel: '1.8' }, FIRST.slice(0, 3));
        await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
        expect(allButtons('Analyse')).toHaveLength(3);
        expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    });

    it('says so when the version has no strongholds (Beta 1.7)', async () => {
        await loaded({ mcVersion: VERSIONS['Beta 1.7'], versionLabel: 'Beta 1.7' }, []);
        expect(screen.getByText('No strongholds in this version.')).toBeInTheDocument();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('renders an engine error', async () => {
        renderStrongholds();
        await answer('SEED_SUMMARY', SPAWN);
        await answer('STRONGHOLDS_LIST', { error: { code: -1, message: 'unsupported version' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: unsupported version');
    });

    describe('"Show all 128"', () => {
        it('on 26.3 asks for 128 approximate positions, keeps the exact ones it has, and pages them 32 at a time', async () => {
            const user = userEvent.setup();
            await loaded();
            expect(screen.queryByRole('button', { name: 'Show all 128' })).toBeNull();   // after the first 8
            await showMore(user);
            await user.click(screen.getByRole('button', { name: 'Show all 128' }));
            const [request] = ofKind('STRONGHOLDS_LIST').filter((r) => r.data.howMany === 128);
            expect(request.data).toEqual({ mcVersion: WORLD.mcVersion, seed: WORLD.seed, howMany: 128, approx: true });
            expect(request.opts.priority).toBe('low');
            expect(rows()).toHaveLength(8);                                // the first list stays while it loads
            expect(screen.getByRole('status')).toBeInTheDocument();
            await answer('STRONGHOLDS_LIST', { strongholds: ALL });

            expect(screen.getByText('Positions approximate (±112 blocks).')).toBeInTheDocument();
            expect(rows()).toHaveLength(40);
            // The 8 known exactly keep their exact position and their Analyse button...
            for (const coords of NEAREST_FIRST) {
                const row = rowAt(coords);
                expect(coordsOf(row)).toBe(coords);
                expect(allButtons('Analyse', within(row))).toHaveLength(1);
            }
            // ...the others are marked approximate and cannot be analysed (wrong chunk).
            const approximate = rows().filter((row) => coordsOf(row).startsWith('≈'));
            expect(approximate).toHaveLength(32);
            for (const row of approximate) {
                expect(allButtons('Analyse', within(row))).toHaveLength(0);
                expect(allButtons('Show on map', within(row))).toHaveLength(1);
            }
            // Still nearest first.
            const distance = (row) => { const [x, z] = coordsOf(row).match(/-?\d+/g).map(Number); return Math.hypot(x + 32, z - 80); };
            const ds = rows().map(distance);
            for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThanOrEqual(ds[i - 1] - 1);

            await user.click(screen.getByRole('button', { name: 'Show 32 more' }));
            expect(rows()).toHaveLength(72);
            await user.click(screen.getByRole('button', { name: 'Show 32 more' }));
            await user.click(screen.getByRole('button', { name: 'Show 32 more' }));
            expect(rows()).toHaveLength(128);
            expect(screen.queryByRole('button', { name: 'Show 32 more' })).toBeNull();
            expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
            expect(ofKind('STRONGHOLDS_LIST')).toHaveLength(2);

            // "Show fewer" folds back to the nearest one; unfolding goes the same way again.
            await user.click(screen.getByRole('button', { name: 'Show fewer' }));
            expect(rows()).toHaveLength(1);
            expect(screen.queryByText(/Positions approximate/)).toBeNull();
            await showMore(user);
            expect(rows()).toHaveLength(8);
            await user.click(screen.getByRole('button', { name: 'Show all 128' }));
            expect(rows()).toHaveLength(40);                               // cached: no new request
            expect(ofKind('STRONGHOLDS_LIST')).toHaveLength(2);
        });

        it('on 1.19.2 asks for exact positions, with no note and no approximate rows', async () => {
            const user = userEvent.setup();
            await loaded({ mcVersion: VERSIONS['1.19.2'], versionLabel: '1.19.2' });
            await showMore(user);
            await user.click(screen.getByRole('button', { name: 'Show all 128' }));
            expect(ofKind('STRONGHOLDS_LIST').at(-1).data).toEqual({ mcVersion: VERSIONS['1.19.2'], seed: WORLD.seed, howMany: 128, approx: false });
            await answer('STRONGHOLDS_LIST', { strongholds: ALL.map((s, i) => FIRST[i] ?? s) });
            expect(screen.queryByText(/Positions approximate/)).toBeNull();
            expect(rows()).toHaveLength(40);
            expect(rows().filter((row) => coordsOf(row).startsWith('≈'))).toHaveLength(0);
            expect(allButtons('Analyse')).toHaveLength(40);
        });

        it('starts over on another seed', async () => {
            const user = userEvent.setup();
            const { rerender } = await loaded();
            await showMore(user);
            await user.click(screen.getByRole('button', { name: 'Show all 128' }));
            await answer('STRONGHOLDS_LIST', { strongholds: ALL });
            await openRow(user, rows()[0]);
            await user.click(within(rows()[0]).getByRole('button', { name: 'Analyse' }));
            rerender({ seed: '42' });
            await answer('SEED_SUMMARY', SPAWN);
            await answer('STRONGHOLDS_LIST', { strongholds: FIRST });
            expect(rows()).toHaveLength(1);
            expect(screen.getByRole('button', { name: 'Show 7 more' })).toBeInTheDocument();
            expect(within(rows()[0]).getByRole('button', { expanded: false })).toBeInTheDocument();
            expect(allButtons('Analyse')).toHaveLength(1);
            expect(ofKind('STRONGHOLDS_LIST').at(-1).data).toEqual({ mcVersion: WORLD.mcVersion, seed: '42', howMany: 8 });
        });
    });
});
