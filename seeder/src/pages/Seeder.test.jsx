// The map page, as a user experiences it. The worker pool and the canvas renderer are
// replaced by recording fakes (src/test/fakes.js); everything else is real. Queries go
// through accessible names and visible text so a restructuring of the markup does not
// break them - only a change in behaviour should.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Seeder from './Seeder';
import { VERSIONS, BIOMES } from '../util/constants';
import { seedFromString, DEFAULT_VERSION } from '../util/seed';
import { FakeQueueManager, FakeDrawSeed, FAKE_COLORS } from '../test/fakes';

vi.mock('../library/queue', async () => ({ QueueManager: (await import('../test/fakes')).FakeQueueManager }));
vi.mock('../library/draw', async () => ({ DrawSeed: (await import('../test/fakes')).FakeDrawSeed }));

const qm = () => FakeQueueManager.latest();
const drawer = () => FakeDrawSeed.latest();
const flush = () => act(async () => { await Promise.resolve(); });

// Render the page at a given URL and let the first draw + spawn lookup settle.
async function renderAt(url = '/') {
    window.history.replaceState({}, '', url);
    const utils = render(<Seeder />);
    await flush();
    return utils;
}
// react-select: open the menu of the control with this accessible name and pick an option by text.
async function select(label, optionText) {
    const input = screen.getByLabelText(label);
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' });
    const option = (await screen.findAllByText(optionText)).at(-1);
    fireEvent.click(option);
    await flush();
}
const search = () => new URLSearchParams(window.location.search);

beforeEach(() => {
    FakeQueueManager.reset();
    FakeDrawSeed.reset();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
});
afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
});

describe('initial state from the URL', () => {
    it('restores seed and version from ?seed=&version= and tells the renderer', async () => {
        await renderAt('/?seed=123&version=1.21.11');
        expect(screen.getByLabelText('Seed')).toHaveValue('123');
        expect(screen.getByText('1.21.11')).toBeInTheDocument();
        expect(drawer().setSeed).toHaveBeenCalledWith('123');
        expect(drawer().setMcVersion).toHaveBeenCalledWith(VERSIONS['1.21.11']);
        expect(drawer().mcVersion).toBe(VERSIONS['1.21.11']);
    });
    it('understands legacy numeric ?version= values', async () => {
        await renderAt('/?seed=5&version=17');
        expect(screen.getByText('1.17')).toBeInTheDocument();
        expect(search().get('version')).toBe('1.17');
    });
    it('picks a random seed and the default version when the URL has none', async () => {
        await renderAt('/');
        expect(screen.getByLabelText('Seed').value).toMatch(/^-?\d+$/);
        expect(screen.getByText(DEFAULT_VERSION)).toBeInTheDocument();
        expect(search().get('version')).toBe(DEFAULT_VERSION);
    });
    it('keeps a 64-bit seed intact', async () => {
        await renderAt('/?seed=8091867987493326313&version=26.3');
        expect(screen.getByLabelText('Seed')).toHaveValue('8091867987493326313');
        expect(drawer().setSeed).toHaveBeenCalledWith('8091867987493326313');
    });
    it('hashes a non-numeric ?seed= like typed text instead of handing it to the engine', async () => {
        await renderAt('/?seed=12abc&version=26.3');
        const hashed = String(seedFromString('12abc'));
        expect(drawer().setSeed).toHaveBeenCalledWith(hashed);
        expect(screen.getByLabelText('Seed')).toHaveValue(hashed);
        expect(search().get('seed')).toBe(hashed);
    });
    it('boots one worker pool from the versioned worker path and one renderer on the canvas', async () => {
        await renderAt('/?seed=1&version=26.3');
        expect(FakeQueueManager.instances).toHaveLength(1);
        expect(qm().path).toMatch(/^\/workers\/worker\.js\?v=\d+\.\d+\.\d+$/);
        expect(FakeDrawSeed.instances).toHaveLength(1);
        expect(drawer().canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(drawer().queue).toBe(qm());
        expect(drawer().drawDim).toBe(75);
        expect(drawer().pixDim).toBe(1);
    });
});

describe('share URL', () => {
    it('is pushed to the address bar and mirrored in the share box, and COPY copies it', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=123&version=1.21.11');
        expect(search().get('seed')).toBe('123');
        expect(screen.getByLabelText('Share URL')).toHaveValue(window.location.href);
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(await navigator.clipboard.readText()).toBe(window.location.href);   // user-event's clipboard stub
        expect(screen.getByRole('button', { name: 'COPIED!' })).toBeInTheDocument();
    });
    it('follows seed and version changes and resets the copy button', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=123&version=1.21.11');
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), '456{Enter}');
        await flush();
        expect(search().get('seed')).toBe('456');
        expect(screen.getByRole('button', { name: 'COPY' })).toBeInTheDocument();
        await select('Minecraft version', '1.18');
        expect(search().get('version')).toBe('1.18');
        expect(search().get('seed')).toBe('456');
    });
});

describe('choosing a seed', () => {
    it('GO applies a numeric seed', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), '456');
        await user.click(screen.getByRole('button', { name: 'GO' }));
        await flush();
        expect(drawer().setSeed).toHaveBeenLastCalledWith('456');
        expect(drawer().clear).toHaveBeenCalled();
    });
    it('Enter applies a text seed hashed like Minecraft does (the input keeps the text)', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), 'hello{Enter}');
        await flush();
        expect(drawer().setSeed).toHaveBeenLastCalledWith(String(seedFromString('hello')));
        expect(screen.getByLabelText('Seed')).toHaveValue('hello');
        expect(search().get('seed')).toBe('99162322');
    });
    it('re-entering the current seed does not redraw', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=777&version=26.3');
        const before = drawer().callsOf('setSeed').length;
        await user.click(screen.getByRole('button', { name: 'GO' }));
        await flush();
        expect(drawer().callsOf('setSeed')).toHaveLength(before);
    });
    it('Random seed picks a new numeric seed', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=777&version=26.3');
        await user.click(screen.getByRole('button', { name: 'Random seed' }));
        await flush();
        const seed = screen.getByLabelText('Seed').value;
        expect(seed).toMatch(/^-?\d+$/);
        expect(seed).not.toBe('777');
        expect(drawer().setSeed).toHaveBeenLastCalledWith(seed);
    });
    it('after a seed change the map is cleared, redrawn, and spawn + strongholds are looked up', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        drawer().calls.length = 0;
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), '2{Enter}');
        await flush();
        const names = drawer().calls.map((c) => c.name);
        expect(names.indexOf('clear')).toBeLessThan(names.indexOf('draw'));
        expect(names).toContain('findSpawn');
        expect(names).toContain('findStrongholds');
        expect(drawer().setSeed).toHaveBeenLastCalledWith('2');
    });
    it('disables Random seed until the spawn of the current seed is known', async () => {
        FakeDrawSeed.autoResolve = false;
        await renderAt('/?seed=1&version=26.3');
        expect(screen.getByRole('button', { name: 'Random seed' })).toBeDisabled();
        act(() => drawer().resolveSpawn());
        expect(screen.getByRole('button', { name: 'Random seed' })).toBeEnabled();
    });
});

describe('version, dimension and height', () => {
    it('changing the version re-renders with the new version', async () => {
        await renderAt('/?seed=1&version=26.3');
        await select('Minecraft version', '1.16.5');
        expect(drawer().setMcVersion).toHaveBeenLastCalledWith(VERSIONS['1.16.5']);
        expect(screen.getByText('1.16.5')).toBeInTheDocument();
    });
    it('offers the biome height only for versions after 1.18 (3D biomes)', async () => {
        await renderAt('/?seed=1&version=26.3');
        expect(screen.getByLabelText('Biome height')).toBeInTheDocument();
        await select('Minecraft version', '1.16.5');
        expect(screen.queryByLabelText('Biome height')).toBeNull();
        await select('Minecraft version', '1.18');
        expect(screen.queryByLabelText('Biome height')).toBeNull();
        await select('Minecraft version', '1.19.2');
        expect(screen.getByLabelText('Biome height')).toBeInTheDocument();
    });
    it('changing the dimension re-renders in that dimension', async () => {
        await renderAt('/?seed=1&version=26.3');
        await select('Dimension', 'Nether');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(-1);
        await select('Dimension', 'End');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(1);
    });
    it('changing the biome height re-renders after a short debounce', async () => {
        await renderAt('/?seed=1&version=26.3');
        expect(drawer().setYHeight).toHaveBeenLastCalledWith(256);
        await select('Biome height', 'Sea level (Y=62)');
        expect(screen.getByText('Sea level (Y=62)')).toBeInTheDocument();
        expect(drawer().setYHeight).toHaveBeenLastCalledWith(256);              // not yet: debounced
        await waitFor(() => expect(drawer().setYHeight).toHaveBeenLastCalledWith(62), { timeout: 2000 });
    });
});

describe('map controls', () => {
    it('zoom buttons and arrow buttons drive the renderer', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await user.click(screen.getByRole('button', { name: 'Zoom +' }));
        await user.click(screen.getByRole('button', { name: 'Zoom -' }));
        expect(drawer().zoom).toHaveBeenCalledTimes(1);
        expect(drawer().dezoom).toHaveBeenCalledTimes(1);
        await user.click(screen.getByAltText('arrow left'));
        await user.click(screen.getByAltText('arrow right'));
        await user.click(screen.getByAltText('arrow down'));
        expect(drawer().left).toHaveBeenCalledTimes(1);
        expect(drawer().right).toHaveBeenCalledTimes(1);
        expect(drawer().down).toHaveBeenCalledTimes(1);
    });
    it('arrow keys pan the map', async () => {
        await renderAt('/?seed=1&version=26.3');
        fireEvent.keyDown(document, { key: 'ArrowUp' });
        await waitFor(() => expect(drawer().up).toHaveBeenCalledTimes(1));
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        await waitFor(() => expect(drawer().left).toHaveBeenCalledTimes(1));
        fireEvent.keyDown(document, { key: 'Enter' });
        await new Promise((r) => setTimeout(r, 10));
        expect(drawer().calls.filter((c) => ['up', 'down', 'left', 'right'].includes(c.name))).toHaveLength(2);
    });
    it('shows the coordinates and biome under the pointer', async () => {
        await renderAt('/?seed=1&version=26.3');
        expect(screen.getByText((_, el) => el.textContent === 'X: 0, Z: 0')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
        act(() => drawer().emitHover(64, -128, 'Cherry Grove'));
        expect(screen.getByText((_, el) => el.textContent === 'X: 64, Z: -128')).toBeInTheDocument();
        expect(screen.getByText('Cherry Grove')).toBeInTheDocument();
    });
    it('the legend lists every biome with its colour and can be closed', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        expect(screen.queryByText('Mushroom Fields')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Show legend' }));
        for (const { label } of BIOMES) expect(screen.getByText(label)).toBeInTheDocument();
        const swatch = screen.getByText('Plains').previousSibling;
        expect(swatch).toHaveStyle({ backgroundColor: `rgba(${FAKE_COLORS[1].join(', ')})` });
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByText('Mushroom Fields')).toBeNull();
        expect(screen.getByRole('button', { name: 'Show legend' })).toBeInTheDocument();
    });
    it('the mobile menu toggle expands and collapses the side panel', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        const toggle = screen.getByRole('button', { name: 'seed menu toggle' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('options', () => {
    it('toggling structure coordinates is passed to the renderer', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        expect(drawer().setShowStructureCoords).toHaveBeenLastCalledWith(true);
        await user.click(screen.getByLabelText('Show structures coords'));
        await flush();
        expect(drawer().setShowStructureCoords).toHaveBeenLastCalledWith(false);
    });
    it('choosing structures to show looks them up and draws them', async () => {
        await renderAt('/?seed=1&version=26.3');
        await select('Structures to show', 'Mansion');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([9]);
        expect(drawer().findStructure).toHaveBeenCalledWith(9, expect.any(Function));
        await select('Structures to show', 'Village');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([9, 5]);
    });
    it('the Options and Seed finder sections collapse and expand', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await user.click(screen.getByRole('heading', { name: 'Options' }));
        expect(screen.queryByLabelText('Show structures coords')).toBeNull();
        await user.click(screen.getByRole('heading', { name: 'Options' }));
        expect(screen.getByLabelText('Show structures coords')).toBeInTheDocument();
        await user.click(screen.getByRole('heading', { name: /Seed finder/ }));
        expect(screen.queryByRole('button', { name: 'Find' })).toBeNull();
    });
});

describe('seed finder', () => {
    const MC = VERSIONS['26.3'];

    it('needs a range and at least a biome or a structure', async () => {
        await renderAt('/?seed=1&version=26.3');
        const find = () => screen.getByRole('button', { name: 'Find' });
        expect(find()).toBeDisabled();
        await select('Biomes to find', 'Plains');
        expect(find()).toBeDisabled();
        await select('Range', '<100 blocks');
        expect(find()).toBeEnabled();
    });

    it('searches biomes in a box of ±range cells around the origin, from seed 1, with the current dimension and height', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await select('Biomes to find', 'Cherry Grove');
        await select('Range', '<100 blocks');
        await user.click(screen.getByRole('button', { name: 'Find' }));
        expect(qm().findBiomes).toHaveBeenCalledTimes(1);
        expect(qm().lastSearch().args.slice(0, -1)).toEqual([MC, [1, 185], -25, -25, 50, 50, 1, 0, 256, 9999]);
        expect(screen.getByText('Finding seed...')).toBeInTheDocument();
    });

    it('searches a structure alone with the range in cells (see plans/00-shared.md on the block/cell mix-up)', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Structure to find', 'Village');
        await select('Range', '<300 blocks');
        await user.click(screen.getByRole('button', { name: 'Find' }));
        expect(qm().findStructures).toHaveBeenCalledTimes(1);
        expect(qm().lastSearch().args.slice(0, -1)).toEqual([MC, 5, -75, -75, 150, 1, 0, 9999]);
    });

    it('searches biomes and a structure together', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await select('Structure to find', 'Village');
        await select('Range', '<500 blocks');
        await select('Dimension', 'Nether');
        await user.click(screen.getByRole('button', { name: 'Find' }));
        expect(qm().findBiomesWithStructures).toHaveBeenCalledTimes(1);
        expect(qm().lastSearch().args.slice(0, -1)).toEqual([MC, 5, [1], -125, -125, 250, 1, -1, 256, 9999]);
    });

    it('selecting a structure to find also shows it on the map', async () => {
        await renderAt('/?seed=1&version=26.3');
        await select('Structure to find', 'Village');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([5]);
        expect(screen.getAllByText('Village')).toHaveLength(2);
    });

    it('shows progress while searching and STOP restarts the pool', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await select('Range', '<100 blocks');
        await user.click(screen.getByRole('button', { name: 'Find' }));
        expect(screen.getByText('Calculating speed...')).toBeInTheDocument();
        act(() => qm().tickProgress(3));
        expect(screen.getByText(/\d+ seed\/s/)).toBeInTheDocument();
        expect(screen.getByText(/You have been searching for/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'STOP' }));
        expect(qm().restartAll).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Finding seed...')).toBeNull();
    });

    it('applies a found seed, offers "Find another" and resumes right after it', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await select('Range', '<100 blocks');
        await user.click(screen.getByRole('button', { name: 'Find' }));
        await act(async () => { qm().resolveLastSearch(4242n); });
        await flush();
        expect(screen.queryByText('Finding seed...')).toBeNull();
        expect(screen.getByLabelText('Seed')).toHaveValue('4242');
        expect(drawer().setSeed).toHaveBeenLastCalledWith('4242');
        expect(search().get('seed')).toBe('4242');
        await user.click(screen.getByRole('button', { name: 'Find another' }));
        expect(qm().lastSearch().args[6]).toBe(4243);
    });

    it('changing the criteria restarts the search cursor from the beginning', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await select('Range', '<100 blocks');
        await user.click(screen.getByRole('button', { name: 'Find' }));
        await act(async () => { qm().resolveLastSearch(4242n); });
        await flush();
        expect(screen.getByRole('button', { name: 'Find another' })).toBeInTheDocument();
        await select('Range', '<300 blocks');
        expect(screen.getByRole('button', { name: 'Find' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Find' }));
        expect(qm().lastSearch().args[6]).toBe(1);
    });

    it('advanced mode exposes the starting seed, a free block range and the biome height', async () => {
        const user = userEvent.setup();
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await user.click(screen.getByLabelText('Advanced mode'));
        expect(screen.queryByLabelText('Range')).toBeNull();
        await user.clear(screen.getByLabelText('Starting seed'));
        await user.type(screen.getByLabelText('Starting seed'), '500');
        await user.clear(screen.getByLabelText('Range in blocks'));
        await user.type(screen.getByLabelText('Range in blocks'), '400');
        await user.clear(screen.getByLabelText('Biome height in blocks'));
        await user.type(screen.getByLabelText('Biome height in blocks'), '62');
        await user.click(screen.getByRole('button', { name: 'Find another' }));
        expect(qm().lastSearch().args.slice(0, -1)).toEqual([MC, [1], -100, -100, 200, 200, 501, 0, 62, 9999]);
    });

    it('shows the elapsed time while searching', async () => {
        await renderAt('/?seed=1&version=26.3');
        await select('Biomes to find', 'Plains');
        await select('Range', '<100 blocks');
        vi.useFakeTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Find' }));
        expect(screen.getByText(/searching for 0s/)).toBeInTheDocument();
        await act(() => vi.advanceTimersByTimeAsync(61_500));
        expect(screen.getByText(/searching for 1m 1s/)).toBeInTheDocument();
    });
});
