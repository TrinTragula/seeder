// The seed page, as a user experiences it. The worker pool and the canvas renderer are
// replaced by recording fakes (src/test/fakes.js); everything else is real. Queries go
// through accessible names and visible text so a restructuring of the markup does not
// break them - only a change in behaviour should.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedPage from './SeedPage';
import { VERSIONS, BIOMES, STRUCTURES_OPTIONS } from '../../util/constants';
import { seedFromString, DEFAULT_VERSION } from '../../util/seed';
import { FakeQueueManager, FakeDrawSeed, FakeMatchMedia, FAKE_COLORS } from '../../test/fakes';
import { resetQueueManagerForTests } from '../../shared/engine';
import { clearSeedQueryCache } from '../../shared/hooks/useSeedQuery';
import { loadLastSeed } from '../../shared/worlds';
import { DEFAULT_HEIGHT } from './dashboard/ControlsBlock';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));
vi.mock('../../library/draw', async () => ({ DrawSeed: (await import('../../test/fakes')).FakeDrawSeed }));

const qm = () => FakeQueueManager.latest();
const drawer = () => FakeDrawSeed.latest();
const flush = () => act(async () => { await Promise.resolve(); });

// Render the page at a given URL and let the first draw + spawn lookup settle.
async function renderAt(url = '/seed/') {
    window.history.replaceState({}, '', url);
    const utils = render(<SeedPage />);
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
// The option texts of the open menu of the react-select with this accessible name.
function optionsOf(label) {
    fireEvent.keyDown(screen.getByLabelText(label), { key: 'ArrowDown', code: 'ArrowDown' });
    return screen.getAllByRole('option').map((o) => o.textContent);
}

// Answer every pending GET_VERSION_SUPPORT the way the engine does on 26.3: Nether and
// End biomes and structures in their own dimensions, `lacks` (biome ids) absent.
const NETHER_BIOMES = [8, 170, 171, 172, 173];
const END_BIOMES = [9, 40, 41, 42, 43];
const STRUCTURE_DIMS = { 18: -1, 19: -1, 21: 1, 22: 1 };
async function answerSupport({ lacks = [] } = {}) {
    await act(async () => {
        for (const entry of qm().pendingOf('GET_VERSION_SUPPORT')) {
            const { mcVersion, biomeIds, structTypes } = entry.data;
            const biomeDim = (id) => (NETHER_BIOMES.includes(id) ? -1 : END_BIOMES.includes(id) ? 1 : 0);
            entry.resolve({
                error: null, mcVersion, newest: mcVersion,
                biomes: biomeIds.filter((id) => !lacks.includes(id)),
                biomeDimensions: Object.fromEntries(biomeIds.map((id) => [id, biomeDim(id)])),
                structures: Object.fromEntries(structTypes.map((t) => [t, STRUCTURE_DIMS[t] ?? 0])),
                regionBlocks: Object.fromEntries(structTypes.map((t) => [t, 512])),
                minDistance: Object.fromEntries(structTypes.map((t) => [t, 0])),
            });
        }
    });
}
const T = Object.fromEntries(STRUCTURES_OPTIONS.map((o) => [o.pureText, o.value]));

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    FakeDrawSeed.reset();
    clearSeedQueryCache();                      // every test answers its own version probe
    window.localStorage.clear();                // the what's-new flag and the last seed live here
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
    // jsdom lays nothing out; the map measures its container, so give divs a size.
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
});
afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
    delete HTMLDivElement.prototype.clientWidth;
    delete HTMLDivElement.prototype.clientHeight;
    delete window.__seederDrawer;
});

describe('initial state from the URL', () => {
    it('restores seed and version from ?seed=&version= and tells the renderer', async () => {
        await renderAt('/seed/?seed=123&version=1.21.11');
        expect(screen.getByLabelText('Seed')).toHaveValue('123');
        expect(screen.getByText('1.21.11')).toBeInTheDocument();
        expect(drawer().setSeed).toHaveBeenCalledWith('123');
        expect(drawer().setMcVersion).toHaveBeenCalledWith(VERSIONS['1.21.11']);
        expect(drawer().mcVersion).toBe(VERSIONS['1.21.11']);
    });
    it('understands legacy numeric ?version= values', async () => {
        await renderAt('/seed/?seed=5&version=17');
        expect(screen.getByText('1.17')).toBeInTheDocument();
        expect(search().get('version')).toBe('1.17');
    });
    it('picks a random seed and the default version when the URL has none', async () => {
        await renderAt('/seed/');
        expect(screen.getByLabelText('Seed').value).toMatch(/^-?\d+$/);
        expect(screen.getByText(DEFAULT_VERSION)).toBeInTheDocument();
        expect(search().get('version')).toBe(DEFAULT_VERSION);
    });
    it('keeps a 64-bit seed intact', async () => {
        await renderAt('/seed/?seed=8091867987493326313&version=26.3');
        expect(screen.getByLabelText('Seed')).toHaveValue('8091867987493326313');
        expect(drawer().setSeed).toHaveBeenCalledWith('8091867987493326313');
    });
    it('hashes a non-numeric ?seed= like typed text instead of handing it to the engine', async () => {
        await renderAt('/seed/?seed=12abc&version=26.3');
        const hashed = String(seedFromString('12abc'));
        expect(drawer().setSeed).toHaveBeenCalledWith(hashed);
        expect(screen.getByLabelText('Seed')).toHaveValue(hashed);
        expect(search().get('seed')).toBe(hashed);
    });
    it('restores the dimension from ?dim= and renders in it', async () => {
        await renderAt('/seed/?seed=1&version=26.3&dim=-1');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(-1);
        expect(screen.getByText('Nether')).toBeInTheDocument();
        expect(search().get('dim')).toBe('-1');
        expect(drawer().dimension).toBe(-1);
    });
    it('is the Overworld for a missing or nonsensical ?dim=, which the URL then omits', async () => {
        for (const url of ['/seed/?seed=1&version=26.3', '/seed/?seed=1&version=26.3&dim=0', '/seed/?seed=1&version=26.3&dim=7']) {
            const { unmount } = await renderAt(url);
            expect(drawer().setDimension, url).toHaveBeenLastCalledWith(0);
            expect(search().has('dim'), url).toBe(false);
            unmount();
        }
    });
    it('boots one worker pool from the versioned worker path and one renderer on the canvas', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        expect(FakeQueueManager.instances).toHaveLength(1);
        expect(qm().path).toMatch(/^\/workers\/worker\.js\?v=\d+\.\d+\.\d+$/);
        expect(FakeDrawSeed.instances).toHaveLength(1);
        expect(drawer().canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(drawer().queue).toBe(qm());
        expect(drawer().drawDim).toBe(75);
        expect(drawer().pixDim).toBe(1);
        expect(drawer().canvas.width).toBe(900);
        expect(drawer().canvas.height).toBe(700);
    });
    it('exposes the main map\'s renderer for the bench and the e2e tests', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        expect(window.__seederDrawer).toBe(drawer());
    });
});

describe('share URL', () => {
    const SHARED = 'https://mcseeder.com/seed/?seed=123&version=1.21.11';

    it('is the canonical production URL, whatever host the page runs on, and COPY copies it', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=123&version=1.21.11');
        expect(search().get('seed')).toBe('123');
        expect(window.location.href).not.toBe(SHARED);                  // localhost here, mcseeder.com there
        expect(screen.getByLabelText('Share URL')).toHaveValue(SHARED);
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(await navigator.clipboard.readText()).toBe(SHARED);      // user-event's clipboard stub
        // The site-wide toast confirms it; the button keeps its label.
        expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'COPY' })).toBeInTheDocument();
    });
    it('after the seed changes, COPY copies the new URL', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=123&version=1.21.11');
        await user.click(screen.getByRole('button', { name: 'Random seed' }));
        await flush();
        const url = screen.getByLabelText('Share URL').value;
        expect(url).not.toBe(SHARED);
        await user.click(screen.getByRole('button', { name: 'COPY' }));
        expect(await navigator.clipboard.readText()).toBe(url);
    });
    it('follows seed, version and dimension changes, in both the box and the address bar', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=123&version=1.21.11');
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), '456{Enter}');
        await flush();
        expect(search().get('seed')).toBe('456');
        await select('Minecraft version', '1.18');
        expect(search().get('version')).toBe('1.18');
        expect(search().get('seed')).toBe('456');
        await select('Dimension', 'Nether');
        expect(screen.getByLabelText('Share URL')).toHaveValue('https://mcseeder.com/seed/?seed=456&version=1.18&dim=-1');
        expect(window.location.search).toBe('?seed=456&version=1.18&dim=-1');
    });
    it('replaces the address bar instead of pushing, so the back button leaves the page', async () => {
        const user = userEvent.setup();
        const push = vi.spyOn(window.history, 'pushState');
        await renderAt('/seed/?seed=123&version=1.21.11');
        await user.click(screen.getByRole('button', { name: 'Random seed' }));
        await flush();
        await select('Minecraft version', '1.18');
        expect(push).not.toHaveBeenCalled();
    });
    it('names the seed and version in the document title', async () => {
        await renderAt('/seed/?seed=123&version=1.21.11');
        expect(document.title).toBe('Seed 123 (1.21.11) - Seeder');
        await select('Minecraft version', '1.18');
        expect(document.title).toBe('Seed 123 (1.18) - Seeder');
    });
});

describe('arriving from a pre-1.0 share link', () => {
    it('shows the what\'s-new card once and drops from=legacy from the URL', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=42&version=1.17&from=legacy');
        expect(screen.getByRole('heading', { name: 'Seeder has new sections' })).toBeInTheDocument();
        expect(search().has('from')).toBe(false);
        expect(window.location.search).toBe('?seed=42&version=1.17');

        await user.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('heading', { name: 'Seeder has new sections' })).toBeNull();
    });
    it('shows nothing to everybody else', async () => {
        await renderAt('/seed/?seed=42&version=1.17');
        expect(screen.queryByRole('heading', { name: 'Seeder has new sections' })).toBeNull();
    });
    it('remembers the seed for the landing page', async () => {
        await renderAt('/seed/?seed=42&version=1.17&dim=1');
        expect(loadLastSeed()).toEqual({ seed: '42', version: '1.17', dimension: 1 });
    });
});

describe('choosing a seed', () => {
    it('GO applies a numeric seed', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), '456');
        await user.click(screen.getByRole('button', { name: 'GO' }));
        await flush();
        expect(drawer().setSeed).toHaveBeenLastCalledWith('456');
        expect(drawer().clear).toHaveBeenCalledTimes(2);
    });
    it('Enter applies a text seed hashed like Minecraft does (the input keeps the text)', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), 'hello{Enter}');
        await flush();
        expect(drawer().setSeed).toHaveBeenLastCalledWith(String(seedFromString('hello')));
        expect(screen.getByLabelText('Seed')).toHaveValue('hello');
        expect(search().get('seed')).toBe('99162322');
    });
    it('re-entering the current seed does not redraw', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=777&version=26.3');
        const before = drawer().callsOf('setSeed').length;
        await user.click(screen.getByRole('button', { name: 'GO' }));
        await flush();
        expect(drawer().callsOf('setSeed')).toHaveLength(before);
        expect(drawer().clear).toHaveBeenCalledTimes(1);
    });
    it('Random seed picks a new numeric seed', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=777&version=26.3');
        await user.click(screen.getByRole('button', { name: 'Random seed' }));
        await flush();
        const seed = screen.getByLabelText('Seed').value;
        expect(seed).toMatch(/^-?\d+$/);
        expect(seed).not.toBe('777');
        expect(drawer().setSeed).toHaveBeenLastCalledWith(seed);
        expect(search().get('seed')).toBe(seed);
    });
    it('after a seed change the map is cleared, redrawn, and spawn + strongholds are looked up', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
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
        await renderAt('/seed/?seed=1&version=26.3');
        expect(screen.getByRole('button', { name: 'Random seed' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'GO' })).toBeEnabled();
        act(() => drawer().resolveSpawn());
        expect(screen.getByRole('button', { name: 'Random seed' })).toBeEnabled();
    });
});

describe('version, dimension and height', () => {
    it('changing the version re-renders with the new version', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        await select('Minecraft version', '1.16.5');
        expect(drawer().setMcVersion).toHaveBeenLastCalledWith(VERSIONS['1.16.5']);
        expect(screen.getByText('1.16.5')).toBeInTheDocument();
        expect(search().get('version')).toBe('1.16.5');
    });
    it('offers the biome height from 1.18 on (3D biomes), and not before', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        expect(screen.getByLabelText('Biome height')).toBeInTheDocument();
        await select('Minecraft version', '1.17');
        expect(screen.queryByLabelText('Biome height')).toBeNull();
        // 1.18 is the first version with 3D biomes: its cave biomes need the height too.
        await select('Minecraft version', '1.18');
        expect(screen.getByLabelText('Biome height')).toBeInTheDocument();
        await select('Minecraft version', '1.16.5');
        expect(screen.queryByLabelText('Biome height')).toBeNull();
    });
    it('changing the dimension re-renders in that dimension and publishes it', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        await select('Dimension', 'Nether');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(-1);
        expect(search().get('dim')).toBe('-1');
        await select('Dimension', 'End');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(1);
        expect(search().get('dim')).toBe('1');
    });
    it('changing the biome height re-renders at once, without clearing the map', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        expect(drawer().setYHeight).toHaveBeenLastCalledWith(256);
        const clears = drawer().clear.mock.calls.length;
        await select('Biome height', 'Sea level (Y=62)');
        expect(screen.getByText('Sea level (Y=62)')).toBeInTheDocument();
        expect(drawer().setYHeight).toHaveBeenLastCalledWith(62);
        expect(drawer().clear).toHaveBeenCalledTimes(clears);
    });
});

describe('map controls', () => {
    it('zoom buttons and arrow buttons drive the renderer', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await user.click(screen.getByRole('button', { name: 'Zoom +' }));
        await user.click(screen.getByRole('button', { name: 'Zoom -' }));
        expect(drawer().zoom).toHaveBeenCalledTimes(1);
        expect(drawer().dezoom).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', { name: 'Pan left' }));
        await user.click(screen.getByRole('button', { name: 'Pan right' }));
        await user.click(screen.getByRole('button', { name: 'Pan down' }));
        expect(drawer().left).toHaveBeenCalledTimes(1);
        expect(drawer().right).toHaveBeenCalledTimes(1);
        expect(drawer().down).toHaveBeenCalledTimes(1);
    });
    it('arrow keys pan the map, but never while typing in the seed box', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        fireEvent.keyDown(document.body, { key: 'ArrowUp' });
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        expect(drawer().up).toHaveBeenCalledTimes(1);
        expect(drawer().left).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(screen.getByLabelText('Seed'), { key: 'ArrowLeft' });
        fireEvent.keyDown(screen.getByLabelText('Seed'), { key: 'ArrowDown' });
        fireEvent.keyDown(document.body, { key: 'Enter' });
        expect(drawer().calls.filter((c) => ['up', 'down', 'left', 'right'].includes(c.name))).toHaveLength(2);
    });
    it('shows the biome and coordinates under the pointer, next to it', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        expect(screen.queryByText(/^X:/)).toBeNull();
        act(() => drawer().emitTip({ hover: { x: 64, z: -128, biome: 'Cherry Grove', id: 185, left: 50, top: 60 } }));
        expect(screen.getByText((_, el) => el.textContent === 'X: 64, Z: -128')).toBeInTheDocument();
        expect(screen.getByText('Cherry Grove')).toBeInTheDocument();
    });
    it('the legend lists every biome of the Overworld with its colour and can be closed from either button', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await answerSupport();
        expect(screen.queryByText('Mushroom Fields')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Show legend' }));
        for (const { value, label } of BIOMES) {
            if (NETHER_BIOMES.includes(value) || END_BIOMES.includes(value)) expect(screen.queryByText(label), label).toBeNull();
            else expect(screen.getByText(label)).toBeInTheDocument();
        }
        const swatch = screen.getByText('Plains').previousSibling;
        expect(swatch).toHaveStyle({ backgroundColor: `rgba(${FAKE_COLORS[1].join(', ')})` });
        expect(screen.getByRole('button', { name: 'Close legend' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByText('Mushroom Fields')).toBeNull();
        expect(screen.getByRole('button', { name: 'Show legend' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Show legend' }));
        await user.click(screen.getByRole('button', { name: 'Close legend' }));
        expect(screen.queryByText('Mushroom Fields')).toBeNull();
    });
});

describe('options', () => {
    it('toggling structure coordinates is passed to the renderer', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        expect(drawer().setShowStructureCoords).toHaveBeenLastCalledWith(true);
        await user.click(screen.getByLabelText('Show structure coords'));
        await flush();
        expect(drawer().setShowStructureCoords).toHaveBeenLastCalledWith(false);
    });
    it('choosing structures to show looks them up and draws them', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        await answerSupport();
        await select('Structures to show', 'Mansion');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([9]);
        expect(drawer().findStructure).toHaveBeenCalledWith(9);
        await select('Structures to show', 'Village');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([9, 5]);
        expect(drawer().findStructure).toHaveBeenCalledWith(5);
    });
});

describe('pickers follow the version and the dimension', () => {
    it('"Structures to show" offers only what generates here; the legend only this dimension\'s biomes', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3&dim=-1');
        await answerSupport();
        expect(optionsOf('Structures to show')).toEqual(['Ruined Portal', 'Fortress', 'Bastion']);
        await user.click(screen.getByRole('button', { name: 'Show legend' }));
        expect(screen.getByText('Nether Wastes')).toBeInTheDocument();
        expect(screen.queryByText('Plains')).toBeNull();
        expect(screen.queryByText('The End')).toBeNull();
    });

    it('in the End: End City and End Gateway, and the End biomes', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3&dim=1');
        await answerSupport();
        expect(optionsOf('Structures to show')).toEqual(['End City', 'End Gateway']);
        await user.click(screen.getByRole('button', { name: 'Show legend' }));
        expect(screen.getByText('The End')).toBeInTheDocument();
        expect(screen.queryByText('Nether Wastes')).toBeNull();
    });

    it('the legend leaves out a biome the version lacks', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await answerSupport({ lacks: [185] });
        await user.click(screen.getByRole('button', { name: 'Show legend' }));
        expect(screen.queryByText('Cherry Grove')).toBeNull();
        expect(screen.getByText('Plains')).toBeInTheDocument();
    });

    it('a pick that does not apply is hidden, never drawn, and back on return', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await answerSupport();
        await select('Structures to show', 'Village');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([T.Village]);

        await select('Dimension', 'Nether');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([]);
        expect(screen.queryByText('Village')).toBeNull();
        // A Nether pick joins the hidden one; clearing the picker leaves the hidden one alone.
        await select('Structures to show', 'Fortress');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([T.Fortress]);
        fireEvent.keyDown(screen.getByLabelText('Structures to show'), { key: 'Backspace', code: 'Backspace' });
        await flush();
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([]);

        drawer().findStructure.mockClear();
        await select('Dimension', 'Overworld');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([T.Village]);
        expect(drawer().findStructure).toHaveBeenCalledWith(T.Village);
        expect(drawer().findStructure).not.toHaveBeenCalledWith(T.Fortress);
        expect(screen.getByText('Village')).toBeInTheDocument();
    });

    it('the map asks for no structure until the new version\'s support is known', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        await answerSupport();
        await select('Structures to show', 'Village');
        drawer().findStructure.mockClear();
        await select('Minecraft version', '1.12');
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([]);
        expect(drawer().findStructure).not.toHaveBeenCalled();
        await answerSupport();
        expect(drawer().setStructuresShown).toHaveBeenLastCalledWith([T.Village]);
        expect(drawer().findStructure).toHaveBeenCalledWith(T.Village);
    });
});

describe('what left this page', () => {
    it('has no seed finder any more: the CTA sends people to /finder/ for the current version and dimension', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        // "Find" is on the page only as the Find near me tab, never as a seed finder.
        expect(screen.queryAllByText(/Find/).filter((el) => el.getAttribute('role') !== 'tab')).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Find' })).toBeNull();
        expect(screen.queryByLabelText('Biomes to find')).toBeNull();
        expect(screen.queryByLabelText('Structure to find')).toBeNull();
        expect(screen.queryByLabelText('Range')).toBeNull();
        expect(qm().findSeeds).not.toHaveBeenCalled();

        const cta = screen.getByRole('link', { name: 'Open the advanced finder' });
        expect(cta).toHaveAttribute('href', '/finder/?version=26.3&dim=0');
        await select('Dimension', 'Nether');
        expect(cta).toHaveAttribute('href', '/finder/?version=26.3&dim=-1');
        await select('Minecraft version', '1.18');
        expect(cta).toHaveAttribute('href', '/finder/?version=1.18&dim=-1');
    });
    it('the donate block lives in the compact footer, once', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        expect(screen.getAllByText('Buy me a coffee!')).toHaveLength(1);
        expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    });
});

describe('the dashboard panel', () => {
    it('puts the tab bar under the seed box in the desktop column: the Map tab holds the controls, then an ad; footer last', async () => {
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        const aside = container.querySelector('aside#dashboard');
        const tabs = screen.getByRole('tablist', { name: 'Dashboard' });
        expect(aside).toContainElement(tabs);
        expect(screen.getByLabelText('Seed').compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const map = screen.getByRole('tabpanel', { name: 'Map' });
        expect(map).toContainElement(screen.getByLabelText('Minecraft version'));
        expect(aside.querySelectorAll('ins.adsbygoogle')).toHaveLength(1);
        expect(aside.lastElementChild).toHaveClass('site-footer');
        // The ad follows the controls (Save this world ends them), never the seed box's GO / Random.
        const firstAd = map.querySelector('.ad');
        expect(firstAd.previousElementSibling).toContainElement(screen.getByRole('button', { name: 'Save this world' }));
        // The finder's pitch comes before the share box.
        const cta = screen.getByRole('link', { name: 'Open the advanced finder' });
        expect(cta.compareDocumentPosition(screen.getByLabelText('Share URL')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await userEvent.setup().click(screen.getByRole('tab', { name: 'Spawn & structures' }));
        expect(aside.querySelectorAll('ins.adsbygoogle')).toHaveLength(2);
    });

    it('keeps the what\'s-new card first in the desktop column', async () => {
        const { container } = await renderAt('/seed/?seed=42&version=1.17&from=legacy');
        const aside = container.querySelector('aside#dashboard');
        expect(aside.firstElementChild).toContainElement(screen.getByRole('heading', { name: 'Seeder has new sections' }));
    });

    it('Save this world in the controls stores the world on screen', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=42&version=1.17&dim=-1');
        // My worlds is mounted (showing its empty state) before the save, then the Map tab is back.
        await user.click(screen.getByRole('tab', { name: 'More' }));
        const worlds = screen.getByRole('region', { name: 'My worlds' });
        expect(within(worlds).getByText(/No saved worlds yet/)).toBeInTheDocument();
        await user.click(screen.getByRole('tab', { name: 'Map' }));

        await user.click(screen.getByRole('button', { name: 'Save this world' }));
        expect(screen.getByLabelText('World name')).toHaveValue('Seed 42');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(JSON.parse(window.localStorage.getItem('seeder.worlds.v1'))).toMatchObject([
            { name: 'Seed 42', seed: '42', version: '1.17', dimension: -1 },
        ]);
        expect(screen.getByText('Saved ✓')).toBeInTheDocument();
        // The badge's link opens My worlds, which shares the controls' store: the world is there at once.
        await user.click(screen.getByRole('link', { name: 'My worlds' }));
        expect(screen.getByRole('tab', { name: 'More' })).toHaveAttribute('aria-selected', 'true');
        expect(within(worlds).getByText('Seed 42')).toBeInTheDocument();
        expect(within(worlds).getByText('Current')).toBeInTheDocument();
        expect(within(worlds).queryByRole('button', { name: 'Save this world' })).toBeNull();
    });

    it('asks the engine only for what the opened tabs\' sections need; the placeholders ask nothing', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        // The Map tab asks only what the version has (for the structure picker and the legend).
        const pageSupport = ['GET_VERSION_SUPPORT', { mcVersion: VERSIONS['26.3'], biomeIds: BIOMES.map((b) => b.value), structTypes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 18, 19, 21, 22, 24, 25, 26] }];
        expect(qm().request.mock.calls.map(([kind, data]) => [kind, data])).toEqual([pageSupport]);
        for (const name of ['Spawn & structures', 'Biomes', 'Find near me', 'More']) {
            await user.click(screen.getByRole('tab', { name }));
        }
        const summary = { mcVersion: VERSIONS['26.3'], seed: '1', dimension: 0, yHeight: DEFAULT_HEIGHT };
        const before = [
            pageSupport,
            ['SEED_SUMMARY', summary],                                                  // Spawn
            ['SEED_SUMMARY', summary],                                                  // Strongholds (the same cached question)
            ['STRONGHOLDS_LIST', { mcVersion: VERSIONS['26.3'], seed: '1', howMany: 8 }],
            // Structures: what the version has (every offered type), then the same spawn question.
            ['GET_VERSION_SUPPORT', { mcVersion: VERSIONS['26.3'], biomeIds: [], structTypes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 18, 19, 21, 22, 24, 25, 26] }],
            ['SEED_SUMMARY', summary],
            // Biome locator (first in its tab): which biomes the version has, and the spawn. Nothing more before Find.
            ['GET_VERSION_SUPPORT', { mcVersion: VERSIONS['26.3'], biomeIds: BIOMES.map((b) => b.value), structTypes: [] }],
            ['SEED_SUMMARY', summary],
            ['SEED_SUMMARY', summary],                                                  // Biomes: the area waits for the spawn
            // Find near me: nothing before Locate.
            // More: Farms scans witch huts at 16 regions at once (the version, the spawn, the scan); My worlds asks nothing.
            ['GET_VERSION_SUPPORT', { mcVersion: VERSIONS['26.3'], biomeIds: [], structTypes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 18, 19, 21, 22, 24, 25, 26] }],
            ['SEED_SUMMARY', summary],
            ['QUAD_HUTS', { mcVersion: VERSIONS['26.3'], seed: '1' }],
        ];
        const asked = () => qm().request.mock.calls.map(([kind, data]) => [kind, data]);
        expect(asked()).toEqual(before);
        // With the spawn known, Biomes asks for the 500×500-cell area centred on it at Y 256,
        // and Farms for the slime chunks around the spawn's chunk (6, -3).
        await act(async () => {
            for (const entry of qm().pendingOf('SEED_SUMMARY')) entry.resolve({ spawnX: 100, spawnZ: -40, spawnBiome: 1, approxHeight: 70, error: null });
        });
        expect(asked()).toEqual([
            ...before,
            ['GET_AREA', { mcVersion: VERSIONS['26.3'], seed: '1', startX: (100 >> 2) - 250, startY: (-40 >> 2) - 250, widthX: 500, widthY: 500, dimension: 0, yHeight: 256 }],
            ['SLIME_CHUNKS', { seed: '1', cx0: 6 - 16, cz0: -3 - 16, w: 32, h: 32 }],
        ]);
        expect(qm().request.mock.calls.slice(-2).map(([, , opts]) => opts.priority)).toEqual(['low', 'low']);
        expect(asked().some(([kind]) => kind === 'BIOME_CENTERS')).toBe(false);
    });
});

describe('Farms', () => {
    it('"Switch to the Nether" moves the page to the Nether, in the URL and on the map', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        await user.click(screen.getByRole('tab', { name: 'More' }));
        await user.click(within(document.getElementById('farms')).getByRole('button', { name: 'Switch to the Nether' }));
        await flush();
        expect(search().get('dim')).toBe('-1');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(-1);
        // The section follows the world: the Nether shows fortresses instead of the button.
        expect(within(document.getElementById('farms')).queryByRole('button', { name: 'Switch to the Nether' })).toBeNull();
        expect(within(document.getElementById('farms')).getByText('Witch huts are in the Overworld.')).toBeInTheDocument();
    });
});

describe('the slime-chunk overlay', () => {
    it('reaches the map from the dashboard\'s toggle, and outlives a dimension change', async () => {
        window.sessionStorage.clear();                  // Find near me's last point lives there
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        const slime = () => drawer().callsOf('setOverlay').filter(([name]) => name === 'slime').map(([, on]) => on);
        expect(slime()).toEqual([false]);
        expect(drawer().overlays).toEqual({});
        // Find near me offers the toggle once a point is located in the Overworld.
        await user.click(screen.getByRole('tab', { name: 'Find near me' }));
        const where = within(document.getElementById('where'));
        await user.type(where.getByLabelText('X coordinate'), '0');
        await user.type(where.getByLabelText('Z coordinate'), '0');
        await user.click(where.getByRole('button', { name: 'Locate' }));
        const toggle = where.getByRole('checkbox', { name: 'Show slime chunks on the map' });
        expect(toggle).not.toBeChecked();
        await user.click(toggle);
        expect(toggle).toBeChecked();
        expect(slime()).toEqual([false, true]);
        expect(drawer().overlays).toEqual({ slime: true });
        // The state lives in the page: the Nether hides the toggle but the map keeps the overlay (it draws nothing there).
        await select('Dimension', 'Nether');
        expect(screen.queryByRole('checkbox', { name: 'Show slime chunks on the map' })).toBeNull();
        expect(drawer().overlays).toEqual({ slime: true });
        expect(slime()).toEqual([false, true]);
        await select('Dimension', 'Overworld');
        await user.click(where.getByRole('button', { name: 'Locate' }));
        await user.click(where.getByRole('checkbox', { name: 'Show slime chunks on the map' }));
        expect(slime()).toEqual([false, true, false]);
        expect(drawer().overlays).toEqual({});
    });
});

describe('chunk grid lines', () => {
    it('the controls\' checkbox switches the map\'s chunk grid, which outlives a world change', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        const grid = () => drawer().callsOf('setOverlay').filter(([name]) => name === 'chunkGrid').map(([, on]) => on);
        const box = screen.getByRole('checkbox', { name: 'Show chunk grid lines' });
        expect(box).not.toBeChecked();
        expect(box).toHaveAccessibleDescription('from zoom 3');
        expect(grid()).toEqual([false]);
        await user.click(box);
        expect(box).toBeChecked();
        expect(grid()).toEqual([false, true]);
        expect(drawer().overlays).toEqual({ chunkGrid: true });
        await select('Dimension', 'Nether');                           // the grid is drawn in every dimension
        expect(screen.getByRole('checkbox', { name: 'Show chunk grid lines' })).toBeChecked();
        expect(drawer().overlays).toEqual({ chunkGrid: true });
        await user.click(screen.getByRole('checkbox', { name: 'Show chunk grid lines' }));
        expect(grid()).toEqual([false, true, false]);
    });
});

describe('on a phone', () => {
    // Below --bp-md the controls move into a bottom sheet whose header is the seed row.
    beforeEach(() => FakeMatchMedia.set('(min-width: 768px)', false));

    it('shows the map with a bottom sheet instead of the side column', async () => {
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        expect(container.querySelector('.sheet')).not.toBeNull();
        expect(container.querySelector('aside')).toBeNull();
        expect(screen.getByRole('region', { name: 'World details' })).toBeInTheDocument();
        expect(document.getElementById('dashboard')).toBe(container.querySelector('.sheet__content'));
        expect(screen.getByRole('button', { name: 'Toggle world details' })).toHaveAttribute('aria-controls', 'dashboard');
    });

    it('a tab in the collapsed header opens the sheet halfway on that tab', async () => {
        const user = userEvent.setup();
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        const sheet = container.querySelector('.sheet');
        expect(sheet).toHaveAttribute('data-snap', 'collapsed');
        await user.click(within(container.querySelector('.sheet__header')).getByRole('tab', { name: 'Biomes' }));
        expect(sheet).toHaveAttribute('data-snap', 'half');
        expect(screen.getByRole('tab', { name: 'Biomes' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel', { name: 'Biomes' })).toContainElement(document.getElementById('biomes'));
    });

    it('the collapsed header is the seed row and the tab strip; every other control is in the sheet body', async () => {
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        const header = within(container.querySelector('.sheet__header'));
        expect(header.getByLabelText('Seed')).toHaveValue('1');
        expect(header.getByRole('button', { name: 'GO' })).toBeInTheDocument();
        expect(header.getByRole('button', { name: 'Random' })).toBeInTheDocument();
        expect(screen.getAllByLabelText('Seed')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Random seed' })).toBeNull();
        const content = container.querySelector('.sheet__content');
        expect(content).toContainElement(screen.getByLabelText('Minecraft version'));
        expect(content).toContainElement(screen.getByLabelText('Share URL'));
        expect(content).toContainElement(screen.getByRole('link', { name: 'Open the advanced finder' }));
    });

    it('the sheet holds the same panel: tabs, sections, both ads, footer last', async () => {
        const user = userEvent.setup();
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        const content = container.querySelector('.sheet__content');
        // The tab strip is in the sheet's header, under the seed row, visible even when collapsed.
        const header = container.querySelector('.sheet__header');
        expect(header).toContainElement(screen.getByRole('tablist', { name: 'Dashboard' }));
        expect(screen.getByLabelText('Seed').compareDocumentPosition(screen.getByRole('tablist')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        for (const name of ['Spawn & structures', 'Biomes', 'Find near me', 'More']) {
            await user.click(screen.getByRole('tab', { name }));
        }
        expect(content.querySelectorAll('section.section')).toHaveLength(8);
        expect(content.querySelectorAll('ins.adsbygoogle')).toHaveLength(2);
        expect(content.lastElementChild).toHaveClass('site-footer');
        // Never in the collapsed header next to GO / Random.
        expect(container.querySelector('.sheet__header .ad')).toBeNull();
    });

    it('the what\'s-new card still comes first in the panel', async () => {
        const { container } = await renderAt('/seed/?seed=42&version=1.17&from=legacy');
        const content = container.querySelector('.sheet__content');
        expect(content.firstElementChild).toContainElement(screen.getByRole('heading', { name: 'Seeder has new sections' }));
    });

    it('builds the map renderer once, and GO in the sheet header applies the seed', async () => {
        const user = userEvent.setup();
        await renderAt('/seed/?seed=1&version=26.3');
        expect(FakeDrawSeed.instances).toHaveLength(1);
        await user.clear(screen.getByLabelText('Seed'));
        await user.type(screen.getByLabelText('Seed'), '456');
        await user.click(screen.getByRole('button', { name: 'GO' }));
        await flush();
        expect(drawer().setSeed).toHaveBeenLastCalledWith('456');
        expect(search().get('seed')).toBe('456');
        expect(FakeDrawSeed.instances).toHaveLength(1);
    });

    it('Random in the sheet header waits for the spawn like on desktop', async () => {
        FakeDrawSeed.autoResolve = false;
        await renderAt('/seed/?seed=1&version=26.3');
        expect(screen.getByRole('button', { name: 'Random' })).toBeDisabled();
        act(() => drawer().resolveSpawn());
        expect(screen.getByRole('button', { name: 'Random' })).toBeEnabled();
    });

    it('the selects in the sheet drive the renderer', async () => {
        await renderAt('/seed/?seed=1&version=26.3');
        await select('Minecraft version', '1.16.5');
        expect(drawer().setMcVersion).toHaveBeenLastCalledWith(VERSIONS['1.16.5']);
        await select('Dimension', 'Nether');
        expect(drawer().setDimension).toHaveBeenLastCalledWith(-1);
    });

    it('crossing the breakpoint swaps the panel but keeps the same map renderer', async () => {
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        const first = drawer();
        const canvas = container.querySelector('canvas');
        act(() => { FakeMatchMedia.set('(min-width: 768px)', true); FakeMatchMedia.trigger(); });
        expect(container.querySelector('aside#dashboard')).not.toBeNull();
        expect(container.querySelector('.sheet')).toBeNull();
        expect(screen.getByRole('button', { name: 'Random seed' })).toBeInTheDocument();
        act(() => { FakeMatchMedia.set('(min-width: 768px)', false); FakeMatchMedia.trigger(); });
        expect(container.querySelector('.sheet')).not.toBeNull();
        expect(FakeDrawSeed.instances).toHaveLength(1);
        expect(drawer()).toBe(first);
        expect(first.destroy).not.toHaveBeenCalled();
        expect(container.querySelector('canvas')).toBe(canvas);
    });
});

describe('on a desktop', () => {
    it('keeps the side column and has no bottom sheet', async () => {
        const { container } = await renderAt('/seed/?seed=1&version=26.3');
        expect(container.querySelector('aside#dashboard')).not.toBeNull();
        expect(container.querySelector('.sheet')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Toggle world details' })).toBeNull();
    });
});
