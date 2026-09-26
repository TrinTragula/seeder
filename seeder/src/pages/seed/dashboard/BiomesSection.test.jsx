// The Biomes section's body inside a DashboardProvider, over the recording FakeQueueManager:
// the test answers SEED_SUMMARY and the GET_AREA that requestArea posts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BiomesSection from './BiomesSection';
import { DashboardProvider } from './DashboardContext';
import { BIOMES, VERSIONS } from '../../../util/constants';
import { FakeQueueManager, FAKE_COLORS } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';
import { clearAreaTallyCache } from './biomeStats';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const B = Object.fromEntries(BIOMES.map((b) => [b.label, b.value]));
const LABEL = Object.fromEntries(BIOMES.map((b) => [b.value, b.label]));
const WORLD = { seed: '8091867987493326313', mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, versionLabel: '26.3' };
const SPAWN = { spawnX: -32, spawnZ: 80, spawnBiome: B.Plains, approxHeight: 71 };

// 100 cells: twelve biomes, two of them past the top 10 (ties broken by id).
const COUNTS = [
    ['Plains', 30], ['Forest', 20], ['Taiga', 12], ['Swamp', 10], ['Ocean', 8], ['Deep Ocean', 6],
    ['Desert', 5], ['Windswept Hills', 3], ['River', 2], ['Jungle', 2], ['Dark Forest', 1], ['Savanna', 1],
].map(([label, count]) => [B[label], count]);
const IDS = new Int32Array(COUNTS.flatMap(([id, count]) => Array(count).fill(id)));
const ORDER = [...COUNTS].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);

const qm = () => FakeQueueManager.latest();
const ofKind = (kind) => qm().requests.filter((r) => r.kind === kind);
const answer = (kind, result) => act(async () => { qm().resolveRequest(kind, result); });
const answerArea = (ids = IDS) => act(async () => {
    const entry = qm().pendingOf('GET_AREA').at(-1);
    entry.resolve({ ...entry.data, ids, rgba: new Uint8ClampedArray(ids.length * 4), error: undefined });
});

function Harness({ world }) {
    const value = {
        world, mapApi: { current: null }, sheetApi: { current: null }, structuresToShow: [], setStructuresToShow: vi.fn(),
        worlds: { worlds: [] }, showSection: vi.fn(),
    };
    return <DashboardProvider value={value}><BiomesSection /></DashboardProvider>;
}
function renderBiomes(world = {}) {
    const utils = render(<Harness world={{ ...WORLD, ...world }} />);
    const rerender = (next) => utils.rerender(<Harness world={{ ...WORLD, ...world, ...next }} />);
    return { ...utils, rerender };
}
async function loaded(world = {}) {
    const handles = renderBiomes(world);
    if ((world.dimension ?? 0) === 0) await answer('SEED_SUMMARY', SPAWN);
    await answerArea();
    return handles;
}

const list = () => screen.getByRole('list', { name: 'Biome breakdown' });
const rows = () => within(list()).getAllByRole('listitem');
const bar = () => screen.getByRole('img', { name: /^Top biomes:/ });
const rgb = (id) => `rgb(${FAKE_COLORS[id][0]}, ${FAKE_COLORS[id][1]}, ${FAKE_COLORS[id][2]})`;

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    clearAreaTallyCache();
});
afterEach(() => vi.useRealTimers());

describe('BiomesSection', () => {
    it('waits for the spawn, then asks one 500×500 area centred on the spawn\'s cells at the map\'s Y, at low priority', async () => {
        renderBiomes();
        expect(ofKind('SEED_SUMMARY').map((r) => r.data)).toEqual([{ mcVersion: WORLD.mcVersion, seed: WORLD.seed, dimension: 0, yHeight: 256 }]);
        expect(ofKind('GET_AREA')).toHaveLength(0);
        await answer('SEED_SUMMARY', SPAWN);
        const [area] = ofKind('GET_AREA');
        expect(area.data).toEqual({
            mcVersion: WORLD.mcVersion, seed: WORLD.seed,
            startX: (-32 >> 2) - 250, startY: (80 >> 2) - 250, widthX: 500, widthY: 500, dimension: 0, yHeight: 256,
        });
        expect(area.opts.priority).toBe('low');
        expect(qm().requestArea).toHaveBeenCalledTimes(1);
    });

    it('shows the computing line while the area is computed', async () => {
        renderBiomes();
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByText('Computing a 2,000 × 2,000-block area…')).toBeInTheDocument();
        await answer('SEED_SUMMARY', SPAWN);
        expect(screen.getByText('Computing a 2,000 × 2,000-block area…')).toBeInTheDocument();
        await answerArea();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/Computing/)).toBeNull();
    });

    it('a height change asks again only once the select has settled for 500 ms', async () => {
        vi.useFakeTimers();
        const { rerender } = await loaded();
        rerender({ yHeight: 62 });
        rerender({ yHeight: 0 });
        await act(async () => { vi.advanceTimersByTime(499); });
        expect(ofKind('GET_AREA')).toHaveLength(1);
        expect(list()).toBeInTheDocument();                            // the breakdown stays meanwhile
        await act(async () => { vi.advanceTimersByTime(1); });
        await answer('SEED_SUMMARY', SPAWN);
        expect(ofKind('GET_AREA')).toHaveLength(2);
        expect(ofKind('GET_AREA').at(-1).data).toMatchObject({ startX: -258, startY: -230, yHeight: 0 });
        await answerArea(new Int32Array([B['Lush Caves'], B['Lush Caves'], B.Plains]));
        expect(within(rows()[0]).getByText('Lush Caves')).toBeInTheDocument();
        expect(screen.getByText('Within 1000 blocks of spawn at Y 0.')).toBeInTheDocument();
    });

    it('centres on the origin in the Nether, without waiting for a spawn', async () => {
        renderBiomes({ dimension: -1 });
        expect(ofKind('SEED_SUMMARY')).toHaveLength(0);
        expect(ofKind('GET_AREA')[0].data).toMatchObject({ startX: -250, startY: -250, widthX: 500, widthY: 500, dimension: -1 });
        await answerArea(new Int32Array([B['Nether Wastes'], B['Nether Wastes'], B['Crimson Forest']]));
        expect(screen.getByText('Within 1000 blocks of the origin at Y 256.')).toBeInTheDocument();
    });

    it('lists the top 10 with swatch, label and a one-decimal share of the whole area', async () => {
        await loaded();
        expect(rows()).toHaveLength(10);
        expect(rows().map((row) => row.textContent)).toEqual(ORDER.slice(0, 10).map((id) => {
            const count = COUNTS.find(([i]) => i === id)[1];
            return `${LABEL[id]}${count.toFixed(1)}%`;
        }));
        const first = rows()[0];
        expect(within(first).getByText('30.0%')).toBeInTheDocument();
        const swatch = first.querySelector('[aria-hidden="true"]');
        expect(swatch.style.backgroundColor).toBe(rgb(B.Plains));
        // Nothing to open: a plain line, no button.
        expect(within(list()).queryByRole('button')).toBeNull();
    });

    it('the bar has one segment per listed row, as wide as its share, in the map\'s colours', async () => {
        const user = userEvent.setup();
        await loaded();
        const segments = () => [...bar().children];
        expect(segments()).toHaveLength(rows().length);
        expect(segments().map((s) => s.style.width)).toEqual(ORDER.slice(0, 10).map((id) => `${COUNTS.find(([i]) => i === id)[1]}%`));
        expect(segments().map((s) => s.style.backgroundColor)).toEqual(ORDER.slice(0, 10).map(rgb));
        expect(bar()).toHaveAccessibleName(`Top biomes: ${ORDER.slice(0, 10).map((id) => `${LABEL[id]} ${COUNTS.find(([i]) => i === id)[1]}%`).join(', ')}`);
        await user.click(screen.getByRole('button', { name: 'Show 2 more biomes' }));
        expect(segments()).toHaveLength(12);
        expect(segments()).toHaveLength(rows().length);
    });

    it('"Show 2 more biomes" reveals the rest, "Show fewer" folds it again', async () => {
        const user = userEvent.setup();
        await loaded();
        const more = screen.getByRole('button', { name: 'Show 2 more biomes' });
        expect(more).toHaveAttribute('aria-expanded', 'false');
        await user.click(more);
        expect(rows()).toHaveLength(12);
        expect(within(rows()[10]).getByText(LABEL[ORDER[10]])).toBeInTheDocument();
        expect(within(rows()[11]).getByText('1.0%')).toBeInTheDocument();
        const fewer = screen.getByRole('button', { name: 'Show fewer' });
        expect(fewer).toHaveAttribute('aria-expanded', 'true');
        await user.click(fewer);
        expect(rows()).toHaveLength(10);
    });

    it('no toggle when there are 10 biomes or fewer', async () => {
        renderBiomes();
        await answer('SEED_SUMMARY', SPAWN);
        await answerArea(new Int32Array([B.Plains, B.Forest]));
        expect(rows()).toHaveLength(2);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('the note mentions the height from 1.18 on, not on 1.12', async () => {
        const { unmount } = await loaded();
        expect(screen.getByText('Within 1000 blocks of spawn at Y 256.')).toBeInTheDocument();
        unmount();
        await loaded({ mcVersion: VERSIONS['1.12'], versionLabel: '1.12' });
        expect(screen.getByText('Within 1000 blocks of spawn.')).toBeInTheDocument();
    });

    it('renders an engine error from the spawn lookup, and a failed area', async () => {
        const { unmount } = renderBiomes();
        await answer('SEED_SUMMARY', { error: { code: -1, message: 'unsupported version' } });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: unsupported version');
        expect(ofKind('GET_AREA')).toHaveLength(0);
        unmount();
        clearSeedQueryCache();
        renderBiomes({ seed: '2' });
        await answer('SEED_SUMMARY', SPAWN);
        await act(async () => { qm().pendingOf('GET_AREA')[0].reject(new Error('worker crashed')); });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: worker crashed');
    });

    it('a new seed shows nothing of the previous one and asks again', async () => {
        const user = userEvent.setup();
        const { rerender } = await loaded();
        await user.click(screen.getByRole('button', { name: 'Show 2 more biomes' }));
        rerender({ seed: '42' });
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByRole('status')).toBeInTheDocument();
        await answer('SEED_SUMMARY', { ...SPAWN, spawnX: 8, spawnZ: 8 });
        expect(ofKind('GET_AREA').at(-1).data).toMatchObject({ seed: '42', startX: 2 - 250, startY: 2 - 250 });
        await answerArea();
        expect(rows()).toHaveLength(10);                               // folded again
    });
});
