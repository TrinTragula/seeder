import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useState } from 'react';
import ResultsGrid from './ResultsGrid';
import { toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { FakeDrawSeed, FakeIntersectionObserver, FakeQueueManager } from '../../test/fakes';
import { resetQueueManagerForTests } from '../../shared/engine';
import { clearSeedQueryCache } from '../../shared/hooks/useSeedQuery';
import { shareOrDownloadCard } from './sharecard';
import { AD_SLOT_FINDER_INFEED, isPlaceholderSlot } from '../../shared/ads';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));
vi.mock('../../library/draw', async (importOriginal) => ({
    ...(await importOriginal()),
    DrawSeed: (await import('../../test/fakes')).FakeDrawSeed,
}));
vi.mock('./sharecard', async (importOriginal) => ({
    ...(await importOriginal()),
    shareOrDownloadCard: vi.fn(async () => 'downloaded'),
}));

const hits = (n) => Array.from({ length: n }, (_, i) => toHitView({ seed: BigInt(1000 + i), spawnX: 0, spawnZ: 0, index: i }, DEFAULT_CRITERIA));
const flush = () => act(async () => { await Promise.resolve(); });

// The page's open-row state, like FinderPage.
function Harness({ list, initial = null, onOpen = () => {}, onClose = () => {} }) {
    const [open, setOpen] = useState(initial);
    return (
        <ResultsGrid
            hits={list}
            thumbnails={null}
            openSeed={open}
            onOpen={(seed) => { onOpen(seed); setOpen(seed); }}
            onClose={(seed) => { onClose(seed); setOpen((s) => (s === seed ? null : s)); }}
            saved={() => false}
            onSave={() => {}}
        />
    );
}

beforeEach(() => {
    // jsdom does not scroll; an opened row asks it to (SeedCard's tests pin how).
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    FakeDrawSeed.reset();
    clearSeedQueryCache();
});
afterEach(() => {
    vi.restoreAllMocks();
    delete window.__seederDrawer;
});

describe('ResultsGrid', () => {
    it('is a list of rows, one list item per seed, in the order found', () => {
        render(<Harness list={hits(3)} />);
        const list = screen.getByRole('list', { name: 'Seeds found' });
        const items = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
        expect(items.map((li) => within(li).getByTestId('seed-card').querySelector('code').textContent)).toEqual(['1000', '1001', '1002']);
    });

    it('12 hits: an in-feed unit after the 5th and the 10th row', () => {
        const { container } = render(<Harness list={hits(12)} />);
        const children = [...container.querySelector('.results-grid').children];
        const ads = children.filter((el) => el.classList.contains('ad'));
        expect(ads).toHaveLength(2);
        expect(children.indexOf(ads[0])).toBe(5);
        expect(children.indexOf(ads[1])).toBe(11);
        // A dashed placeholder in dev until the in-feed ids are configured, a real unit after.
        if (isPlaceholderSlot(AD_SLOT_FINDER_INFEED)) expect(ads[0]).toHaveTextContent('Ad (slot not configured)');
        else expect(ads[0].querySelector('ins')).toHaveAttribute('data-ad-slot', AD_SLOT_FINDER_INFEED);
    });

    it('nothing is open at first; a click opens that row only, and opening another closes it', async () => {
        render(<Harness list={hits(3)} />);
        expect(screen.queryByLabelText('Biome map')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1001' }));
        await flush();
        expect(screen.getAllByLabelText('Biome map')).toHaveLength(1);
        expect(within(screen.getAllByTestId('seed-card')[1]).getByLabelText('Biome map')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1002' }));
        await flush();
        expect(screen.getAllByLabelText('Biome map')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Preview 1001' })).toBeInTheDocument();
        expect(FakeDrawSeed.latest().seed).toBe('1002');
    });

    it('opening moves the focus to Close preview; closing moves it back to the thumbnail', async () => {
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        render(<Harness list={hits(2)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview 1000' }));
        await flush();
        const close = screen.getByRole('button', { name: 'Close preview' });
        expect(close).toHaveFocus();
        // Moved without a focus scroll, which would fight the row's own scroll to the top.
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        fireEvent.click(close);
        await flush();
        expect(screen.getByRole('button', { name: 'Preview 1000' })).toHaveFocus();
    });

    it('Escape closes the open row and refocuses its thumbnail', async () => {
        const onClose = vi.fn();
        render(<Harness list={hits(2)} initial="1001" onClose={onClose} />);
        await flush();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Close preview' }), { key: 'Escape' });
        await flush();
        expect(onClose).toHaveBeenCalledWith('1001');
        expect(screen.queryByLabelText('Biome map')).toBeNull();
        expect(screen.getByRole('button', { name: 'Preview 1001' })).toHaveFocus();
    });

    it('ArrowDown / ArrowUp move the focus between rows (an open row: its Close button) without opening', async () => {
        const onOpen = vi.fn();
        render(<Harness list={hits(3)} initial="1001" onOpen={onOpen} />);
        await flush();
        const first = screen.getByRole('button', { name: 'Preview 1000' });
        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(screen.getByRole('button', { name: 'Close preview' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
        expect(screen.getByRole('button', { name: 'Preview 1002' })).toHaveFocus();
        // The last row stays put; up goes back.
        fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
        expect(screen.getByRole('button', { name: 'Preview 1002' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
        fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
        expect(first).toHaveFocus();
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('hands criteriaSummary to every row: its share card prints it', async () => {
        // A requester that answers at once, and a laid-out thumbnail box.
        Object.defineProperty(HTMLButtonElement.prototype, 'clientWidth', { configurable: true, get: () => 400 });
        Object.defineProperty(HTMLButtonElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });
        const thumbnails = { request: (spec, onReady) => { const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200; onReady({ canvas }); } };
        try {
            render(<ResultsGrid hits={hits(2)} thumbnails={thumbnails} openSeed={null} onOpen={vi.fn()} onClose={vi.fn()} saved={() => false} onSave={vi.fn()} criteriaSummary="Village · 300 blocks" />);
            act(() => { for (const b of screen.getAllByRole('button', { name: /^Preview / })) FakeIntersectionObserver.trigger(b); });
            const buttons = screen.getAllByRole('button', { name: 'Share image' });
            expect(buttons).toHaveLength(2);
            await act(async () => { fireEvent.click(buttons[1]); });
            const [card, seed] = shareOrDownloadCard.mock.calls.at(-1);
            expect(seed).toBe('1001');
            expect(card.getContext('2d').callsOf('fillText').map((c) => c.args[0])).toContain('Village | 300 blocks');
        } finally {
            delete HTMLButtonElement.prototype.clientWidth;
            delete HTMLButtonElement.prototype.clientHeight;
        }
    });

    it('saved() decides each row\'s Save world state', () => {
        render(<ResultsGrid hits={hits(2)} thumbnails={null} openSeed={null} onOpen={vi.fn()} onClose={vi.fn()} saved={(v) => v.seed === '1000'} onSave={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeDisabled();
        expect(screen.getAllByRole('button', { name: 'Save world' })).toHaveLength(1);
    });
});
