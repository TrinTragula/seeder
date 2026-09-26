// The Biome locator's body inside a DashboardProvider, over the recording FakeQueueManager:
// the test answers GET_VERSION_SUPPORT, SEED_SUMMARY and BIOME_CENTERS itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BiomeLocatorSection, { LOCATOR_STORAGE_KEY } from './BiomeLocatorSection';
import { DashboardProvider } from './DashboardContext';
import { BIOMES, VERSIONS } from '../../../util/constants';
import { ALL_BIOME_IDS } from '../../../shared/hooks/useVersionSupport';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const B = Object.fromEntries(BIOMES.map((b) => [b.label, b.value]));
const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };
const SPAWN = { spawnX: -32, spawnZ: 80, spawnBiome: B.Plains, approxHeight: 71 };

// GET_VERSION_SUPPORT for ALL_BIOME_IDS: Desert does not exist here, Nether Wastes is not Overworld.
const EXISTING = ['Plains', 'Mushroom Fields', 'Forest', 'Lush Caves', 'Cherry Grove', 'Nether Wastes'].map((l) => B[l]);
const support = (mcVersion = WORLD.mcVersion) => ({
    mcVersion, newest: VERSIONS['26.3'], biomes: EXISTING,
    biomeDimensions: Object.fromEntries(ALL_BIOME_IDS.map((id) => [id, id === B['Nether Wastes'] ? -1 : 0])),
    structures: {}, regionBlocks: {}, minDistance: {},
});
const OFFERED = ['Cherry Grove', 'Forest', 'Lush Caves', 'Mushroom Fields', 'Plains'];

const qm = () => FakeQueueManager.latest();
const ofKind = (kind) => qm().requests.filter((r) => r.kind === kind);
const answer = (kind, result) => act(async () => { qm().resolveRequest(kind, result); });

function Harness({ world, mapApi, sheetApi }) {
    const value = { world, mapApi, sheetApi, structuresToShow: [], setStructuresToShow: vi.fn(), worlds: { worlds: [] }, showSection: vi.fn() };
    return <DashboardProvider value={value}><BiomeLocatorSection /></DashboardProvider>;
}
function renderLocator(world = {}) {
    const mapApi = { current: { panTo: vi.fn(), setHighlight: vi.fn() } };
    const sheetApi = { current: { open: vi.fn(), close: vi.fn(), getSnap: () => 'full' } };
    const utils = render(<Harness world={{ ...WORLD, ...world }} mapApi={mapApi} sheetApi={sheetApi} />);
    const rerender = (next) => utils.rerender(<Harness world={{ ...WORLD, ...world, ...next }} mapApi={mapApi} sheetApi={sheetApi} />);
    return { ...utils, mapApi, sheetApi, rerender };
}
async function ready(world = {}) {
    const handles = renderLocator(world);
    await answer('GET_VERSION_SUPPORT', support(world.mcVersion));
    await answer('SEED_SUMMARY', SPAWN);
    return handles;
}

const biomeInput = () => screen.getByLabelText('Biome to locate');
const openMenu = () => fireEvent.keyDown(biomeInput(), { key: 'ArrowDown', code: 'ArrowDown' });
const optionLabels = () => screen.getAllByRole('option').map((o) => o.textContent);
async function choose(label) {
    openMenu();
    fireEvent.click(screen.getAllByRole('option').find((o) => o.textContent === label));
    await act(async () => {});
}
const find = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Find' })); });
const patches = () => screen.getByRole('list', { name: 'Biome patches' });
const rows = () => within(patches()).getAllByRole('listitem');

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    window.sessionStorage.clear();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
});

describe('BiomeLocatorSection', () => {
    it('asks for every biome\'s support (high) and the spawn, and for nothing else before Find', async () => {
        renderLocator();
        expect(ofKind('GET_VERSION_SUPPORT').map((r) => [r.data, r.opts.priority])).toEqual([
            [{ mcVersion: WORLD.mcVersion, biomeIds: ALL_BIOME_IDS, structTypes: [] }, 'high'],
        ]);
        expect(ofKind('SEED_SUMMARY').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, yHeight: 256 }]);
        await answer('GET_VERSION_SUPPORT', support());
        await answer('SEED_SUMMARY', SPAWN);
        expect(screen.getByRole('button', { name: 'Find' })).toBeDisabled();       // no biome yet
        await choose('Plains');
        expect(screen.getByRole('button', { name: 'Find' })).toBeEnabled();
        await userEvent.setup().click(screen.getByRole('button', { name: '2k' }));
        expect(ofKind('BIOME_CENTERS')).toHaveLength(0);
        expect(qm().requests.map((r) => r.kind)).toEqual(['GET_VERSION_SUPPORT', 'SEED_SUMMARY']);
    });

    it('offers only the biomes this version has in the Overworld, sorted by name', async () => {
        await ready();
        openMenu();
        expect(optionLabels()).toEqual(OFFERED);
    });

    it('2k is disabled below 1.18 with the reason shown, enabled from 1.18', async () => {
        const { unmount } = await ready({ mcVersion: VERSIONS['1.17'], versionLabel: '1.17' });
        expect(screen.getByRole('button', { name: '2k' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '1k' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('2k needs 1.18+ (engine memory)')).toBeInTheDocument();
        unmount();
        await ready();
        expect(screen.getByRole('button', { name: '2k' })).toBeEnabled();
        expect(screen.queryByText('2k needs 1.18+ (engine memory)')).toBeNull();
    });

    it('Find asks BIOME_CENTERS around the spawn in the Overworld, at the chosen radius and the map\'s Y, at low priority', async () => {
        const user = userEvent.setup();
        await ready({ yHeight: 62 });
        await choose('Plains');
        await user.click(screen.getByRole('button', { name: '2k' }));
        expect(screen.getByRole('button', { name: '2k' })).toHaveAttribute('aria-pressed', 'true');
        await find();
        const [req] = ofKind('BIOME_CENTERS');
        expect(req.data).toEqual({
            mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, biomeId: B.Plains, x: -32, z: 80,
            radiusBlocks: 2000, yHeight: 62, minSizeCells: 4, nmax: 32,
        });
        expect(req.opts.priority).toBe('low');
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('lists the patches nearest first with their size, 8 then "Show N more"', async () => {
        const user = userEvent.setup();
        await ready();
        await choose('Plains');
        await find();
        // Unsorted, like the engine; distances from the spawn (-32, 80).
        const centers = [
            { x: 1000, z: 80, size: 100 },            // 1032
            { x: -32, z: 280, size: 16 },             // 200
            { x: 468, z: 80, size: 25 },              // 500
            ...Array.from({ length: 7 }, (_, i) => ({ x: -32, z: 80 + 600 + i * 10, size: 4 })),   // 600 .. 660
        ];
        await answer('BIOME_CENTERS', { centers });
        expect(rows()).toHaveLength(8);
        expect(rows()[0]).toHaveTextContent('(-32, 280)');
        expect(rows()[0]).toHaveTextContent('200 blocks');
        expect(rows()[0]).toHaveTextContent('~16×16 blocks');             // sqrt(16) cells × 4
        expect(rows()[1]).toHaveTextContent('(468, 80)');
        expect(rows()[1]).toHaveTextContent('~20×20 blocks');
        expect(rows()[2]).toHaveTextContent('600 blocks');
        await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
        expect(rows()).toHaveLength(10);
        expect(rows()[9]).toHaveTextContent('(1000, 80)');
        expect(rows()[9]).toHaveTextContent('1.0k blocks');
        expect(rows()[9]).toHaveTextContent('~40×40 blocks');
        await user.click(screen.getByRole('button', { name: 'Show fewer' }));
        expect(rows()).toHaveLength(8);
    });

    it('a patch opens Copy and "Show on map", which pans, highlights it by biome and closes the sheet', async () => {
        const user = userEvent.setup();
        const { mapApi, sheetApi } = await ready();
        await choose('Mushroom Fields');
        await find();
        await answer('BIOME_CENTERS', { centers: [{ x: 640, z: -320, size: 90 }] });
        const [row] = rows();
        expect(within(row).getByRole('button', { name: 'Show on map', hidden: true })).not.toBeVisible();
        await user.click(within(row).getByRole('button', { expanded: false }));
        expect(within(row).getByRole('button', { name: 'Copy' })).toBeVisible();
        await user.click(within(row).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(640, -320);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: 640, z: -320, label: 'Mushroom Fields' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('Copy puts "x, z" on the clipboard', async () => {
        await ready();
        await choose('Plains');
        await find();
        await answer('BIOME_CENTERS', { centers: [{ x: 12, z: -34, size: 9 }] });
        fireEvent.click(within(rows()[0]).getByRole('button', { expanded: false }));
        // fireEvent, not userEvent: userEvent.setup() swaps in a clipboard of its own.
        await act(async () => { fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Copy' })); });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('12, -34');
    });

    it('nothing found at 1k: says so and suggests 2k', async () => {
        await ready();
        await choose('Mushroom Fields');
        await find();
        await answer('BIOME_CENTERS', { centers: [] });
        expect(screen.getByText('No Mushroom Fields within 1k blocks of spawn.')).toBeInTheDocument();
        expect(screen.getByText('Try 2k.')).toBeInTheDocument();
        expect(screen.queryByText(/Cave biomes/)).toBeNull();
        expect(screen.queryByRole('list', { name: 'Biome patches' })).toBeNull();
    });

    it('no 2k hint at 2k, nor below 1.18 where 2k does not exist', async () => {
        const user = userEvent.setup();
        const { unmount } = await ready();
        await choose('Mushroom Fields');
        await user.click(screen.getByRole('button', { name: '2k' }));
        await find();
        await answer('BIOME_CENTERS', { centers: [] });
        expect(screen.getByText('No Mushroom Fields within 2k blocks of spawn.')).toBeInTheDocument();
        expect(screen.queryByText('Try 2k.')).toBeNull();
        unmount();
        await ready({ mcVersion: VERSIONS['1.17'], versionLabel: '1.17' });
        await choose('Mushroom Fields');
        await find();
        await answer('BIOME_CENTERS', { centers: [] });
        expect(screen.getByText('No Mushroom Fields within 1k blocks of spawn.')).toBeInTheDocument();
        expect(screen.queryByText('Try 2k.')).toBeNull();
    });

    it('a cave biome found nowhere up high suggests Y 0; underground it does not', async () => {
        const { rerender } = await ready();
        await choose('Lush Caves');
        await find();
        await answer('BIOME_CENTERS', { centers: [] });
        expect(screen.getByText('Cave biomes show at low heights: set Biome height to Y 0 first.')).toBeInTheDocument();
        rerender({ yHeight: 0 });
        await answer('SEED_SUMMARY', SPAWN);
        await find();
        expect(ofKind('BIOME_CENTERS').at(-1).data.yHeight).toBe(0);
        await answer('BIOME_CENTERS', { centers: [] });
        expect(screen.getByText('No Lush Caves within 1k blocks of spawn.')).toBeInTheDocument();
        expect(screen.queryByText(/Cave biomes/)).toBeNull();
    });

    it.each([
        [-6, 'The engine cannot locate Plains on 26.3.'],
        [-8, 'That radius is too large for this version. Use 1k.'],
        [-1, 'Not available on Beta 1.7.'],
    ])('engine error %i reads "%s"', async (code, message) => {
        await ready();
        await choose('Plains');
        await find();
        await answer('BIOME_CENTERS', { centers: [], error: { code, message: 'engine text' } });
        expect(screen.getByRole('alert')).toHaveTextContent(`Could not compute this: ${message}`);
    });

    it('remembers the chosen biome for the session, and ignores one this version lacks', async () => {
        const { unmount } = await ready();
        await choose('Cherry Grove');
        expect(JSON.parse(window.sessionStorage.getItem(LOCATOR_STORAGE_KEY))).toBe(B['Cherry Grove']);
        unmount();
        renderLocator({ seed: '42' });                                      // the version support is cached
        await answer('SEED_SUMMARY', SPAWN);
        expect(screen.getByText('Cherry Grove')).toBeInTheDocument();       // the select's value
        expect(screen.getByRole('button', { name: 'Find' })).toBeEnabled();
    });

    it('a stored biome that does not exist on this version leaves the select empty', async () => {
        window.sessionStorage.setItem(LOCATOR_STORAGE_KEY, JSON.stringify(B.Desert));
        await ready();
        expect(screen.queryByText('Desert')).toBeNull();
        expect(screen.getByText('Choose a biome…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Find' })).toBeDisabled();
        // Not overwritten: another version may have it.
        expect(JSON.parse(window.sessionStorage.getItem(LOCATOR_STORAGE_KEY))).toBe(B.Desert);
    });

    it('in the Nether and the End it only says it works in the Overworld, and asks nothing', () => {
        const { rerender } = renderLocator({ dimension: -1 });
        expect(screen.getByText('The biome locator works in the Overworld.')).toBeInTheDocument();
        rerender({ dimension: 1 });
        expect(screen.getByText('The biome locator works in the Overworld.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Biome to locate')).toBeNull();
        expect(FakeQueueManager.latest()?.requests ?? []).toEqual([]);
    });

    it('changing the biome or the radius after Find clears the results until Find again', async () => {
        const user = userEvent.setup();
        await ready();
        await choose('Plains');
        await find();
        await answer('BIOME_CENTERS', { centers: [{ x: 0, z: 0, size: 4 }] });
        expect(patches()).toBeInTheDocument();
        await choose('Forest');
        expect(screen.queryByRole('list', { name: 'Biome patches' })).toBeNull();
        expect(ofKind('BIOME_CENTERS')).toHaveLength(1);
        await find();
        expect(ofKind('BIOME_CENTERS').at(-1).data.biomeId).toBe(B.Forest);
        await answer('BIOME_CENTERS', { centers: [{ x: 4, z: 4, size: 4 }] });
        await user.click(screen.getByRole('button', { name: '2k' }));
        expect(screen.queryByRole('list', { name: 'Biome patches' })).toBeNull();
        expect(ofKind('BIOME_CENTERS')).toHaveLength(2);
    });

    it('a new seed starts from a fresh search', async () => {
        const { rerender } = await ready();
        await choose('Plains');
        await find();
        await answer('BIOME_CENTERS', { centers: [{ x: 0, z: 0, size: 4 }] });
        rerender({ seed: '42' });
        expect(screen.queryByRole('list', { name: 'Biome patches' })).toBeNull();
        await answer('SEED_SUMMARY', SPAWN);
        expect(ofKind('BIOME_CENTERS')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Find' })).toBeEnabled();       // the biome is kept
    });
});
