// Where am I inside a DashboardProvider, over the recording FakeQueueManager: the test
// answers BIOME_AT, APPROX_HEIGHT, STRONGHOLDS_LIST, GET_VERSION_SUPPORT,
// NEAREST_STRUCTURES and SLIME_CHUNKS itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import WhereAmISection, { WHERE_STORAGE_KEY, parsePoint } from './WhereAmISection';
import { DashboardProvider } from './DashboardContext';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../../util/constants';
import { ALL_STRUCTURE_TYPES } from '../../../shared/hooks/useVersionSupport';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const B = Object.fromEntries(BIOMES.map((b) => [b.label, b.value]));
const S = Object.fromEntries(STRUCTURES_OPTIONS.map((s) => [s.pureText, s.value]));
const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };

// GET_VERSION_SUPPORT for every offered type: Village, Mansion and Ruined Portal in the
// Overworld (Ruined Portal also in the Nether), Fortress in the Nether, End City in the End.
const SUPPORT = {
    mcVersion: WORLD.mcVersion, newest: WORLD.mcVersion, biomes: [], biomeDimensions: {},
    structures: Object.fromEntries(ALL_STRUCTURE_TYPES.map((t) => [t, -100])), regionBlocks: {}, minDistance: {},
};
Object.assign(SUPPORT.structures, { [S.Village]: 0, [S.Mansion]: 0, [S['Ruined Portal']]: 0, [S.Fortress]: -1, [S['End City']]: 1 });

const qm = () => FakeQueueManager.latest();
const ofKind = (kind) => (qm()?.requests ?? []).filter((r) => r.kind === kind);
const answer = (kind, result) => act(async () => { qm().resolveRequest(kind, result); });

// A provider value with a real slimeOverlay state, like SeedPage's.
function Harness({ world, mapApi, sheetApi, initialSlime = false, onSlime }) {
    const [slimeOverlay, setSlime] = useState(initialSlime);
    const setSlimeOverlay = (on) => { onSlime?.(on); setSlime(on); };
    const value = {
        world, mapApi, sheetApi, structuresToShow: [], setStructuresToShow: vi.fn(),
        slimeOverlay, setSlimeOverlay, worlds: { worlds: [] }, showSection: vi.fn(),
    };
    return <DashboardProvider value={value}><WhereAmISection /></DashboardProvider>;
}
function renderWhere(world = {}, props = {}) {
    const mapApi = { current: { panTo: vi.fn(), setHighlight: vi.fn() } };
    const sheetApi = { current: { open: vi.fn(), close: vi.fn(), getSnap: () => 'full' } };
    const utils = render(<Harness world={{ ...WORLD, ...world }} mapApi={mapApi} sheetApi={sheetApi} {...props} />);
    const rerender = (next) => utils.rerender(<Harness world={{ ...WORLD, ...world, ...next }} mapApi={mapApi} sheetApi={sheetApi} {...props} />);
    return { ...utils, mapApi, sheetApi, rerender };
}

const input = (name) => screen.getByLabelText(name);
const type = (name, value) => fireEvent.change(input(name), { target: { value } });
const locate = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Locate' })); });
async function locateAt(x, z, y = '') {
    type('X coordinate', String(x));
    type('Z coordinate', String(z));
    type('Y coordinate (optional)', String(y));
    await locate();
}
// The label/value row of the facts list.
const fact = (label) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;
// Answer every scalar query at once (biome, surface, and the version probe).
async function answerFacts({ biome = B.Plains, height = 71 } = {}) {
    await answer('BIOME_AT', { biome });
    await answer('APPROX_HEIGHT', { height });
}
// A 32x32 SLIME_CHUNKS reply around chunk (pcx, pcz) with slime at the given chunks.
const slimeReply = (pcx, pcz, chunks) => {
    const cx0 = pcx - 16, cz0 = pcz - 16;
    const cells = new Uint8Array(32 * 32);
    for (const [cx, cz] of chunks) cells[(cz - cz0) * 32 + (cx - cx0)] = 1;
    return { cx0, cz0, w: 32, h: 32, cells };
};

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    window.sessionStorage.clear();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
});

describe('the form', () => {
    it('is X, Z, an optional Y (the map\'s height as placeholder) and Locate; nothing is asked before Locate', () => {
        renderWhere({ yHeight: 62 });
        for (const name of ['X coordinate', 'Z coordinate', 'Y coordinate (optional)']) {
            expect(input(name)).toHaveAttribute('type', 'number');
            expect(input(name)).toHaveAttribute('step', '1');
            expect(input(name)).toHaveAttribute('inputmode', 'numeric');
        }
        expect(input('Y coordinate (optional)')).toHaveAttribute('placeholder', '62');
        type('X coordinate', '100');
        type('Z coordinate', '-200');
        expect(screen.getByRole('button', { name: 'Locate' })).toBeInTheDocument();
        expect(qm()?.requests ?? []).toEqual([]);                     // not even the version probe
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('rejects anything but whole numbers inside the world border (and Y in -64..320): an alert, no request', async () => {
        renderWhere();
        for (const [x, z, y] of [['1.5', '0', ''], ['0', '', ''], ['30000001', '0', ''], ['0', '-30000001', ''], ['0', '0', '400'], ['0', '0', '-65'], ['1e3', '0', '']]) {
            await locateAt(x, z, y);
            expect(screen.getByRole('alert'), `${x}, ${z}, ${y}`).toHaveTextContent('Enter whole-number coordinates.');
        }
        expect(qm()?.requests ?? []).toEqual([]);
        expect(window.sessionStorage.getItem(WHERE_STORAGE_KEY)).toBeNull();
        // Editing clears the alert; a valid point asks.
        type('X coordinate', '30000000');
        expect(screen.queryByRole('alert')).toBeNull();
        await locateAt('30000000', '-30000000', '-64');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(ofKind('BIOME_AT')).toHaveLength(1);
    });

    it('parsePoint: whole numbers only, Y optional', () => {
        expect(parsePoint({ x: ' -9 ', z: '17', y: '' })).toEqual({ x: -9, z: 17, y: null });
        expect(parsePoint({ x: '0', z: '0', y: '320' })).toEqual({ x: 0, z: 0, y: 320 });
        expect(parsePoint({ x: '0.0', z: '0', y: '' })).toBeNull();
        expect(parsePoint({ x: '0', z: '0', y: '321' })).toBeNull();
    });

    it('Enter in a field locates, like the button', async () => {
        renderWhere();
        type('X coordinate', '5');
        type('Z coordinate', '6');
        await act(async () => { fireEvent.submit(input('Z coordinate').closest('form')); });
        expect(ofKind('BIOME_AT').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, x: 5, y: 256, z: 6 }]);
    });

    it('keeps the last located point for the session, and fills the form with it next time without asking', async () => {
        const first = renderWhere();
        await locateAt(-120, 340, 12);
        expect(JSON.parse(window.sessionStorage.getItem(WHERE_STORAGE_KEY))).toEqual({ x: -120, z: 340, y: 12 });
        first.unmount();
        FakeQueueManager.reset();
        resetQueueManagerForTests();
        renderWhere();
        expect(input('X coordinate')).toHaveValue(-120);
        expect(input('Z coordinate')).toHaveValue(340);
        expect(input('Y coordinate (optional)')).toHaveValue(12);
        expect(qm()?.requests ?? []).toEqual([]);
        // A blank Y is stored as null.
        await locateAt(1, 2, '');
        expect(JSON.parse(window.sessionStorage.getItem(WHERE_STORAGE_KEY))).toEqual({ x: 1, z: 2, y: null });
    });

    it('changing an input after Locate clears the results; another world clears them but keeps the point', async () => {
        const { rerender } = renderWhere();
        await locateAt(0, 0);
        await answerFacts();
        expect(fact('Biome')).toBeInTheDocument();
        type('X coordinate', '1');
        expect(screen.queryByText('Biome', { selector: 'dt' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Centre map here' })).toBeNull();
        await locate();
        expect(screen.getByRole('button', { name: 'Centre map here' })).toBeInTheDocument();
        rerender({ seed: '42' });
        expect(screen.queryByRole('button', { name: 'Centre map here' })).toBeNull();
        expect(input('X coordinate')).toHaveValue(1);
    });
});

describe('what Locate asks', () => {
    it('on 26.3: biome at the map\'s Y, surface, all 128 strongholds approximate, the version, then structures and slime chunks', async () => {
        renderWhere({ yHeight: 62 });
        await locateAt(-1000, 250);
        const common = { mcVersion: WORLD.mcVersion, seed: WORLD.seed };
        expect(ofKind('BIOME_AT').map((r) => r.data)).toEqual([{ ...common, dimension: 0, x: -1000, y: 62, z: 250 }]);
        expect(ofKind('APPROX_HEIGHT').map((r) => r.data)).toEqual([{ ...common, dimension: 0, x: -1000, z: 250 }]);
        expect(ofKind('STRONGHOLDS_LIST').map((r) => r.data)).toEqual([{ ...common, howMany: 128, approx: true }]);
        expect(ofKind('GET_VERSION_SUPPORT').map((r) => [r.data, r.opts.priority])).toEqual([
            [{ mcVersion: WORLD.mcVersion, biomeIds: [], structTypes: ALL_STRUCTURE_TYPES }, 'high'],
        ]);
        // Chunk of block -1000 is -63 (floor), of 250 is 15.
        expect(ofKind('SLIME_CHUNKS').map((r) => r.data)).toEqual([{ seed: WORLD.seed, cx0: -63 - 16, cz0: 15 - 16, w: 32, h: 32 }]);
        expect(ofKind('NEAREST_STRUCTURES')).toHaveLength(0);           // waits for the version
        await answer('GET_VERSION_SUPPORT', SUPPORT);
        expect(ofKind('NEAREST_STRUCTURES').map((r) => r.data)).toEqual([{
            ...common, dimension: 0, x: -1000, z: 250, types: [S.Village, S.Mansion, S['Ruined Portal']], maxRadiusBlocks: 2048,
        }]);
        // Everything but the version probe waits behind the map's tiles.
        for (const r of qm().requests.filter((r) => r.kind !== 'GET_VERSION_SUPPORT')) expect(r.opts.priority, r.kind).toBe('low');
    });

    it('uses the typed Y for the biome, and asks for exact strongholds up to 1.19.2', async () => {
        renderWhere({ mcVersion: VERSIONS['1.19.2'], versionLabel: '1.19.2' });
        await locateAt(8, 8, -30);
        expect(ofKind('BIOME_AT')[0].data).toMatchObject({ x: 8, y: -30, z: 8 });
        expect(ofKind('STRONGHOLDS_LIST')[0].data).toEqual({ mcVersion: VERSIONS['1.19.2'], seed: WORLD.seed, howMany: 128, approx: false });
    });

    it('in the Nether asks no strongholds and no slime chunks, and gates the structures to the Nether', async () => {
        renderWhere({ dimension: -1 });
        await locateAt(3, -2);
        expect(ofKind('STRONGHOLDS_LIST')).toHaveLength(0);
        expect(ofKind('SLIME_CHUNKS')).toHaveLength(0);
        expect(ofKind('BIOME_AT')[0].data).toMatchObject({ dimension: -1, x: 3, z: -2 });
        await answer('GET_VERSION_SUPPORT', SUPPORT);
        expect(ofKind('NEAREST_STRUCTURES')[0].data).toMatchObject({ dimension: -1, types: [S['Ruined Portal'], S.Fortress] });
    });
});

describe('the answers', () => {
    it('shows the biome at Y with its swatch, the surface and the Nether coordinates (floor for negatives)', async () => {
        renderWhere();
        await locateAt(-9, 17);
        await answerFacts({ biome: B['Cherry Grove'], height: 104 });
        expect(fact('Biome')).toHaveTextContent('Cherry Grove at Y 256');
        expect(fact('Biome').querySelector('[aria-hidden="true"]')).toHaveStyle({ backgroundColor: expect.any(String) });
        expect(fact('Surface')).toHaveTextContent('≈ Y 104');
        expect(within(fact('In the Nether')).getByText('(-2, 2)')).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(fact('In the Nether')).getByRole('button', { name: 'Copy' })); });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('-2, 2');
    });

    it('a null surface (before 1.18) hides its row', async () => {
        renderWhere({ mcVersion: VERSIONS['1.12'], versionLabel: '1.12' });
        await locateAt(0, 0);
        await answerFacts({ height: null });
        expect(fact('Biome')).toBeInTheDocument();
        expect(screen.queryByText('Surface', { selector: 'dt' })).toBeNull();
    });

    it('in the Nether converts to the Overworld (x8) and hides the stronghold and slime blocks', async () => {
        renderWhere({ dimension: -1 });
        await locateAt(3, -2);
        await answerFacts({ biome: B['Nether Wastes'], height: null });
        expect(within(fact('In the Overworld')).getByText('(24, -16)')).toBeInTheDocument();
        expect(screen.queryByText('In the Nether', { selector: 'dt' })).toBeNull();
        expect(screen.queryByText('Nearest stronghold')).toBeNull();
        expect(screen.queryByText('Nearest slime chunks')).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.getByText('Nearest structures')).toBeInTheDocument();
    });

    it('in the End has no conversion', async () => {
        renderWhere({ dimension: 1 });
        await locateAt(100, 100);
        await answerFacts({ biome: B['The End'], height: 60 });
        expect(fact('Surface')).toHaveTextContent('≈ Y 60');
        expect(screen.queryByText(/^In the (Nether|Overworld)$/, { selector: 'dt' })).toBeNull();
        expect(screen.queryByText('Nearest stronghold')).toBeNull();
    });

    it('the nearest stronghold is the closest of the 128 to the point, with its ring, approximate from 1.19.3', async () => {
        const { mapApi, sheetApi } = renderWhere();
        await locateAt(1000, 1000);
        await answer('STRONGHOLDS_LIST', {
            strongholds: [
                { x: -1356, z: 164, ring: 0, index: 0 },
                { x: 1108, z: 1524, ring: 0, index: 2 },                 // 535 blocks away
                { x: 3000, z: 3000, ring: 1, index: 3 },
                { x: 1500, z: 1300, ring: 1, index: 4 },                 // 570 blocks away
            ],
        });
        const list = screen.getByRole('list', { name: 'Nearest stronghold' });
        const [row] = within(list).getAllByRole('listitem');
        expect(row).toHaveTextContent('≈ (1108, 1524)');
        expect(row).toHaveTextContent('535 blocks · Ring 1');
        expect(screen.getByText('Positions approximate (±112 blocks).')).toBeInTheDocument();
        fireEvent.click(within(row).getByRole('button', { expanded: false }));
        fireEvent.click(within(row).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(1108, 1524);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: 1108, z: 1524, label: 'Stronghold' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('says so when the version has no strongholds; exact positions carry no ≈ and no note', async () => {
        const { unmount } = renderWhere({ mcVersion: VERSIONS['Beta 1.7'], versionLabel: 'Beta 1.7' });
        await locateAt(0, 0);
        await answer('STRONGHOLDS_LIST', { strongholds: [] });
        expect(screen.getByText('No strongholds in this version.')).toBeInTheDocument();
        unmount();
        clearSeedQueryCache();
        renderWhere({ mcVersion: VERSIONS['1.16.5'], versionLabel: '1.16.5' });
        await locateAt(0, 0);
        await answer('STRONGHOLDS_LIST', { strongholds: [{ x: 500, z: 0, ring: 0, index: 0 }] });
        const [row] = within(screen.getByRole('list', { name: 'Nearest stronghold' })).getAllByRole('listitem');
        expect(row).toHaveTextContent('(500, 0)');
        expect(row).not.toHaveTextContent('≈');
        expect(screen.queryByText('Positions approximate (±112 blocks).')).toBeNull();
    });

    it('lists the nearest structures around the point, found ones nearest first, "None within 2k blocks" last', async () => {
        const { mapApi, sheetApi } = renderWhere();
        await locateAt(0, 0);
        await answer('GET_VERSION_SUPPORT', SUPPORT);
        await answer('NEAREST_STRUCTURES', {
            results: [
                { type: S.Village, found: 1, x: 300, z: 400 },
                { type: S.Mansion, found: 0, x: 0, z: 0 },
                { type: S['Ruined Portal'], found: 1, x: -60, z: 80 },
            ],
        });
        const list = screen.getByRole('list', { name: 'Nearest structures around this point' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows.map((r) => r.textContent)).toEqual([
            expect.stringContaining('Ruined Portal'), expect.stringContaining('Village'), expect.stringContaining('Mansion'),
        ]);
        expect(rows[0]).toHaveTextContent('100 blocks');
        expect(rows[1]).toHaveTextContent('500 blocks');
        expect(rows[2]).toHaveTextContent('None within 2k blocks');
        // No "Show all" here: that toggle belongs to the Structures section.
        fireEvent.click(within(rows[1]).getByRole('button', { expanded: false }));
        expect(within(rows[1]).queryByRole('button', { name: 'Show all' })).toBeNull();
        fireEvent.click(within(rows[1]).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(300, 400);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: 300, z: 400, label: 'Village' });
        expect(sheetApi.current.close).toHaveBeenCalled();
    });

    it('shows the first 5 structures, then "Show N more"', async () => {
        renderWhere();
        await locateAt(0, 0);
        const types = [1, 2, 3, 4, 5, 6, 7, 8];
        await answer('GET_VERSION_SUPPORT', { ...SUPPORT, structures: Object.fromEntries(types.map((t) => [t, 0])) });
        await answer('NEAREST_STRUCTURES', { results: types.map((type, i) => ({ type, found: 1, x: 10 * (i + 1), z: 0 })) });
        const list = () => screen.getByRole('list', { name: 'Nearest structures around this point' });
        expect(within(list()).getAllByRole('listitem')).toHaveLength(5);
        fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }));
        expect(within(list()).getAllByRole('listitem')).toHaveLength(8);
    });

    it('lists the 10 nearest slime chunks by chunk centre, with their block range, Copy and Show on map', async () => {
        const { mapApi, sheetApi } = renderWhere();
        await locateAt(-9, 17);                                           // chunk (-1, 1)
        // Twelve slime chunks; the nearest to (-9, 17) is chunk (-1, 1) itself (centre (-8, 24)).
        const chunks = [[-1, 1], [5, 5], [-6, 0], [0, 0], [2, -3], [-3, 4], [10, 10], [-15, -15], [14, -2], [0, 9], [-8, 8], [3, 1]];
        await answer('SLIME_CHUNKS', slimeReply(-1, 1, chunks));
        const rows = within(screen.getByRole('list', { name: 'Nearest slime chunks' })).getAllByRole('listitem');
        expect(rows).toHaveLength(10);
        const distance = ([cx, cz]) => Math.round(Math.hypot(cx * 16 + 8 + 9, cz * 16 + 8 - 17));
        const expected = [...chunks].sort((a, b) => distance(a) - distance(b)).slice(0, 10);
        expect(rows.map((r) => within(r).getByText(/^\(/, { selector: 'code' }).textContent)).toEqual(expected.map(([cx, cz]) => `(${cx}, ${cz})`));
        expect(rows[0]).toHaveTextContent('Chunk (-1, 1)');
        expect(rows[0]).toHaveTextContent('7 blocks');
        fireEvent.click(within(rows[0]).getByRole('button', { expanded: false }));
        expect(within(rows[0]).getByText('Blocks -16 to -1, 16 to 31')).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(rows[0]).getByRole('button', { name: 'Copy' })); });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('-16, 16');
        fireEvent.click(within(rows[0]).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(-8, 24);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: -8, z: 24, label: 'Slime chunk' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/^Slime chunks are fixed per seed \(Overworld, below Y 40\)\./)).toBeInTheDocument();
    });

    it('the checkbox reflects and sets the map\'s slime overlay', async () => {
        const onSlime = vi.fn();
        renderWhere({}, { initialSlime: true, onSlime });
        await locateAt(0, 0);
        const toggle = screen.getByRole('checkbox', { name: 'Show slime chunks on the map' });
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);
        expect(onSlime).toHaveBeenLastCalledWith(false);
        expect(toggle).not.toBeChecked();
        fireEvent.click(toggle);
        expect(onSlime).toHaveBeenLastCalledWith(true);
        expect(toggle).toBeChecked();
    });

    it('"Centre map here" pans to the point, marks it "You" and gets the sheet out of the way', async () => {
        const { mapApi, sheetApi } = renderWhere();
        await locateAt(-321, 654);
        fireEvent.click(screen.getByRole('button', { name: 'Centre map here' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(-321, 654);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: -321, z: 654, label: 'You' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('each block shows its own loading and error state', async () => {
        renderWhere();
        await locateAt(0, 0);
        expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(4);   // facts, stronghold, structures, slime
        await answer('SLIME_CHUNKS', { error: { code: -7, message: 'Bad slime window' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: Bad slime window');
        expect(screen.getByRole('checkbox', { name: 'Show slime chunks on the map' })).toBeInTheDocument();
        await answerFacts();
        expect(fact('Biome')).toBeInTheDocument();
    });
});
