// The Structures section's body (and the shared StructureRows) inside a DashboardProvider,
// over the recording FakeQueueManager: the test answers GET_VERSION_SUPPORT, SEED_SUMMARY,
// NEAREST_STRUCTURES and STRUCTURE_VARIANT itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StructuresSection from './StructuresSection';
import { DashboardProvider } from './DashboardContext';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../../util/constants';
import { STRUCTURE_ICONS } from '../../../library/draw';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const T = Object.fromEntries(STRUCTURES_OPTIONS.map((s) => [s.pureText, s.value]));
const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };
const SPAWN = { spawnX: -32, spawnZ: 80, spawnBiome: 1, approxHeight: 71 };

// GET_VERSION_SUPPORT as the engine answers it on 26.3 (structures: type -> dimension).
const SUPPORT_26_3 = {
    mcVersion: WORLD.mcVersion, newest: WORLD.mcVersion, biomes: [], biomeDimensions: {},
    structures: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 13: 0, 18: -1, 19: -1, 21: 1, 22: 1, 24: 0, 25: 0, 26: 0 },
    regionBlocks: {}, minDistance: {},
};
// On 1.8 the End has nothing (End cities and gateways arrive in 1.9).
const SUPPORT_1_8 = {
    ...SUPPORT_26_3, mcVersion: VERSIONS['1.8'],
    structures: { 1: 0, 2: 0, 3: 0, 4: -100, 5: 0, 6: -100, 7: -100, 8: 0, 9: -100, 10: -100, 11: -100, 13: -100, 18: -1, 19: -100, 21: -100, 22: -100, 24: -100, 25: -100, 26: -100 },
};
const OVERWORLD_TYPES = ['Desert Pyramid', 'Jungle Pyramid', 'Swamp Hut', 'Igloo', 'Village', 'Ocean Ruin', 'Shipwreck', 'Monument', 'Mansion',
    'Outpost', 'Ruined Portal', 'Ancient City', 'Trail Ruin', 'Trial Chamber', 'Abandoned Camp'].map((name) => T[name]);

const qm = () => FakeQueueManager.latest();
const ofKind = (kind) => qm().requests.filter((r) => r.kind === kind);
const answer = (kind, result) => act(async () => { qm().resolveRequest(kind, result); });
// Answer the pending STRUCTURE_VARIANT request for one type.
const answerVariant = (type, variant) => act(async () => {
    const entry = qm().pendingOf('STRUCTURE_VARIANT').find((r) => r.data.type === type);
    if (!entry) throw new Error(`no pending variant for type ${type}`);
    entry.resolve({ error: null, variant });
});
const VARIANT = { supported: 1, abandoned: 0, giant: 0, underground: 0, airpocket: 0, basement: 0, cracked: 0, size: 0, start: -1, biome: -1,
    rotation: 0, mirror: 0, bx: 0, by: 320, bz: 0, sx: 0, sy: 0, sz: 0, endShip: 0 };

function Harness({ world, mapApi, sheetApi, structuresToShow, setStructuresToShow }) {
    const value = { world, mapApi, sheetApi, structuresToShow, setStructuresToShow, worlds: { worlds: [] }, showSection: vi.fn() };
    return <DashboardProvider value={value}><StructuresSection /></DashboardProvider>;
}
function renderStructures(world = {}, { structuresToShow = [] } = {}) {
    const mapApi = { current: { panTo: vi.fn(), setHighlight: vi.fn() } };
    const sheetApi = { current: { open: vi.fn(), close: vi.fn(), getSnap: () => 'full' } };
    const setStructuresToShow = vi.fn();
    const props = { mapApi, sheetApi, structuresToShow, setStructuresToShow };
    const utils = render(<Harness world={{ ...WORLD, ...world }} {...props} />);
    const rerender = (next) => utils.rerender(<Harness world={{ ...WORLD, ...world, ...next }} {...props} />);
    return { ...utils, ...props, rerender };
}

// The Overworld nearest answer for OVERWORLD_TYPES (distances from the spawn (-32, 80)).
const OVERWORLD_RESULTS = [
    { type: T['Desert Pyramid'], found: 0, x: 0, z: 0 },
    { type: T['Jungle Pyramid'], found: 1, x: 1200, z: -700 },      // 1459
    { type: T['Swamp Hut'], found: 0, x: 0, z: 0 },
    { type: T.Igloo, found: 1, x: -2000, z: 1500 },                 // 2427
    { type: T.Village, found: 1, x: 150, z: 90 },                   // 182
    { type: T['Ocean Ruin'], found: 1, x: -400, z: 60 },            // 369
    { type: T.Shipwreck, found: 1, x: -380, z: 50 },                // 349
    { type: T.Monument, found: 1, x: 700, z: 900 },                 // 1161
    { type: T.Mansion, found: 0, x: 0, z: 0 },
    { type: T.Outpost, found: 1, x: 500, z: -300 },                 // 653
    { type: T['Ruined Portal'], found: 1, x: 40, z: 200 },          // 140
    { type: T['Ancient City'], found: 1, x: -900, z: -1800 },       // 2078
    { type: T['Trail Ruin'], found: -1, x: 0, z: 0 },               // e.g. the gate said no: dropped
    { type: T['Trial Chamber'], found: 1, x: 300, z: 400 },         // 463
    { type: T['Abandoned Camp'], found: 1, x: 3000, z: 3000 },      // 4201
];
const NEAREST_FIRST = ['Ruined Portal', 'Village', 'Shipwreck', 'Ocean Ruin', 'Trial Chamber', 'Outpost', 'Monument', 'Jungle Pyramid',
    'Ancient City', 'Igloo', 'Abandoned Camp', 'Desert Pyramid', 'Swamp Hut', 'Mansion'];

// Render in the Overworld and answer the version, the spawn and the nearest query.
async function loaded(world = {}, options) {
    const handles = renderStructures(world, options);
    await answer('GET_VERSION_SUPPORT', SUPPORT_26_3);
    await answer('SEED_SUMMARY', SPAWN);
    await answer('NEAREST_STRUCTURES', { results: OVERWORLD_RESULTS });
    return handles;
}

const NAMES = STRUCTURES_OPTIONS.map((o) => o.pureText);
const list = () => screen.getByRole('list', { name: 'Nearest structures' });
const rows = () => within(list()).getAllByRole('listitem');
const nameOf = (row) => NAMES.find((name) => within(row).queryByText(name, { exact: true }));
const rowOf = (name) => rows().find((row) => nameOf(row) === name);
// Open a row's details (its summary is the one toggle button in it).
const openRow = (user, name) => user.click(within(rowOf(name)).getByRole('button', { expanded: false }));

let writeText;
beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('StructuresSection', () => {
    it('asks for the version support (high) and the spawn, then one NEAREST_STRUCTURES for the Overworld types around the spawn', async () => {
        renderStructures();
        expect(ofKind('GET_VERSION_SUPPORT').map((r) => [r.data, r.opts.priority])).toEqual([
            [{ mcVersion: WORLD.mcVersion, biomeIds: [], structTypes: STRUCTURES_OPTIONS.map((s) => s.value) }, 'high'],
        ]);
        expect(ofKind('SEED_SUMMARY').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, yHeight: 256 }]);
        expect(ofKind('NEAREST_STRUCTURES')).toHaveLength(0);
        expect(screen.getByRole('status')).toBeInTheDocument();
        await answer('GET_VERSION_SUPPORT', SUPPORT_26_3);
        expect(ofKind('NEAREST_STRUCTURES')).toHaveLength(0);            // the spawn is still missing
        expect(screen.getByRole('status')).toBeInTheDocument();
        await answer('SEED_SUMMARY', SPAWN);
        const [nearest] = ofKind('NEAREST_STRUCTURES');
        expect(nearest.data).toEqual({
            mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, x: -32, z: 80, types: OVERWORLD_TYPES, maxRadiusBlocks: 4096,
        });
        expect(nearest.opts.priority).toBe('low');
        expect(typeof nearest.data.seed).toBe('string');
        await answer('NEAREST_STRUCTURES', { results: OVERWORLD_RESULTS });
        expect(screen.queryByRole('status')).toBeNull();
        expect(ofKind('NEAREST_STRUCTURES')).toHaveLength(1);
    });

    it('lists the 5 nearest on one line each, and the rest behind "Show 9 more"', async () => {
        const user = userEvent.setup();
        await loaded();
        expect(rows().map(nameOf)).toEqual(NEAREST_FIRST.slice(0, 5));
        await user.click(screen.getByRole('button', { name: 'Show 9 more' }));
        expect(rows().map(nameOf)).toEqual(NEAREST_FIRST);
        expect(rowOf('Trail Ruin')).toBeUndefined();                    // found -1: dropped
        expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');

        const village = rowOf('Village');
        expect(within(village).getByText('182 blocks')).toBeInTheDocument();
        expect(within(rowOf('Abandoned Camp')).getByText('4.2k blocks')).toBeInTheDocument();
        // The icon is decorative: the name is the text next to it.
        const icon = village.querySelector('img');
        expect(icon).toHaveAttribute('src', STRUCTURE_ICONS[T.Village]);
        expect(icon).toHaveAttribute('alt', '');

        // Coordinates and actions wait behind the row's toggle.
        expect(within(village).getByText('(150, 90)')).not.toBeVisible();
        const toggle = within(village).getByRole('button', { expanded: false });
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(within(village).getByText('(150, 90)')).toBeVisible();
        expect(within(village).getByRole('button', { name: 'Show on map' })).toBeVisible();
        await user.click(toggle);
        expect(within(village).getByText('(150, 90)')).not.toBeVisible();

        // Not found: a plain line, nothing to open.
        expect(within(rowOf('Mansion')).getByText('None within 4k blocks')).toBeInTheDocument();
        expect(within(rowOf('Mansion')).queryByRole('button')).toBeNull();
        expect(screen.getByText('Nearest instance to spawn within 4k blocks.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show fewer' }));
        expect(rows()).toHaveLength(5);
    });

    it('asks for variants only for the badge-carrying types it shows, and shows their badges on the line', async () => {
        const user = userEvent.setup();
        await loaded();
        const variantTypes = () => ofKind('STRUCTURE_VARIANT').map((r) => r.data.type).sort((a, b) => a - b);
        // The first 5: Ruined Portal, Village, Shipwreck, Ocean Ruin, Trial Chamber.
        expect(variantTypes()).toEqual([T.Village, T.Shipwreck, T['Ruined Portal']].sort((a, b) => a - b));
        for (const r of ofKind('STRUCTURE_VARIANT')) expect(r.opts.priority).toBe('low');
        expect(ofKind('STRUCTURE_VARIANT').find((r) => r.data.type === T.Village).data)
            .toEqual({ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, type: T.Village, x: 150, z: 90 });

        const village = () => rowOf('Village');
        expect(village().querySelector('.badge-skeleton')).not.toBeNull();
        expect(rowOf('Ocean Ruin').querySelector('.badge-skeleton')).toBeNull();   // not a variant type
        expect(rowOf('Ocean Ruin').querySelector('.badge')).toBeNull();

        await answerVariant(T.Village, { ...VARIANT, abandoned: 1, start: 2, biome: 5 });
        expect(within(village()).getByText('Zombie village')).toHaveClass('badge', 'badge--danger');
        expect(within(village()).getByText('Taiga village')).toHaveClass('badge');
        expect(within(village()).getByText('Taiga village')).not.toHaveClass('badge--muted');
        expect(village().querySelector('.badge-skeleton')).toBeNull();

        await answerVariant(T['Ruined Portal'], { ...VARIANT, giant: 1, start: 1, biome: 1 });
        expect(within(rowOf('Ruined Portal')).getByText('Giant')).toBeInTheDocument();
        await answerVariant(T.Shipwreck, { ...VARIANT, start: 3, biome: 0 });
        expect(rowOf('Shipwreck').querySelector('.badge')).toBeNull();      // an ocean wreck: no badge

        // The igloo's variant is asked for once its row is shown.
        await user.click(screen.getByRole('button', { name: 'Show 9 more' }));
        expect(variantTypes()).toContain(T.Igloo);
        await answerVariant(T.Igloo, { ...VARIANT, basement: 1 });
        expect(within(rowOf('Igloo')).getByText('With basement')).toBeInTheDocument();
        expect(ofKind('STRUCTURE_VARIANT')).toHaveLength(4);
    });

    it('in the Nether lists Fortress, Bastion and Ruined Portal around the origin, with bastion types', async () => {
        renderStructures({ dimension: -1 });
        expect(ofKind('SEED_SUMMARY')).toHaveLength(0);                   // no spawn to wait for
        await answer('GET_VERSION_SUPPORT', SUPPORT_26_3);
        expect(ofKind('NEAREST_STRUCTURES')[0].data).toEqual({
            mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: -1, x: 0, z: 0, types: [T['Ruined Portal'], T.Fortress, T.Bastion], maxRadiusBlocks: 4096,
        });
        await answer('NEAREST_STRUCTURES', { results: [
            { type: T['Ruined Portal'], found: 1, x: 90, z: -60 },
            { type: T.Fortress, found: 1, x: -200, z: 300 },
            { type: T.Bastion, found: 1, x: 400, z: 20 },
        ] });
        expect(rows().map(nameOf)).toEqual(['Ruined Portal', 'Fortress', 'Bastion']);
        expect(ofKind('STRUCTURE_VARIANT').map((r) => r.data.type).sort((a, b) => a - b)).toEqual([T['Ruined Portal'], T.Bastion].sort((a, b) => a - b));
        await answerVariant(T.Bastion, { ...VARIANT, start: 1 });
        expect(within(rowOf('Bastion')).getByText('Hoglin stables')).toBeInTheDocument();
        await answerVariant(T['Ruined Portal'], { ...VARIANT, start: 5, biome: 8 });
        expect(within(rowOf('Ruined Portal')).getByText('Nether portal')).toBeInTheDocument();
        expect(screen.getByText('Nearest instance to the origin within 4k blocks.')).toBeInTheDocument();
    });

    it('leaves Ruined Portal out of the Nether when the version has none', async () => {
        renderStructures({ dimension: -1, mcVersion: VERSIONS['1.8'], versionLabel: '1.8' });
        await answer('GET_VERSION_SUPPORT', SUPPORT_1_8);
        expect(ofKind('NEAREST_STRUCTURES')[0].data.types).toEqual([T.Fortress]);
    });

    it('in the End shows the End city\'s ship even though getVariant has no data for it', async () => {
        renderStructures({ dimension: 1 });
        await answer('GET_VERSION_SUPPORT', SUPPORT_26_3);
        expect(ofKind('NEAREST_STRUCTURES')[0].data.types).toEqual([T['End City'], T['End Gateway']]);
        await answer('NEAREST_STRUCTURES', { results: [
            { type: T['End City'], found: 1, x: 64, z: 1024 },
            { type: T['End Gateway'], found: 0, x: 0, z: 0 },
        ] });
        expect(rows().map(nameOf)).toEqual(['End City', 'End Gateway']);
        expect(ofKind('STRUCTURE_VARIANT').map((r) => r.data)).toEqual([
            { mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 1, type: T['End City'], x: 64, z: 1024 },
        ]);
        await answerVariant(T['End City'], { ...VARIANT, supported: 0, endShip: 1 });
        expect(within(rowOf('End City')).getByText('Has ship (elytra)')).toBeInTheDocument();
        expect(within(rowOf('End Gateway')).getByText('None within 1k blocks')).toBeInTheDocument();
        expect(screen.getByText('Nearest instance to the origin within 4k blocks; End Gateways are searched within 1k.')).toBeInTheDocument();
    });

    it('says so when the version has no structures in this dimension', async () => {
        renderStructures({ dimension: 1, mcVersion: VERSIONS['1.8'], versionLabel: '1.8' });
        await answer('GET_VERSION_SUPPORT', SUPPORT_1_8);
        expect(screen.getByText('No structures exist for 1.8 in the End.')).toBeInTheDocument();
        expect(screen.queryByRole('list')).toBeNull();
        expect(ofKind('NEAREST_STRUCTURES')).toHaveLength(0);
    });

    it('"Show on map" pans to the structure, highlights it by name and closes the sheet', async () => {
        const user = userEvent.setup();
        const { mapApi, sheetApi } = await loaded();
        await openRow(user, 'Village');
        await user.click(within(rowOf('Village')).getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(150, 90);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: 150, z: 90, label: 'Village' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('"Show all" adds the type to the structures on the map', async () => {
        const user = userEvent.setup();
        const { setStructuresToShow } = await loaded({}, { structuresToShow: [T.Monument] });
        await openRow(user, 'Village');
        expect(within(rowOf('Village')).getByRole('button', { name: 'Show all' })).toBeInTheDocument();
        await user.click(within(rowOf('Village')).getByRole('button', { name: 'Show all' }));
        expect(setStructuresToShow).toHaveBeenCalledWith([T.Monument, T.Village]);
    });

    it('"Hide all" removes a type that is on show', async () => {
        const user = userEvent.setup();
        const { setStructuresToShow } = await loaded({}, { structuresToShow: [T.Village, T.Monument] });
        await openRow(user, 'Village');
        await user.click(within(rowOf('Village')).getByRole('button', { name: 'Hide all' }));
        expect(setStructuresToShow).toHaveBeenCalledWith([T.Monument]);
        await openRow(user, 'Ruined Portal');
        expect(within(rowOf('Ruined Portal')).getByRole('button', { name: 'Show all' })).toBeInTheDocument();
    });

    it('Copy puts "x, z" on the clipboard', async () => {
        await loaded();
        fireEvent.click(within(rowOf('Village')).getByRole('button', { expanded: false }));
        // fireEvent, not userEvent: userEvent.setup() swaps in a clipboard of its own.
        await act(async () => { fireEvent.click(within(rowOf('Village')).getByRole('button', { name: 'Copy' })); });
        expect(writeText).toHaveBeenCalledWith('150, 90');
    });

    it('renders an engine error', async () => {
        renderStructures();
        await answer('GET_VERSION_SUPPORT', SUPPORT_26_3);
        await answer('SEED_SUMMARY', SPAWN);
        await answer('NEAREST_STRUCTURES', { error: { code: -1, message: 'unsupported version' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: unsupported version');
    });

    it('a new seed shows nothing of the previous one and asks again', async () => {
        const { rerender } = await loaded();
        await answerVariant(T.Village, { ...VARIANT, abandoned: 1, start: 0, biome: 1 });
        expect(screen.getByText('Zombie village')).toBeInTheDocument();
        rerender({ seed: '42' });
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.queryByText('Zombie village')).toBeNull();
        expect(screen.getByRole('status')).toBeInTheDocument();
        await answer('SEED_SUMMARY', { ...SPAWN, spawnX: 8, spawnZ: 8 });
        const last = ofKind('NEAREST_STRUCTURES').at(-1);
        expect(last.data).toMatchObject({ seed: '42', x: 8, z: 8 });
        expect(ofKind('GET_VERSION_SUPPORT')).toHaveLength(1);             // same version: cached
        await answer('NEAREST_STRUCTURES', { results: [{ type: T.Village, found: 1, x: 100, z: 100 }] });
        expect(rows().map(nameOf)).toEqual(['Village']);
        expect(ofKind('STRUCTURE_VARIANT').at(-1).data).toMatchObject({ seed: '42', x: 100, z: 100 });
        expect(within(rowOf('Village')).queryByText('Zombie village')).toBeNull();
    });
});
