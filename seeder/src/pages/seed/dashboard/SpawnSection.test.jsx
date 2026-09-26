// The Spawn section's body inside a DashboardProvider, over the recording FakeQueueManager:
// the test answers SEED_SUMMARY itself with resolveRequest.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpawnSection from './SpawnSection';
import { DashboardProvider } from './DashboardContext';
import { VERSIONS } from '../../../util/constants';
import { FakeQueueManager, FAKE_COLORS } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';
import { buildSeedUrl } from '../../../shared/seedUrl';
import { shadowSeed } from '../../../shared/format';
import { HELP } from '../../../shared/help';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };
const PLAINS = 1;
// The documented spawn of the vector seed on 26.3; biome and height are made up.
const SUMMARY = { spawnX: -32, spawnZ: 80, spawnBiome: PLAINS, approxHeight: 71 };

const qm = () => FakeQueueManager.latest();
const answer = (result, kind = 'SEED_SUMMARY') => act(async () => { qm().resolveRequest(kind, result); });

function renderSpawn(world = {}, { phone = true } = {}) {
    const mapApi = { current: { panTo: vi.fn(), setHighlight: vi.fn() } };
    const sheetApi = { current: phone ? { open: vi.fn(), close: vi.fn(), getSnap: () => 'full' } : null };
    const value = {
        world: { ...WORLD, ...world }, mapApi, sheetApi, structuresToShow: [], setStructuresToShow: vi.fn(),
        worlds: { worlds: [] }, showSection: vi.fn(),
    };
    render(<DashboardProvider value={value}><SpawnSection /></DashboardProvider>);
    return { mapApi, sheetApi };
}
// The value cell of a label / value row.
const valueOf = (label) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

let writeText;
beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('SpawnSection', () => {
    it('asks SEED_SUMMARY for the world on screen, at low priority, and shows a loading state meanwhile', () => {
        renderSpawn({ yHeight: 62 });
        const [request] = qm().requests;
        expect(qm().requests).toHaveLength(1);
        expect(request.kind).toBe('SEED_SUMMARY');
        expect(request.data).toEqual({ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, yHeight: 62 });
        expect(typeof request.data.seed).toBe('string');
        expect(request.opts.priority).toBe('low');
        expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    });

    it('shows the spawn, the biome there with its map colour, and the estimated surface', async () => {
        renderSpawn();
        await answer(SUMMARY);
        expect(screen.queryByRole('status')).toBeNull();
        expect(within(valueOf('Spawn')).getByText('(-32, 80)')).toBeInTheDocument();
        const biome = valueOf('Biome');
        expect(biome).toHaveTextContent('Plains');
        const [r, g, b] = FAKE_COLORS[PLAINS];
        expect(biome.querySelector('[aria-hidden="true"]')).toHaveStyle({ backgroundColor: `rgb(${r}, ${g}, ${b})` });
        expect(valueOf('Surface')).toHaveTextContent('≈ Y 71');
    });

    it('hides the surface row when the engine has no height (before 1.18)', async () => {
        renderSpawn({ mcVersion: VERSIONS['1.17'], versionLabel: '1.17' });
        await answer({ ...SUMMARY, approxHeight: null });
        expect(screen.getByText('Spawn', { selector: 'dt' })).toBeInTheDocument();
        expect(screen.queryByText('Surface')).toBeNull();
    });

    it('Copy puts "x, z" on the clipboard', async () => {
        renderSpawn();
        await answer(SUMMARY);
        // fireEvent, not userEvent: userEvent.setup() swaps in a clipboard of its own.
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
        expect(writeText).toHaveBeenCalledWith('-32, 80');
        expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
    });

    it('"Show on map" pans to the spawn, highlights it and closes the sheet on a phone', async () => {
        const user = userEvent.setup();
        const { mapApi, sheetApi } = renderSpawn();
        await answer(SUMMARY);
        await user.click(screen.getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledWith(-32, 80);
        expect(mapApi.current.setHighlight).toHaveBeenCalledWith({ x: -32, z: 80, label: 'Spawn' });
        expect(sheetApi.current.close).toHaveBeenCalledTimes(1);
    });

    it('"Show on map" works on the desktop, where there is no sheet', async () => {
        const user = userEvent.setup();
        const { mapApi } = renderSpawn({}, { phone: false });
        await answer(SUMMARY);
        await user.click(screen.getByRole('button', { name: 'Show on map' }));
        expect(mapApi.current.panTo).toHaveBeenCalledTimes(1);
        expect(mapApi.current.setHighlight).toHaveBeenCalledTimes(1);
    });

    it('in the Nether says there is no spawn, keeps the biome at the origin and offers no "Show on map"', async () => {
        renderSpawn({ dimension: -1 });
        expect(qm().requests[0].data.dimension).toBe(-1);
        await answer({ spawnX: 0, spawnZ: 0, spawnBiome: 8, approxHeight: null });
        expect(screen.getByText('No spawn in this dimension. The dashboard is centred on (0, 0).')).toBeInTheDocument();
        expect(valueOf('Biome')).toHaveTextContent('Nether Wastes');
        expect(screen.queryByText('Spawn', { selector: 'dt' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull();
        expect(screen.queryByText(/Shadow seed/)).toBeNull();
    });

    it('renders an engine error', async () => {
        renderSpawn();
        await answer({ error: { code: -1, message: 'unsupported version' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: unsupported version');
    });

    describe('shadow seed (Overworld, Beta 1.8 - 1.17)', () => {
        const shadowLink = () => screen.queryByRole('link', { name: shadowSeed(WORLD.seed) });

        it('links the shadow seed on 1.13 - 1.17 and says the biomes match except the ocean temperatures', async () => {
            renderSpawn({ mcVersion: VERSIONS['1.17'], versionLabel: '1.17' });
            await answer({ ...SUMMARY, approxHeight: null });
            expect(shadowLink()).toHaveAttribute('href', buildSeedUrl({ seed: shadowSeed(WORLD.seed), mcVersion: VERSIONS['1.17'], dimension: 0 }));
            expect(shadowLink()).toHaveAttribute('href', '/seed/?seed=2975083465687319084&version=1.17');
            expect(shadowLink().closest('p')).toHaveTextContent(
                'Shadow seed: 2975083465687319084. It has the same biome layout as this seed, except for ocean temperatures.');
        });

        it('explains the shadow with a "?" that opens a tip', async () => {
            renderSpawn({ mcVersion: VERSIONS['1.16.5'], versionLabel: '1.16.5' });
            await answer({ ...SUMMARY, approxHeight: null });
            fireEvent.click(screen.getByRole('button', { name: HELP.shadow.label }));
            expect(screen.getByRole('dialog', { name: HELP.shadow.label })).toHaveTextContent(HELP.shadow.text);
        });

        it('says the biome layout is the same up to 1.12', async () => {
            renderSpawn({ mcVersion: VERSIONS['1.12'], versionLabel: '1.12' });
            await answer({ ...SUMMARY, approxHeight: null });
            expect(shadowLink().closest('p')).toHaveTextContent(/\. It has the same biome layout as this seed\.$/);
        });

        it('is absent from 1.18, where the biomes are unrelated', async () => {
            renderSpawn({ mcVersion: VERSIONS['1.18'], versionLabel: '1.18' });
            await answer(SUMMARY);
            expect(screen.getByText('Spawn', { selector: 'dt' })).toBeInTheDocument();
            expect(shadowLink()).toBeNull();
            expect(screen.queryByText(/Shadow seed/)).toBeNull();
        });

        it('is absent on Beta 1.7 (another generator)', async () => {
            renderSpawn({ mcVersion: VERSIONS['Beta 1.7'], versionLabel: 'Beta 1.7' });
            await answer({ ...SUMMARY, approxHeight: null });
            expect(screen.queryByText(/Shadow seed/)).toBeNull();
        });
    });

    it('names nothing with "Seed": the seed box is the only such control on the page', async () => {
        renderSpawn({ mcVersion: VERSIONS['1.16.5'], versionLabel: '1.16.5' });
        await answer({ ...SUMMARY, approxHeight: null });
        expect(screen.getAllByRole('link')).toHaveLength(1);        // the shadow seed is on show
        for (const el of [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]) {
            expect(el).not.toHaveAccessibleName(/seed/i);
        }
    });
});
