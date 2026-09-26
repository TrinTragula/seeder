// /finder/ as a visitor meets it. The worker pool and the map renderer are recording
// fakes: a test streams hits into the page with emitHit / emitProgress / finish.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import FinderPage, { FIND_MORE_HINT } from './FinderPage';
import { maxSeedsToScanFor } from './criteria';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { FakeDrawSeed, FakeQueueManager, FakeMatchMedia, defaultVersionSupport } from '../../test/fakes';
import { resetQueueManagerForTests } from '../../shared/engine';
import { clearSeedQueryCache } from '../../shared/hooks/useSeedQuery';
import { ALL_BIOME_IDS, ALL_STRUCTURE_TYPES } from '../../shared/hooks/useVersionSupport';
import { WORLDS_KEY } from '../../shared/worlds';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));
vi.mock('../../library/draw', async (importOriginal) => ({
    ...(await importOriginal()),
    DrawSeed: (await import('../../test/fakes')).FakeDrawSeed,
}));

const qm = () => FakeQueueManager.latest();
const flush = () => act(async () => { await Promise.resolve(); });
const search = () => new URLSearchParams(window.location.search);
const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');

// Answer the page's version probe like the engine (1.12 lacks the newer biomes).
async function answerSupport() {
    const [entry] = qm().pendingOf('GET_VERSION_SUPPORT');
    const { mcVersion, biomeIds, structTypes } = entry.data;
    const s = defaultVersionSupport(mcVersion, biomeIds, structTypes);
    s.structures[structure('Fortress')] = -1;
    s.structures[structure('Bastion')] = -1;
    if (mcVersion === VERSIONS['1.12']) s.biomes = s.biomes.filter((id) => id !== biome('Cherry Grove'));
    await act(async () => { qm().resolveRequest('GET_VERSION_SUPPORT', s); });
}
async function renderAt(url) {
    window.history.replaceState({}, '', url);
    const utils = render(<FinderPage />);
    await flush();
    await answerSupport();
    return utils;
}
const clickSearch = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await flush();
};
const hit = (seed, structures = [{ type: VILLAGE, x: 96, z: -80 }]) => ({ seed, spawnX: -32, spawnZ: 80, structures });
const emit = async (h) => { await act(async () => { qm().emitHit(h); }); };
const cards = () => screen.queryAllByTestId('seed-card');
// jsdom lays nothing out: give the rows' thumbnail buttons the box a 1280-wide row has.
const setBox = () => {
    Object.defineProperty(HTMLButtonElement.prototype, 'clientWidth', { configurable: true, get: () => 906 });
    Object.defineProperty(HTMLButtonElement.prototype, 'clientHeight', { configurable: true, get: () => 320 });
};
// The stats bar's live line (the form's warning list is a status region too).
const results = () => within(screen.getByRole('region', { name: 'Results' }));
const toolbar = () => screen.queryByRole('toolbar', { name: 'Share and export' });
// Describe the shared seed being loaded, like the engine: its SEED_SUMMARY, then (with
// structure criteria) its NEAREST_STRUCTURES.
async function answerSeed({ spawnX = -32, spawnZ = 80, results: found } = {}) {
    await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX, spawnZ, spawnBiome: 1, approxHeight: 70 }); });
    await flush();
    if (found) {
        await act(async () => { qm().resolveRequest('NEAREST_STRUCTURES', { results: found }); });
        await flush();
    }
}
const village = (x = 96, z = -80) => [{ type: VILLAGE, found: 1, x, z }];
// What a CopyButton put on the clipboard.
async function copiedBy(name) {
    navigator.clipboard.writeText.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
    return navigator.clipboard.writeText.mock.calls[0][0];
}
const SHARED = '/finder/?seeds=1,2&structures=5&range=300&version=26.3&start=99';
const findMore = () => screen.queryByRole('button', { name: 'Find more' });

beforeEach(() => {
    // jsdom does not scroll; an opened row asks it to (SeedCard's tests pin how).
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    FakeDrawSeed.reset();
    clearSeedQueryCache();
    window.localStorage.clear();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
});
afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
    delete window.__seederDrawer;
    delete HTMLButtonElement.prototype.clientWidth;
    delete HTMLButtonElement.prototype.clientHeight;
});

describe('FinderPage', () => {
    it('restores the form from a shared criteria URL', async () => {
        await renderAt('/finder/?biomes=185&structures=5&range=300&version=26.3&count=25');
        const form = screen.getByRole('form', { name: 'Search criteria' });
        expect(within(form).getByText('Village')).toBeInTheDocument();
        expect(within(form).getByText('Cherry Grove')).toBeInTheDocument();
        expect(within(form).getByText('300 blocks')).toBeInTheDocument();
        expect(within(form).getByText('26.3')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: '25' })).toBeChecked();
        expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    });

    it('a criteria URL never searches on mount', async () => {
        await renderAt('/finder/?structures=5&version=26.3');
        await flush();
        expect(qm().findSeeds).not.toHaveBeenCalled();
        expect(qm().getVersionSupport).not.toHaveBeenCalled();
        // Idle: no status line, no progress, no cards.
        expect(results().queryAllByRole('status')).toHaveLength(0);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(cards()).toHaveLength(0);
    });

    it('Search starts findSeeds with the form\'s criteria', async () => {
        await renderAt('/finder/?version=26.3&structures=5&range=300&count=25&start=9007199254740993');
        await clickSearch();
        expect(qm().findSeeds).toHaveBeenCalledTimes(1);
        const [sent] = qm().findSeeds.mock.calls[0];
        expect(sent).toEqual({
            mcVersion: VERSIONS['26.3'], largeBiomes: false, dimension: 0, yHeight: 256, biomes: [], anyBiomes: [], excludeBiomes: [], structures: [VILLAGE], rangeBlocks: 300,
            startingSeed: 9007199254740993n, count: 25, maxSeedsToScan: maxSeedsToScanFor({ structures: [VILLAGE] }),
        });
        expect(results().getByRole('status')).toHaveTextContent('Searching…');
        expect(screen.getByRole('button', { name: 'STOP' })).toBeInTheDocument();
    });

    it('while searching the form and the presets are disabled; once done, presets stay hidden on desktop', async () => {
        await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
        expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
        await act(async () => { qm().finish('target'); });
        expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
        expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
    });

    it('a hit renders a row with a thumbnail the size of its box; nothing opens by itself', async () => {
        setBox();
        await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(3774n));
        expect(cards()).toHaveLength(1);
        expect(within(cards()[0]).getByText('3774', { selector: 'code' })).toBeInTheDocument();
        // One of the first rows: asked for at once, seen or not, at 1 px per cell, on its village, in strips.
        const [area] = qm().pendingOf('GET_AREA');
        expect(area.data).toMatchObject({ seed: '3774', startX: -429, startY: -180, widthX: 906, widthY: 64, dimension: 0 });
        expect(area.opts.priority).toBe('low');
        // Closed: no map anywhere on the page.
        expect(screen.getByRole('button', { name: 'Preview 3774' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByLabelText('Biome map')).toBeNull();
        await act(async () => { qm().resolveAreas(); });
        expect(screen.getByRole('button', { name: 'Preview 3774' }).querySelector('canvas')).not.toBeNull();
        // A second hit is appended below.
        await emit(hit(-5n));
        expect(cards().map((c) => c.querySelector('code').textContent)).toEqual(['3774', '-5']);
        expect(qm().pendingOf('GET_AREA').map((r) => r.data.seed)).toEqual(Array(5).fill('-5'));
    });

    it('clicking a row opens its map in place; opening another closes the first', async () => {
        await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(1n));
        await emit(hit(2n, [{ type: VILLAGE, x: -200, z: 16 }]));
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1' }));
        await flush();
        expect(within(cards()[0]).getByLabelText('Biome map')).toBeInTheDocument();
        expect(FakeDrawSeed.latest().seed).toBe('1');
        expect(FakeDrawSeed.latest().highlight).toEqual({ x: 96, z: -80, label: 'Village' });
        fireEvent.click(screen.getByRole('button', { name: 'Preview 2' }));
        await flush();
        expect(screen.getAllByLabelText('Biome map')).toHaveLength(1);
        expect(within(cards()[1]).getByLabelText('Biome map')).toBeInTheDocument();
        expect(FakeDrawSeed.latest().highlight).toEqual({ x: -200, z: 16, label: 'Village' });
        expect(screen.getByRole('button', { name: 'Preview 1' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
        await flush();
        expect(screen.queryByLabelText('Biome map')).toBeNull();
    });

    it('STOP keeps the cards and shows the stopped sentence', async () => {
        await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(1n));
        await emit(hit(2n));
        fireEvent.click(screen.getByRole('button', { name: 'STOP' }));
        await flush();
        expect(qm().stopSearch).toHaveBeenCalledTimes(1);
        expect(cards()).toHaveLength(2);
        expect(results().getByRole('status')).toHaveTextContent(/^Stopped after 0 seeds checked; 2 results kept\.$/);
        expect(screen.queryByRole('button', { name: 'STOP' })).toBeNull();
        expect(window.location.pathname).toBe('/finder/');
    });

    it('a new Search starts over: no rows, nothing open', async () => {
        await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(1n));
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1' }));
        await act(async () => { qm().finish('target'); });
        await clickSearch();
        expect(qm().findSeeds).toHaveBeenCalledTimes(2);
        expect(cards()).toHaveLength(0);
        expect(screen.queryByLabelText('Biome map')).toBeNull();
        await emit(hit(1n));
        expect(screen.getByRole('button', { name: 'Preview 1' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('Save world writes seeder.worlds.v1 with the version label', async () => {
        await renderAt('/finder/?version=1.21.11&structures=5');
        await clickSearch();
        await emit(hit(3774n));
        fireEvent.click(screen.getByRole('button', { name: 'Save world' }));
        await flush();
        const [world] = JSON.parse(window.localStorage.getItem(WORLDS_KEY));
        expect(world).toMatchObject({ name: 'Seed 3774', seed: '3774', version: '1.21.11', dimension: 0 });
        expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeDisabled();
    });

    it('a Large Biomes search: the URL, the coordinator, the row\'s links and the saved world all keep the type', async () => {
        setBox();
        await renderAt('/finder/?version=1.16.5&world=large&structures=5');
        expect(search().get('world')).toBe('large');
        await clickSearch();
        expect(qm().findSeeds.mock.calls[0][0]).toMatchObject({ mcVersion: VERSIONS['1.16.5'], largeBiomes: true });
        await emit(hit(3774n));
        expect(screen.getByRole('link', { name: 'Open seed' })).toHaveAttribute('href', '/seed/?seed=3774&version=1.16.5&world=large');
        // The row's own engine questions and its thumbnail are about the Large Biomes world.
        for (const [kind, data] of qm().request.mock.calls) {
            if (kind === 'GET_VERSION_SUPPORT') expect(data.mcVersion).toBe(VERSIONS['1.16.5']);
            else if ('mcVersion' in data) expect(data.mcVersion, kind).toBe(VERSIONS['1.16.5'] | (1 << 16));
        }
        expect(qm().requestArea.mock.calls.length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Save world' }));
        await flush();
        const [world] = JSON.parse(window.localStorage.getItem(WORLDS_KEY));
        expect(world).toMatchObject({ seed: '3774', version: '1.16.5', dimension: 0, largeBiomes: true });
        // Opening the row's map draws the Large Biomes world.
        fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
        await flush();
        expect(FakeDrawSeed.latest().setMcVersion).toHaveBeenLastCalledWith(VERSIONS['1.16.5'] | (1 << 16));
    });

    it('the results slot reads status, ad, rows', async () => {
        const { container } = await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(1n));
        const slot = container.querySelector('.finder__slot--results');
        const status = within(slot).getByRole('status');
        const ad = slot.querySelector('ins.adsbygoogle');
        const list = within(slot).getByRole('list', { name: 'Seeds found' });
        const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(status, ad)).toBe(true);
        expect(follows(ad, list)).toBe(true);
        expect(ad.closest('.ad')).toHaveClass('finder__ad--results');
        // No separate preview map any more.
        expect(within(slot).queryByLabelText('Biome map')).toBeNull();
    });

    it('shows exactly one responsive ad, in the results slot, away from Search', async () => {
        const { container } = await renderAt('/finder/');
        const ads = container.querySelectorAll('ins.adsbygoogle');
        expect(ads).toHaveLength(1);
        expect(ads[0]).toHaveAttribute('data-ad-format', 'auto');
        expect(container.querySelector('.finder__slot--results')).toContainElement(ads[0]);
        expect(container.querySelector('.finder__criteria')).not.toContainElement(ads[0]);
    });

    it('a preset fills the form and the URL, on the current version, and starts the search with its criteria', async () => {
        await renderAt('/finder/?version=1.21.11&count=50&structures=5');
        expect(screen.getByRole('button', { name: 'Bastion + Fortress' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Bastion + Fortress' }));
        await flush();
        expect(search().get('version')).toBe('1.21.11');
        expect(search().get('dim')).toBe('-1');
        expect(search().get('range')).toBe('200');
        expect(search().get('structures')).toBe(`${structure('Bastion')},${structure('Fortress')}`);
        expect(search().get('start')).toBe('0');
        expect(within(screen.getByRole('form', { name: 'Search criteria' })).getByText('Fortress')).toBeInTheDocument();
        // The preset's criteria, not the URL's earlier ones (Village, 50 results).
        expect(qm().findSeeds).toHaveBeenCalledTimes(1);
        expect(qm().findSeeds.mock.calls[0][0]).toMatchObject({
            mcVersion: VERSIONS['1.21.11'], dimension: -1, biomes: [], structures: [structure('Bastion'), structure('Fortress')], startingSeed: 0n, count: 10,
        });
        expect(results().getByRole('status')).toHaveTextContent('Searching…');
        expect(screen.getByRole('button', { name: 'STOP' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
    });

    it('a pinned preset on an older version switches to the newest one and searches once its support lands', async () => {
        await renderAt('/finder/?version=1.20');
        fireEvent.click(screen.getByRole('button', { name: 'Camp at spawn' }));
        await flush();
        expect(search().get('version')).toBe('26.3');
        expect(search().get('structures')).toBe(String(structure('Abandoned Camp')));
        expect(search().get('range')).toBe('100');
        // The 1.20 answer cannot validate a 26.3 search: nothing runs until 26.3's lands.
        expect(qm().findSeeds).not.toHaveBeenCalled();
        await answerSupport();
        expect(qm().findSeeds).toHaveBeenCalledTimes(1);
        expect(qm().findSeeds.mock.calls[0][0]).toMatchObject({
            mcVersion: VERSIONS['26.3'], dimension: 0, biomes: [], structures: [structure('Abandoned Camp')], rangeBlocks: 100, startingSeed: 0n,
        });
        expect(results().getByRole('status')).toHaveTextContent('Searching…');
    });

    it('an edit of the form before the new version\'s support lands cancels the pinned preset\'s search', async () => {
        await renderAt('/finder/?version=1.20');
        fireEvent.click(screen.getByRole('button', { name: 'Sulfur village 26.2' }));
        await flush();
        expect(search().get('version')).toBe('26.3');
        expect(search().get('y')).toBe('0');
        fireEvent.click(screen.getByRole('radio', { name: '25' }));
        await flush();
        await answerSupport();
        expect(qm().findSeeds).not.toHaveBeenCalled();
        expect(search().get('count')).toBe('25');
        expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    });

    describe('Back to presets', () => {
        const back = () => screen.queryByRole('button', { name: 'Back to presets' });

        it('appears beside the title after a preset\'s search and starts over: search stopped, rows gone, presets back', async () => {
            await renderAt('/finder/?version=26.3');
            expect(back()).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Village at spawn' }));
            await flush();
            await emit(hit('123'));
            expect(cards()).toHaveLength(1);
            expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
            // Next to the page title.
            expect(screen.getByRole('heading', { level: 1 }).parentElement).toContainElement(back());
            const running = qm().lastSearch();
            expect(running.active).toBe(true);

            fireEvent.click(back());
            await flush();
            expect(running.active).toBe(false);
            expect(cards()).toHaveLength(0);
            expect(back()).toBeNull();
            expect(screen.getByRole('region', { name: 'Presets' })).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: 'Presets', level: 2 })).toHaveFocus();
            expect(screen.queryByRole('button', { name: 'STOP' })).toBeNull();
            expect(screen.queryByRole('progressbar')).toBeNull();
            // The form keeps the preset's criteria, and nothing restarts by itself.
            expect(search().get('structures')).toBe(String(VILLAGE));
            expect(search().get('range')).toBe('100');
            expect(within(screen.getByRole('form', { name: 'Search criteria' })).getByText('Village')).toBeInTheDocument();
            expect(qm().findSeeds).toHaveBeenCalledTimes(1);
            // Late hits of the stopped run add nothing.
            act(() => { running.cbs.onHit?.({ seed: 999n, structures: [] }); });
            expect(cards()).toHaveLength(0);
        });

        it('a preset\'s search starts at the top of the page, wherever its chip was', async () => {
            await renderAt('/finder/?version=26.3');
            window.scrollTo.mockClear();
            fireEvent.click(screen.getByRole('button', { name: 'Jungle temple in bamboo' }));
            await flush();
            expect(qm().findSeeds).toHaveBeenCalledTimes(1);
            expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
        });

        it('a search from the Search button keeps the scroll', async () => {
            await renderAt('/finder/?version=26.3&structures=5');
            window.scrollTo.mockClear();
            await clickSearch();
            expect(window.scrollTo).not.toHaveBeenCalled();
        });

        it('stays after the run ends and after "Find more"', async () => {
            await renderAt('/finder/?version=26.3');
            fireEvent.click(screen.getByRole('button', { name: 'Village at spawn' }));
            await flush();
            await emit(hit('1'));
            await act(async () => { qm().finish('target', 5n); });
            expect(back()).toBeInTheDocument();
            fireEvent.click(findMore());
            await flush();
            expect(qm().findSeeds).toHaveBeenCalledTimes(2);
            expect(back()).toBeInTheDocument();
        });

        it('never shows after a search started with the Search button', async () => {
            await renderAt('/finder/?version=26.3&structures=5');
            await clickSearch();
            await act(async () => { qm().finish('target'); });
            expect(back()).toBeNull();
        });

        it('on a phone brings back the form and the presets instead of the summary', async () => {
            FakeMatchMedia.set('(min-width: 768px)', false);
            await renderAt('/finder/?version=26.3');
            fireEvent.click(screen.getByRole('button', { name: 'Camp at spawn' }));
            await flush();
            expect(screen.queryByRole('form', { name: 'Search criteria' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Edit criteria' })).toBeInTheDocument();
            // One compact line with the title: a short label, the full phrase as its name.
            expect(back().textContent).toBe('Presets');
            fireEvent.click(back());
            await flush();
            expect(screen.getByRole('form', { name: 'Search criteria' })).toBeInTheDocument();
            expect(screen.getByRole('region', { name: 'Presets' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Edit criteria' })).toBeNull();
        });
    });

    it('republishes the URL with replaceState when the form changes; a criteria change leaves seeds mode', async () => {
        const replace = vi.spyOn(window.history, 'replaceState');
        const push = vi.spyOn(window.history, 'pushState');
        await renderAt('/finder/?structures=5&seeds=8091867987493326313,1');
        expect(search().get('seeds')).toBe('8091867987493326313,1');
        replace.mockClear();
        fireEvent.click(screen.getByRole('radio', { name: '50' }));
        await flush();
        expect(replace).toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe('/finder/');
        expect(search().get('count')).toBe('50');
        expect(search().has('seeds')).toBe(false);
        expect(window.location.search).toBe('?version=26.3&dim=0&range=300&y=256&count=50&start=0&structures=5');
        // An ordinary finder again: no banner, no shared rows, and the in-flight
        // description of the shared seeds was cancelled.
        expect(screen.queryByText(/shared with you|Loading shared seeds/)).toBeNull();
        expect(cards()).toHaveLength(0);
        expect(qm().pendingOf('SEED_SUMMARY')).toHaveLength(0);
    });

    it('a search never writes seeds= to the URL', async () => {
        await renderAt('/finder/?structures=5');
        const before = window.location.search;
        await clickSearch();
        await emit(hit(1n));
        await act(async () => { qm().finish('target'); });
        expect(window.location.search).toBe(before);
    });

    it('the Start seed goes to the URL as a decimal cursor', async () => {
        await renderAt('/finder/?structures=5');
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        fireEvent.change(screen.getByLabelText('Start seed'), { target: { value: '9007199254740993' } });
        await flush();
        expect(search().get('start')).toBe('9007199254740993');
    });

    it('has the h1 and no intro paragraph, and keeps the document title', async () => {
        document.title = 'Minecraft seed finder - Seeder';
        await renderAt('/finder/');
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Minecraft seed finder');
        expect(screen.queryByText(/runs in your browser on every core/)).toBeNull();
        expect(document.querySelector('.finder__intro p')).toBeNull();
        expect(document.title).toBe('Minecraft seed finder - Seeder');
    });

    it('asks GET_VERSION_SUPPORT once, with every biome and every structure type', async () => {
        await renderAt('/finder/?version=1.12');
        const asked = qm().requests.filter((r) => r.kind === 'GET_VERSION_SUPPORT');
        expect(asked).toHaveLength(1);
        expect(asked[0].data).toEqual({ mcVersion: VERSIONS['1.12'], biomeIds: ALL_BIOME_IDS, structTypes: ALL_STRUCTURE_TYPES });
        expect(asked[0].opts.priority).toBe('high');
        expect(screen.getByRole('button', { name: 'Cherry Grove at spawn' })).toBeDisabled();
    });

    it('two columns on desktop, one on a phone', async () => {
        const { container, unmount } = await renderAt('/finder/');
        expect(container.querySelector('.finder')).toHaveClass('finder--desktop');
        unmount();
        FakeMatchMedia.set('(min-width: 768px)', false);
        const phone = render(<FinderPage />);
        expect(phone.container.querySelector('.finder')).toHaveClass('finder--phone');
        // One column: the criteria come before the presets and the results slot. No row
        // yet, so no ad: on a phone it waits under the first row.
        const order = [...phone.container.querySelectorAll('.finder__criteria, .presets, .finder__slot--results, .ad')].map((el) => el.className);
        expect(order).toEqual(['finder__criteria', 'presets', 'finder__slot finder__slot--results']);
    });

    describe('seeds mode', () => {
        it('renders the shared seeds as rows without searching, one seed at a time, with the toolbar and no banner', async () => {
            await renderAt(SHARED);
            expect(qm().findSeeds).not.toHaveBeenCalled();
            expect(toolbar()).not.toBeNull();
            // No announcement box, and no Find more while loading.
            expect(screen.queryByText(/shared with you|Loading shared seeds/)).toBeNull();
            expect(findMore()).toBeNull();
            // Sequential: one SEED_SUMMARY, for the first seed, in the Overworld.
            expect(qm().pendingOf('SEED_SUMMARY').map((r) => r.data)).toEqual([{ mcVersion: VERSIONS['26.3'], seed: '1', dimension: 0, yHeight: 256 }]);
            await answerSeed({ results: village() });
            expect(cards()).toHaveLength(1);
            expect(qm().pendingOf('SEED_SUMMARY').map((r) => r.data.seed)).toEqual(['2']);
            expect(findMore()).toBeDisabled();
            await answerSeed({ results: [{ type: VILLAGE, found: 0, x: 0, z: 0 }] });
            expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2']);
            expect(within(cards()[1]).getByText('Not found within 300 blocks')).toBeInTheDocument();
            // Nothing runs by itself: no stats bar, no STOP, no search.
            expect(screen.queryByRole('progressbar')).toBeNull();
            expect(screen.queryByRole('button', { name: 'STOP' })).toBeNull();
            expect(qm().findSeeds).not.toHaveBeenCalled();
            // The rows are the content: no presets.
            expect(screen.queryByRole('region', { name: 'Presets' })).toBeNull();
            expect(findMore()).toBeEnabled();
            expect(findMore()).toHaveAttribute('title', FIND_MORE_HINT);
        });

        it('"Find more" searches from the URL\'s start with its criteria and appends new seeds, deduped', async () => {
            await renderAt(SHARED);
            await answerSeed({ results: village() });
            await answerSeed({ results: village(16, 16) });
            fireEvent.click(screen.getByRole('button', { name: 'Find more' }));
            await flush();
            expect(qm().findSeeds).toHaveBeenCalledTimes(1);
            expect(qm().findSeeds.mock.calls[0][0]).toMatchObject({
                mcVersion: VERSIONS['26.3'], dimension: 0, structures: [VILLAGE], biomes: [], rangeBlocks: 300, count: 10, startingSeed: 99n,
            });
            expect(findMore()).toBeDisabled();
            // Find more keeps seeds mode.
            expect(search().get('seeds')).toBe('1,2');
            await emit(hit(2n));          // a shared seed: not a second row
            await emit(hit(3n));
            expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2', '3']);
        });

        it('after the run the seeds link carries start = resumeSeed and both seed lists', async () => {
            await renderAt(SHARED);
            await answerSeed({ results: village() });
            await answerSeed({ results: village() });
            expect(new URL(await copiedBy('Share these results')).searchParams.get('start')).toBe('99');
            fireEvent.click(screen.getByRole('button', { name: 'Find more' }));
            await flush();
            await emit(hit(3n));
            await emit(hit(-4n));
            await act(async () => { qm().finish('target', 12345n); });
            const url = new URL(await copiedBy('Share these results'));
            expect(url.origin).toBe('https://mcseeder.com');
            expect(url.pathname).toBe('/finder/');
            expect(url.searchParams.get('seeds')).toBe('1,2,3,-4');
            expect(url.searchParams.get('start')).toBe('12345');
            expect(url.searchParams.get('structures')).toBe(String(VILLAGE));
        });

        it('"Find more" again continues from the last resumeSeed and keeps every row', async () => {
            await renderAt(SHARED);
            await answerSeed({ results: village() });
            await answerSeed({ results: village() });
            fireEvent.click(screen.getByRole('button', { name: 'Find more' }));
            await flush();
            await emit(hit(3n));
            await act(async () => { qm().finish('target', 500n); });
            fireEvent.click(screen.getByRole('button', { name: 'Find more' }));
            await flush();
            expect(qm().findSeeds).toHaveBeenCalledTimes(2);
            expect(qm().findSeeds.mock.calls[1][0].startingSeed).toBe(500n);
            expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2', '3']);
            await emit(hit(3n));          // already found by the first run
            await emit(hit(4n));
            await act(async () => { qm().finish('target', 900n); });
            expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2', '3', '4']);
            expect(new URL(await copiedBy('Share these results')).searchParams.get('seeds')).toBe('1,2,3,4');
        });

        it('Search leaves seeds mode: the URL drops seeds and the shared rows go', async () => {
            await renderAt(SHARED);
            await answerSeed({ results: village() });
            await clickSearch();
            expect(qm().findSeeds).toHaveBeenCalledTimes(1);
            expect(search().has('seeds')).toBe(false);
            expect(screen.queryByText(/shared with you|Loading shared seeds|plus what the search finds/)).toBeNull();
            expect(cards()).toHaveLength(0);
            expect(qm().pendingOf('SEED_SUMMARY')).toHaveLength(0);
        });

        it('keeps its rows when the form drops a selection the version cannot hold', async () => {
            await renderAt(`/finder/?seeds=1,2&version=1.12&biomes=${biome('Cherry Grove')}`);
            // The form pruned Cherry Grove (1.12 has none) and said so...
            expect(screen.getByText(/^Removed Cherry Grove/)).toBeInTheDocument();
            // ...but that is not the visitor's edit: the shared rows still load.
            expect(search().get('seeds')).toBe('1,2');
            await answerSeed();
            await answerSeed();
            expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2']);
            expect(qm().findSeeds).not.toHaveBeenCalled();
        });

        it('a seed the engine cannot describe shows its warning on its row', async () => {
            await renderAt('/finder/?seeds=1,2&version=26.3&biomes=1');
            await act(async () => { qm().resolveRequest('SEED_SUMMARY', { error: { code: -1, message: 'version' } }); });
            await flush();
            await act(async () => { qm().resolveRequest('SEED_SUMMARY', { error: { code: -1, message: 'version' } }); });
            await flush();
            expect(screen.getAllByText('The engine could not describe this seed on 26.3.')).toHaveLength(2);
        });

        it('on a phone the criteria collapse to the summary', async () => {
            FakeMatchMedia.set('(min-width: 768px)', false);
            await renderAt(SHARED);
            expect(screen.queryByRole('form', { name: 'Search criteria' })).toBeNull();
            expect(screen.getByText('Village · 300 blocks · 26.3 · Overworld')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Edit criteria' }));
            expect(screen.getByRole('form', { name: 'Search criteria' })).toBeInTheDocument();
        });
    });

    it('the toolbar appears with the first hit of a run, never on an empty page', async () => {
        await renderAt('/finder/?version=26.3&structures=5');
        expect(toolbar()).toBeNull();
        await clickSearch();
        expect(toolbar()).toBeNull();
        await emit(hit(3774n));
        expect(toolbar()).not.toBeNull();
        // The run's criteria, not the form's.
        const url = new URL(await copiedBy('Share these results'));
        expect(url.searchParams.get('structures')).toBe(String(VILLAGE));
        expect(url.searchParams.get('seeds')).toBe('3774');
        await act(async () => { qm().finish('target', 777n); });
        const seeds = new URL(await copiedBy('Share these results'));
        expect(seeds.searchParams.get('seeds')).toBe('3774');
        expect(seeds.searchParams.get('start')).toBe('777');
    });

    it('the results slot reads: one status box (stats bar + share row), ad, rows, Find more', async () => {
        const { container } = await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(1n));
        await act(async () => { qm().finish('target', 50n); });
        const slot = container.querySelector('.finder__slot--results');
        const status = within(slot).getByText(/^Found all/).closest('[role="status"]');
        const box = status.parentElement.closest('.finder__status') ?? status.closest('.finder__status');
        // The share / export row sits in the same box as the stats sentence.
        expect(box).not.toBeNull();
        expect(box).toContainElement(toolbar());
        const order = [box, slot.querySelector('ins.adsbygoogle'), within(slot).getByRole('list', { name: 'Seeds found' }), findMore()];
        for (let i = 1; i < order.length; i += 1) {
            expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `item ${i}`).toBeTruthy();
        }
        expect(container.querySelector('.finder__slot--share')).toBeNull();
    });

    it('"Find more" at the end of a normal run continues from its resumeSeed and keeps the rows', async () => {
        await renderAt('/finder/?version=26.3&structures=5&count=10');
        await clickSearch();
        expect(findMore()).toBeNull();
        await emit(hit(1n));
        // Not while the run is going.
        expect(findMore()).toBeDisabled();
        await emit(hit(2n));
        await act(async () => { qm().finish('target', 750000n); });
        fireEvent.click(findMore());
        await flush();
        expect(qm().findSeeds).toHaveBeenCalledTimes(2);
        expect(qm().findSeeds.mock.calls[1][0]).toMatchObject({ structures: [VILLAGE], rangeBlocks: 300, count: 10, startingSeed: 750000n });
        expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2']);
        await emit(hit(2n));
        await emit(hit(3n));
        await act(async () => { qm().finish('target', 900000n); });
        expect(cards().map((c) => c.dataset.seed)).toEqual(['1', '2', '3']);
        const url = new URL(await copiedBy('Share these results'));
        expect(url.searchParams.get('seeds')).toBe('1,2,3');
        expect(url.searchParams.get('start')).toBe('900000');
        // A new Search starts over.
        await clickSearch();
        expect(cards()).toHaveLength(0);
    });

    it('no Find more after an engine error', async () => {
        await renderAt('/finder/?version=26.3&structures=5');
        await clickSearch();
        await emit(hit(1n));
        await act(async () => { qm().finish('error', 0n, { error: { code: -3, message: 'x' } }); });
        expect(findMore()).toBeDisabled();
    });

    describe('on a phone', () => {
        beforeEach(() => { FakeMatchMedia.set('(min-width: 768px)', false); });

        it('after Search the criteria collapse to a summary; Edit criteria re-expands them', async () => {
            await renderAt('/finder/?version=26.3&structures=5&biomes=185&range=300');
            await clickSearch();
            expect(screen.queryByRole('form', { name: 'Search criteria' })).toBeNull();
            expect(screen.getByText('Village · Cherry Grove · 300 blocks · 26.3 · Overworld')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Edit criteria' }));
            expect(screen.getByRole('form', { name: 'Search criteria' })).toBeInTheDocument();
            expect(screen.getByRole('region', { name: 'Presets' })).toBeInTheDocument();
            // Still searching: the form is there but cannot start another run.
            expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
            await act(async () => { qm().finish('target'); });
            await clickSearch();
            expect(qm().findSeeds).toHaveBeenCalledTimes(2);
            expect(screen.queryByRole('form', { name: 'Search criteria' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Edit criteria' })).toBeInTheDocument();
        });

        it('one status box holds the criteria line, the run\'s sentence and a "Share / export" toggle', async () => {
            const { container } = await renderAt('/finder/?version=26.3&structures=5&range=300');
            await clickSearch();
            await emit(hit(3774n));
            await act(async () => { qm().finish('target', 50n); });
            // No criteria box of its own: the summary is the status box's first line.
            expect(container.querySelector('.finder__criteria')).toBeNull();
            expect(container.querySelector('.finder__intro')).toHaveClass('finder__intro--compact');
            const box = container.querySelector('.finder__status');
            expect(within(box).getByText('Village · 300 blocks · 26.3 · Overworld')).toBeInTheDocument();
            expect(within(box).getByRole('button', { name: 'Edit criteria' })).toBeInTheDocument();
            expect(within(box).getByRole('status')).toHaveTextContent(/^Found all/);
            // The share / export row stays shut until asked for.
            const toggle = within(box).getByRole('button', { name: 'Share / export' });
            expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(toolbar()).toBeNull();
            fireEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            expect(box).toContainElement(toolbar());
            expect(toggle).toHaveAttribute('aria-controls', toolbar().id);
            expect(new URL(await copiedBy('Share these results')).searchParams.get('seeds')).toBe('3774');
        });

        it('the ad waits for the first row and sits right under it, before the second', async () => {
            const { container } = await renderAt('/finder/?version=26.3&structures=5');
            await clickSearch();
            expect(container.querySelector('ins.adsbygoogle')).toBeNull();
            await emit(hit(1n));
            await emit(hit(2n));
            const ads = container.querySelectorAll('ins.adsbygoogle');
            expect(ads).toHaveLength(1);
            const ad = ads[0].closest('.ad');
            expect(ad).toHaveClass('finder__ad--results');
            const [first, second] = within(screen.getByRole('list', { name: 'Seeds found' })).getAllByRole('listitem').filter((el) => el.parentElement.getAttribute('role') === 'list');
            expect(first.nextElementSibling).toBe(ad);
            expect(ad.nextElementSibling).toBe(second);
            // STOP stays in the status box, away from the ad.
            expect(container.querySelector('.finder__status')).toContainElement(screen.getByRole('button', { name: 'STOP' }));
        });

        it('rows open and close the same way on a phone', async () => {
            await renderAt('/finder/?version=26.3&structures=5');
            await clickSearch();
            await emit(hit(3774n));
            expect(screen.queryByLabelText('Biome map')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
            await flush();
            expect(within(cards()[0]).getByLabelText('Biome map')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
            await flush();
            expect(screen.queryByLabelText('Biome map')).toBeNull();
        });
    });
});
