// Farms inside a DashboardProvider, over the recording FakeQueueManager: the test answers
// GET_VERSION_SUPPORT, SEED_SUMMARY, QUAD_HUTS, SLIME_CHUNKS, GET_STRUCTURES_IN_REGIONS and
// FORTRESS_SPAWNERS itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import FarmsSection from './FarmsSection';
import { DashboardProvider } from './DashboardContext';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../../util/constants';
import { ALL_STRUCTURE_TYPES } from '../../../shared/hooks/useVersionSupport';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';
import { HELP } from '../../../shared/help';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const S = Object.fromEntries(STRUCTURES_OPTIONS.map((s) => [s.pureText, s.value]));
const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };
const SPAWN = { spawnX: -32, spawnZ: 80, spawnBiome: 1, approxHeight: 70 };

// GET_VERSION_SUPPORT: every quad type in the Overworld except Igloo (missing here), plus
// the Nether and End types; 512-block regions, 432 for fortresses.
function support(overrides = {}) {
    const structures = Object.fromEntries(ALL_STRUCTURE_TYPES.map((t) => [t, 0]));
    Object.assign(structures, { [S.Igloo]: -100, [S.Fortress]: -1, [S.Bastion]: -1, [S['End City']]: 1, [S['End Gateway']]: 1 });
    const regionBlocks = Object.fromEntries(ALL_STRUCTURE_TYPES.map((t) => [t, 512]));
    Object.assign(regionBlocks, { [S.Fortress]: 432, [S.Village]: 544, [S.Shipwreck]: 384 });
    return {
        mcVersion: WORLD.mcVersion, newest: WORLD.mcVersion, biomes: [], biomeDimensions: {},
        structures: { ...structures, ...overrides }, regionBlocks, minDistance: {},
    };
}

const qm = () => FakeQueueManager.latest();
const ofKind = (kind) => (qm()?.requests ?? []).filter((r) => r.kind === kind);
const answer = (kind, result, index) => act(async () => { qm().resolveRequest(kind, result, index); });

// A provider value with a real slimeOverlay state, like SeedPage's.
function Harness({ world, mapApi, sheetApi, setDimension, initialSlime = false, onSlime }) {
    const [slimeOverlay, setSlime] = useState(initialSlime);
    const setSlimeOverlay = (on) => { onSlime?.(on); setSlime(on); };
    const value = {
        world, mapApi, sheetApi, structuresToShow: [], setStructuresToShow: vi.fn(),
        slimeOverlay, setSlimeOverlay, setDimension, worlds: { worlds: [] }, showSection: vi.fn(),
    };
    return <DashboardProvider value={value}><FarmsSection /></DashboardProvider>;
}
function renderFarms(world = {}, props = {}) {
    const mapApi = { current: { panTo: vi.fn(), setHighlight: vi.fn() } };
    const sheetApi = { current: { open: vi.fn(), close: vi.fn(), getSnap: () => 'full' } };
    const setDimension = vi.fn();
    const utils = render(<Harness world={{ ...WORLD, ...world }} mapApi={mapApi} sheetApi={sheetApi} setDimension={setDimension} {...props} />);
    const rerender = (next) => utils.rerender(
        <Harness world={{ ...WORLD, ...world, ...next }} mapApi={mapApi} sheetApi={sheetApi} setDimension={setDimension} {...props} />);
    return { ...utils, mapApi, sheetApi, setDimension, rerender };
}

// Answer what an Overworld mount asks: the version, the spawn, and the quad witch farms.
async function answerOverworld(farms = [], { version = support() } = {}) {
    await answer('GET_VERSION_SUPPORT', version);
    await answer('SEED_SUMMARY', SPAWN);
    await answer('QUAD_HUTS', { farms });
}

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
});

describe('quad witch farm', () => {
    it('asks at once, with the version probe and the spawn; no picker, no radius, no button to start', () => {
        renderFarms();
        const common = { mcVersion: WORLD.mcVersion, seed: WORLD.seed };
        expect(qm().requests.map((r) => [r.kind, r.data])).toEqual([
            ['GET_VERSION_SUPPORT', { mcVersion: WORLD.mcVersion, biomeIds: [], structTypes: ALL_STRUCTURE_TYPES }],
            ['SEED_SUMMARY', { ...common, dimension: 0, yHeight: 256 }],
            ['QUAD_HUTS', common],
        ]);
        // Everything but the version probe waits behind the map's tiles.
        expect(qm().requests.map((r) => r.opts.priority)).toEqual(['high', 'low', 'low']);
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.queryByRole('group', { name: 'Radius' })).toBeNull();
        expect(screen.queryByRole('button', { name: /scan/i })).toBeNull();
    });

    it('waits for the version, the spawn and the answer', async () => {
        renderFarms();
        expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
        await answer('GET_VERSION_SUPPORT', support());
        await answer('QUAD_HUTS', { farms: [{ x: 10, z: 20 }] });
        expect(screen.queryByText(/quad witch farm at/)).toBeNull();          // the spawn is still out
        await answer('SEED_SUMMARY', SPAWN);
        expect(screen.getByText(/quad witch farm at/)).toBeInTheDocument();
    });

    it('says yes with the farm nearest to spawn, how far it is, and Show on map', async () => {
        const { mapApi, sheetApi } = renderFarms();
        await answerOverworld([{ x: 4000, z: 4000 }, { x: -200, z: 300 }, { x: 1000, z: -1000 }]);
        const block = screen.getByText('Quad witch farm', { selector: 'h4' }).parentElement;
        expect(block).toHaveTextContent('Yes: a quad witch farm at (-200, 300), 277 blocks from spawn.');   // spawn (-32, 80)
        expect(within(block).getByText('Yes').tagName).toBe('STRONG');
        expect(within(block).getByText('2 more within 8k blocks of the origin.')).toBeInTheDocument();
        // One answer, no list of farms.
        expect(within(block).queryByRole('list')).toBeNull();
        // The heading's "?" and the one action.
        expect(within(block).getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label')))
            .toEqual([HELP.quadWitchFarm.label, 'Show on map']);
        fireEvent.click(within(block).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(-200, 300);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: -200, z: 300, label: 'Quad witch farm' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('a single farm has no "more" note; without a spawn, distances are from the origin', async () => {
        renderFarms();
        await answer('GET_VERSION_SUPPORT', support());
        await answer('SEED_SUMMARY', { error: { code: -1, message: 'no spawn' } });
        await answer('QUAD_HUTS', { farms: [{ x: -68, z: -76 }] });
        expect(screen.getByText(/quad witch farm at/).textContent).toBe('Yes: a quad witch farm at (-68, -76), 102 blocks from the origin.');
        expect(screen.queryByText(/more within/)).toBeNull();
    });

    it('says no, with the reach and the rarity note, when there is none', async () => {
        renderFarms();
        await answerOverworld([]);
        expect(screen.getByText('No quad witch farm within 8k blocks of the origin.')).toHaveClass('section__empty');
        expect(screen.getByText('Quad witch huts are extremely rare: about one region in 100 million.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull();
    });

    it('renders an engine error', async () => {
        renderFarms();
        await answer('GET_VERSION_SUPPORT', support());
        await answer('SEED_SUMMARY', SPAWN);
        await answer('QUAD_HUTS', { farms: [], error: { code: -3, message: 'This Minecraft version has no witch huts.' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: This Minecraft version has no witch huts.');
    });

    it('on a version without witch huts, says so instead of an answer', async () => {
        renderFarms({ mcVersion: VERSIONS['1.3'], versionLabel: '1.3' });
        await answer('GET_VERSION_SUPPORT', support({ [S['Swamp Hut']]: -100 }));
        await answer('SEED_SUMMARY', SPAWN);
        await answer('QUAD_HUTS', { farms: [], error: { code: -3, message: 'This Minecraft version has no witch huts.' } });
        expect(screen.getByText("Witch huts don't generate on 1.3.")).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a new world asks again', async () => {
        const { rerender } = renderFarms();
        await answerOverworld([{ x: 1, z: 2 }]);
        rerender({ seed: '42' });
        expect(ofKind('QUAD_HUTS').at(-1).data).toEqual({ mcVersion: WORLD.mcVersion, seed: '42' });
        expect(screen.queryByText(/quad witch farm at/)).toBeNull();
    });

    it('outside the Overworld asks nothing and says where witch huts are', () => {
        for (const dimension of [-1, 1]) {
            const { unmount } = renderFarms({ dimension });
            expect(ofKind('QUAD_HUTS')).toHaveLength(0);
            expect(ofKind('SEED_SUMMARY')).toHaveLength(0);
            expect(screen.getByText('Witch huts are in the Overworld.')).toBeInTheDocument();
            unmount();
            FakeQueueManager.reset();
            resetQueueManagerForTests();
        }
    });
});

describe('blaze spawners', () => {
    it('in the Overworld and the End: a note and "Switch to the Nether", which asks for dimension -1', () => {
        for (const dimension of [0, 1]) {
            const { setDimension, unmount } = renderFarms({ dimension });
            expect(screen.getByText('Blaze spawners live in Nether fortresses.')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Switch to the Nether' }));
            expect(setDimension).toHaveBeenCalledWith(-1);
            expect(ofKind('GET_STRUCTURES_IN_REGIONS')).toHaveLength(0);
            unmount();
        }
    });

    it('in the Nether: the 3 fortresses nearest to the origin, each with its spawners asked for at once', async () => {
        const { mapApi, sheetApi } = renderFarms({ dimension: -1 });
        expect(screen.queryByRole('button', { name: 'Switch to the Nether' })).toBeNull();
        await answer('GET_VERSION_SUPPORT', support());
        expect(ofKind('GET_STRUCTURES_IN_REGIONS').map((r) => [r.data, r.opts.priority])).toEqual([[
            { mcVersion: WORLD.mcVersion, structType: S.Fortress, seed: WORLD.seed, regionsRange: 4, dimension: -1 }, 'low',
        ]]);
        // As the worker answers: Int32Array pairs.
        const coords = [[900, 900], [-250, 40], [300, -700], [1500, 0], [-37, -600]].map((p) => Int32Array.from(p));
        await answer('GET_STRUCTURES_IN_REGIONS', { coords });
        const rows = within(screen.getByRole('list', { name: 'Nearest fortresses' })).getAllByRole('listitem');
        expect(rows.map((r) => within(r).getByText(/^\(/, { selector: 'code' }).textContent)).toEqual(['(-250, 40)', '(-37, -600)', '(300, -700)']);
        expect(rows[0]).toHaveTextContent('253 blocks');
        // One FORTRESS_SPAWNERS per row, from the chunk the fortress starts in (floor for negatives).
        expect(ofKind('FORTRESS_SPAWNERS').map((r) => r.data)).toEqual([
            { mcVersion: WORLD.mcVersion, seed: WORLD.seed, chunkX: -16, chunkZ: 2 },
            { mcVersion: WORLD.mcVersion, seed: WORLD.seed, chunkX: -3, chunkZ: -38 },
            { mcVersion: WORLD.mcVersion, seed: WORLD.seed, chunkX: 18, chunkZ: -44 },
        ]);
        await answer('FORTRESS_SPAWNERS', { spawners: [{ x: -230, y: 72, z: 60 }, { x: -300, y: 65, z: 150 }], wartRooms: 1 }, 0);
        await answer('FORTRESS_SPAWNERS', { spawners: [{ x: -40, y: 70, z: -580 }], wartRooms: 0 }, 0);
        expect(rows[0]).toHaveTextContent('2 blaze spawners');
        expect(rows[1]).toHaveTextContent('1 blaze spawner');
        expect(rows[1]).not.toHaveTextContent('1 blaze spawners');
        expect(rows[2]).not.toHaveTextContent('blaze spawner');         // not answered yet

        fireEvent.click(within(rows[0]).getByRole('button', { expanded: false }));
        const spawners = within(within(rows[0]).getByRole('list', { name: 'Blaze spawners' })).getAllByRole('listitem');
        expect(spawners.map((s) => within(s).getByText(/^\(/, { selector: 'code' }).textContent)).toEqual(['(-230, 72, 60)', '(-300, 65, 150)']);
        expect(rows[0]).toHaveTextContent('1 nether wart room');
        expect(within(rows[0]).getByText(/^Blaze spawners sit on fortress bridge pieces; coordinates are the piece centre, Y is the bridge level\.$/)).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(spawners[1]).getByRole('button', { name: 'Copy' })); });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('-300, 65, 150');
        fireEvent.click(within(spawners[1]).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(-300, 150);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: -300, z: 150, label: 'Blaze spawner' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
        fireEvent.click(within(rows[1]).getByRole('button', { expanded: false }));
        expect(rows[1]).toHaveTextContent('0 nether wart rooms');
    });

    it('orders fortresses by their exact distance, even when both read the same rounded one', async () => {
        renderFarms({ dimension: -1 });
        await answer('GET_VERSION_SUPPORT', support());
        // 250.4 and 249.9 blocks: both "250 blocks"; the nearer one comes first.
        await answer('GET_STRUCTURES_IN_REGIONS', { coords: [Int32Array.from([224, -112]), Int32Array.from([192, 160])] });
        const rows = within(screen.getByRole('list', { name: 'Nearest fortresses' })).getAllByRole('listitem');
        expect(rows.map((r) => within(r).getByText(/^\(/, { selector: 'code' }).textContent)).toEqual(['(192, 160)', '(224, -112)']);
        expect(rows.map((r) => r.textContent.includes('250 blocks'))).toEqual([true, true]);
    });

    it('says so when no fortress is in reach, and when the version has none', async () => {
        const { unmount } = renderFarms({ dimension: -1 });
        await answer('GET_VERSION_SUPPORT', support());
        await answer('GET_STRUCTURES_IN_REGIONS', { coords: [] });
        expect(screen.getByText('No fortress within 1728 blocks of the origin.')).toBeInTheDocument();
        unmount();
        clearSeedQueryCache();
        FakeQueueManager.reset();
        resetQueueManagerForTests();
        renderFarms({ dimension: -1, mcVersion: VERSIONS['Beta 1.7'], versionLabel: 'Beta 1.7' });
        await answer('GET_VERSION_SUPPORT', support({ [S.Fortress]: -100 }));
        expect(screen.getByText('No fortresses on this version.')).toBeInTheDocument();
        expect(ofKind('GET_STRUCTURES_IN_REGIONS')).toHaveLength(0);
    });
});

describe('slime chunks and the caveat', () => {
    it('lists the 10 slime chunks nearest to spawn, once the spawn is known, with the map\'s overlay checkbox', async () => {
        const onSlime = vi.fn();
        const { mapApi } = renderFarms({}, { onSlime });
        expect(ofKind('SLIME_CHUNKS')).toHaveLength(0);                     // waits for the spawn
        await answer('SEED_SUMMARY', SPAWN);
        // Spawn (-32, 80) is chunk (-2, 5).
        expect(ofKind('SLIME_CHUNKS').map((r) => [r.data, r.opts.priority])).toEqual([[{ seed: WORLD.seed, cx0: -18, cz0: -11, w: 32, h: 32 }, 'low']]);
        const cells = new Uint8Array(32 * 32);
        for (let i = 0; i < 12; i++) cells[i * 70] = 1;
        await answer('SLIME_CHUNKS', { cx0: -18, cz0: -11, w: 32, h: 32, cells });
        const rows = within(screen.getByRole('list', { name: 'Nearest slime chunks' })).getAllByRole('listitem');
        expect(rows).toHaveLength(10);
        fireEvent.click(within(rows[0]).getByRole('button', { expanded: false }));
        fireEvent.click(within(rows[0]).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith(expect.objectContaining({ label: 'Slime chunk' }));
        const toggle = screen.getByRole('checkbox', { name: 'Show slime chunks on the map' });
        expect(toggle).not.toBeChecked();
        fireEvent.click(toggle);
        expect(onSlime).toHaveBeenLastCalledWith(true);
        expect(toggle).toBeChecked();
    });

    it('hides the slime block outside the Overworld', () => {
        for (const dimension of [-1, 1]) {
            const { unmount } = renderFarms({ dimension });
            expect(screen.queryByText('Nearest slime chunks')).toBeNull();
            expect(screen.queryByRole('checkbox')).toBeNull();
            expect(ofKind('SLIME_CHUNKS')).toHaveLength(0);
            unmount();
        }
    });

    it('closes with the spawner caveat in every dimension, under the three blocks', () => {
        for (const dimension of [0, -1, 1]) {
            const { container, unmount } = renderFarms({ dimension });
            const caveat = screen.getByText('Dungeon (monster room) and mineshaft spawners depend on terrain carving and cannot be predicted from the seed here.');
            expect(container.lastElementChild).toBe(caveat);
            const titles = [...container.querySelectorAll('h4')].map((h) => h.textContent);
            expect(titles).toEqual(dimension === 0
                ? ['Quad witch farm', 'Blaze spawners', 'Nearest slime chunks']
                : ['Quad witch farm', 'Blaze spawners']);
            unmount();
        }
    });
});
