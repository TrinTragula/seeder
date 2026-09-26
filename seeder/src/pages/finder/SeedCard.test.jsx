import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { useState } from 'react';
import SeedCard, { OPEN_SCROLL_GAP } from './SeedCard';
import { toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { FakeIntersectionObserver, FakeMatchMedia, FakeQueueManager } from '../../test/fakes';
import { getQueueManager, resetQueueManagerForTests } from '../../shared/engine';
import { clearSeedQueryCache } from '../../shared/hooks/useSeedQuery';
import { createThumbnailRequester } from '../../library/thumbnail';
import { shareOrDownloadCard } from './sharecard';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));
vi.mock('../../library/draw', async (importOriginal) => ({
    ...(await importOriginal()),
    DrawSeed: (await import('../../test/fakes')).FakeDrawSeed,
}));
// The card is really built (sharecard.js); only the hand-off to the browser is recorded.
vi.mock('./sharecard', async (importOriginal) => ({
    ...(await importOriginal()),
    shareOrDownloadCard: vi.fn(async () => 'downloaded'),
}));

// jsdom lays nothing out: give the thumbnail button the box a 1280-wide row has.
const box = { width: 906, height: 320 };
const setBox = () => {
    Object.defineProperty(HTMLButtonElement.prototype, 'clientWidth', { configurable: true, get: () => box.width });
    Object.defineProperty(HTMLButtonElement.prototype, 'clientHeight', { configurable: true, get: () => box.height });
};
// jsdom does not scroll: record what the row asks for.
let scrollTo;
beforeEach(() => {
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
    delete HTMLButtonElement.prototype.clientWidth;
    delete HTMLButtonElement.prototype.clientHeight;
    delete window.__seederDrawer;
});

const qm = () => FakeQueueManager.latest();
// The row's thumbnail box comes near the screen: only then does it ask for its area.
const seen = (name = 'Preview 3774') => act(() => { FakeIntersectionObserver.trigger(screen.getByRole('button', { name })); });
// Answer every strip of the row's thumbnail (thumbnail.js asks in strips of 64 rows).
const answerThumb = () => act(async () => { qm().resolveAreas(); });
const areaRequests = () => qm().requests.filter((r) => r.kind === 'GET_AREA');
const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');
const IGLOO = structure('Igloo');
const MANSION = structure('Mansion');
const FORTRESS = structure('Fortress');

const criteria = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE], rangeBlocks: 300 };
const view = (over = {}, crit = criteria) => toHitView({
    seed: 3774n, spawnX: -32, spawnZ: 80, index: 0,
    structures: [{ type: VILLAGE, x: 96, z: -80 }],
    ...over,
}, crit);

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
});

describe('SeedCard', () => {
    it('shows the seed with a Copy button that copies it', async () => {
        render(<SeedCard view={view()} />);
        const card = screen.getByTestId('seed-card');
        expect(within(card).getByText('3774', { selector: 'code' })).toBeInTheDocument();
        await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Copy' })); });
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('3774');
    });

    it('once near the screen, asks for the opened map\'s first frame: its box at 1 px per cell, on the structure', async () => {
        setBox();
        const thumbs = createThumbnailRequester(getQueueManager());
        render(<SeedCard view={view()} thumbnails={thumbs} />);
        const preview = screen.getByRole('button', { name: 'Preview 3774' });
        expect(preview).toHaveAttribute('aria-expanded', 'false');
        expect(preview.querySelector('canvas')).toBeNull();
        expect(preview.querySelector('.seed-card__placeholder')).not.toBeNull();
        // Lazy: a row below the fold costs the engine nothing.
        expect(qm().pendingOf('GET_AREA')).toHaveLength(0);
        await seen();
        const strips = qm().pendingOf('GET_AREA');
        // 906 × 320 cells centred on the village's cell (24, -20), as DrawSeed.panTo(96, -80) centres it.
        expect(strips[0].data).toMatchObject({ seed: '3774', startX: -429, startY: -180, widthX: 906, widthY: 64, dimension: 0 });
        expect(strips.map((r) => r.data.widthY).reduce((a, b) => a + b)).toBe(320);
        await answerThumb();
        const canvas = preview.querySelector('canvas');
        expect([canvas.width, canvas.height]).toEqual([906, 320]);
        expect(preview.querySelector('.seed-card__placeholder')).toBeNull();
        expect(screen.getByText('Around (96, -80)')).toBeInTheDocument();
    });

    it('says on the thumbnail that it opens the map, before and after the picture lands, without renaming the button', async () => {
        setBox();
        const onOpen = vi.fn();
        render(<SeedCard view={view()} thumbnails={createThumbnailRequester(getQueueManager())} onOpen={onOpen} />);
        const preview = screen.getByRole('button', { name: 'Preview 3774' });
        // Both wordings are in the page; CSS shows the one for the device's pointer.
        expect(within(preview).getByText('Click to explore the map')).toBeInTheDocument();
        expect(within(preview).getByText('Tap to explore the map')).toBeInTheDocument();
        await seen();
        await answerThumb();
        expect(preview.querySelector('canvas')).not.toBeNull();
        expect(within(preview).getByText('Click to explore the map')).toBeInTheDocument();
        expect(preview).toHaveAccessibleName('Preview 3774');
        // A click on the band is a click on the thumbnail.
        fireEvent.click(within(preview).getByText('Click to explore the map'));
        expect(onOpen).toHaveBeenCalledWith('3774');
    });

    it('looks two screens ahead, and an eager row (one of the first) asks at once, unseen', () => {
        setBox();
        const thumbs = createThumbnailRequester(getQueueManager());
        render(<SeedCard view={view()} thumbnails={thumbs} />);
        const watching = FakeIntersectionObserver.live().find((o) => o.targets.includes(screen.getByRole('button', { name: 'Preview 3774' })));
        expect(watching.options.rootMargin).toBe('200% 0px');
        expect(qm().pendingOf('GET_AREA')).toHaveLength(0);
        render(<SeedCard view={view({ seed: 42n })} thumbnails={thumbs} eager />);
        expect(qm().pendingOf('GET_AREA').map((r) => r.data.seed)).toEqual(Array(5).fill('42'));
    });

    it('a biome-only row is centred on its spawn, like the map it opens into', async () => {
        setBox();
        render(<SeedCard view={view({ structures: [] })} thumbnails={createThumbnailRequester(getQueueManager())} />);
        await seen();
        // Spawn (-32, 80) is cell (-8, 20).
        expect(qm().pendingOf('GET_AREA')[0].data).toMatchObject({ startX: -461, startY: -140, widthX: 906 });
        expect(screen.getByText('Around (-32, 80)')).toBeInTheDocument();
    });

    it('marks the Overworld spawn on the thumbnail, and no spawn on a Nether row', async () => {
        setBox();
        const thumbs = createThumbnailRequester(getQueueManager());
        const request = vi.spyOn(thumbs, 'request');
        render(<SeedCard view={view({ structures: [] })} thumbnails={thumbs} eager />);
        expect(request.mock.calls[0][0].spawn).toEqual({ x: -32, z: 80 });
        render(<SeedCard view={view({ seed: 7n, structures: [] }, { ...criteria, dimension: -1 })} thumbnails={thumbs} eager />);
        expect(request.mock.calls[1][0].spawn).toBeNull();
    });

    it('a box without a layout asks for no thumbnail', () => {
        render(<SeedCard view={view()} thumbnails={createThumbnailRequester(getQueueManager())} />);
        expect(qm().pendingOf('GET_AREA')).toHaveLength(0);
    });

    it('the Spawn row shows the coordinates, then the biome from BIOME_AT', async () => {
        render(<SeedCard view={view({}, { ...criteria, yHeight: 64 })} />);
        const spawn = screen.getByText('Spawn', { selector: 'dt' }).nextElementSibling;
        expect(spawn).toHaveTextContent('(-32, 80)');
        const [asked] = qm().pendingOf('BIOME_AT');
        expect(asked.data).toEqual({ mcVersion: VERSIONS['26.3'], seed: '3774', dimension: 0, x: -32, y: 64, z: 80 });
        expect(asked.opts.priority).toBe('low');
        await act(async () => { qm().resolveRequest('BIOME_AT', { biome: biome('Plains') }); });
        expect(spawn).toHaveTextContent('Plains');
        expect(spawn.querySelector('[aria-hidden="true"].swatch')).not.toBeNull();
    });

    it('a Nether hit asks for the biome at the Overworld spawn and says so', () => {
        render(<SeedCard view={view({ structures: [{ type: FORTRESS, x: 40, z: -200 }] }, { ...criteria, structures: [FORTRESS], dimension: -1 })} />);
        expect(screen.getByText('Overworld spawn', { selector: 'dt' })).toBeInTheDocument();
        expect(qm().pendingOf('BIOME_AT')[0].data.dimension).toBe(0);
    });

    it('lists the structures nearest first, with coordinates, distance and badges', async () => {
        render(<SeedCard view={view({ structures: [{ type: MANSION, x: 300, z: 0 }, { type: VILLAGE, x: 96, z: -80 }] })} />);
        const rows = within(screen.getByRole('list', { name: 'Structures' })).getAllByRole('listitem');
        expect(rows.map((r) => r.textContent.replace(/\s+/g, ' '))).toEqual([
            expect.stringMatching(/^Village.*\(96, -80\)125 blocks$/),
            expect.stringMatching(/^Mansion.*\(300, 0\)300 blocks$/),
        ]);
        // Only the Village can carry a badge.
        const asked = qm().pendingOf('STRUCTURE_VARIANT');
        expect(asked.map((r) => r.data)).toEqual([{ mcVersion: VERSIONS['26.3'], seed: '3774', dimension: 0, type: VILLAGE, x: 96, z: -80 }]);
        expect(asked[0].opts.priority).toBe('low');
        await act(async () => {
            qm().resolveRequest('STRUCTURE_VARIANT', { variant: { supported: 1, abandoned: 1, start: 0, biome: biome('Plains') } });
        });
        expect(within(rows[0]).getByText('Zombie village')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Plains village')).toBeInTheDocument();
    });

    it('asks variants for the first three variant-carrying rows only', () => {
        const structures = [
            { type: MANSION, x: 10, z: 0 },
            { type: VILLAGE, x: 20, z: 0 },
            { type: IGLOO, x: 30, z: 0 },
            { type: VILLAGE, x: 40, z: 0 },
            { type: IGLOO, x: 50, z: 0 },
        ];
        render(<SeedCard view={view({ structures })} />);
        expect(qm().pendingOf('STRUCTURE_VARIANT').map((r) => r.data.x)).toEqual([20, 30, 40]);
    });

    it('a biome-only hit has no structures list', () => {
        render(<SeedCard view={view({ structures: [] })} />);
        expect(screen.queryByRole('list', { name: 'Structures' })).toBeNull();
    });

    it('Open seed links the canonical seed URL, with dim for a Nether hit, in a new tab', () => {
        const { unmount } = render(<SeedCard view={view()} />);
        const open = screen.getByRole('link', { name: 'Open seed' });
        expect(open).toHaveAttribute('href', '/seed/?seed=3774&version=26.3');
        expect(open).toHaveAttribute('target', '_blank');
        expect(open).toHaveAttribute('rel', 'noopener');
        unmount();
        render(<SeedCard view={view({ seed: -9223372036854775808n }, { ...criteria, structures: [FORTRESS], dimension: -1 })} />);
        expect(screen.getByRole('link', { name: 'Open seed' })).toHaveAttribute('href', '/seed/?seed=-9223372036854775808&version=26.3&dim=-1');
    });

    it('Save world hands the view to onSave; a saved world says so and is disabled', () => {
        const onSave = vi.fn();
        const v = view();
        const { rerender } = render(<SeedCard view={v} onSave={onSave} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save world' }));
        expect(onSave).toHaveBeenCalledWith(v);
        rerender(<SeedCard view={v} onSave={onSave} saved />);
        expect(screen.queryByRole('button', { name: 'Save world' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeDisabled();
    });

    it('clicking the thumbnail opens the row; open, the map takes its place with Close preview', async () => {
        const onOpen = vi.fn();
        const onClose = vi.fn();
        const v = view();
        const { rerender } = render(<SeedCard view={v} onOpen={onOpen} onClose={onClose} />);
        expect(screen.queryByRole('button', { name: 'Close preview' })).toBeNull();
        expect(screen.queryByLabelText('Biome map')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
        expect(onOpen).toHaveBeenCalledWith('3774');

        rerender(<SeedCard view={v} onOpen={onOpen} onClose={onClose} open />);
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByRole('button', { name: 'Preview 3774' })).toBeNull();
        expect(screen.queryByText('Around (0, 0)')).toBeNull();
        expect(screen.getByLabelText('Biome map')).toBeInTheDocument();
        expect(window.__seederDrawer.seed).toBe('3774');
        expect(window.__seederDrawer.highlight).toEqual({ x: 96, z: -80, label: 'Village' });
        // The details stay below the map.
        expect(screen.getByRole('list', { name: 'Structures' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
        expect(onClose).toHaveBeenCalledWith('3774');

        rerender(<SeedCard view={v} onOpen={onOpen} onClose={onClose} />);
        expect(screen.getByRole('button', { name: 'Preview 3774' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Biome map')).toBeNull();
    });

    it('a thumbnail drawn before opening comes back when the row closes', async () => {
        setBox();
        const thumbs = createThumbnailRequester(getQueueManager());
        const v = view();
        const { rerender } = render(<SeedCard view={v} thumbnails={thumbs} />);
        await seen();
        await answerThumb();
        const canvas = screen.getByRole('button', { name: 'Preview 3774' }).querySelector('canvas');
        rerender(<SeedCard view={v} thumbnails={thumbs} open />);
        rerender(<SeedCard view={v} thumbnails={thumbs} />);
        expect(screen.getByRole('button', { name: 'Preview 3774' }).querySelector('canvas')).toBe(canvas);
        expect(areaRequests()).toHaveLength(5);
    });
    it('"Share image" is disabled until the row\'s canvas exists, then shares a 1200×630 card of it', async () => {
        setBox();
        shareOrDownloadCard.mockClear();
        const thumbs = createThumbnailRequester(getQueueManager());
        const v = view();
        const { rerender } = render(<SeedCard view={v} thumbnails={thumbs} criteriaSummary="Village · 300 blocks · 26.3 · Overworld" />);
        const button = screen.getByRole('button', { name: 'Share image' });
        expect(button).toBeDisabled();
        await seen();
        await answerThumb();
        const thumb = screen.getByRole('button', { name: 'Preview 3774' }).querySelector('canvas');
        expect(button).toBeEnabled();
        await act(async () => { fireEvent.click(button); });
        expect(shareOrDownloadCard).toHaveBeenCalledTimes(1);
        const [card, seed] = shareOrDownloadCard.mock.calls[0];
        expect(seed).toBe('3774');
        expect([card.width, card.height]).toEqual([1200, 630]);
        const ctx = card.getContext('2d');
        // Cropped from the row's own canvas, which stays in the row.
        expect(ctx.callsOf('drawImage')[0].args[0]).toBe(thumb);
        expect(thumb.parentNode).not.toBeNull();
        expect(ctx.callsOf('fillText').map((c) => c.args[0])).toContain('Village | 300 blocks | 26.3 | Overworld');
        // Two quick taps while the first share is still in flight share once.
        shareOrDownloadCard.mockClear();
        let finish;
        shareOrDownloadCard.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await act(async () => {
            fireEvent.click(button);
            fireEvent.click(button);
        });
        await act(async () => { finish('shared'); });
        expect(shareOrDownloadCard).toHaveBeenCalledTimes(1);
        // Open, the cached canvas still counts.
        rerender(<SeedCard view={v} thumbnails={thumbs} open criteriaSummary="x" />);
        expect(screen.getByRole('button', { name: 'Share image' })).toBeEnabled();
        expect(areaRequests()).toHaveLength(5);
    });

    it('an unverified row shows its name and a "Not found within" badge, no coordinates, no badges request, no marker', async () => {
        setBox();
        const thumbs = createThumbnailRequester(getQueueManager());
        const v = view({ structures: [{ type: MANSION, x: null, z: null, verified: false }, { type: VILLAGE, x: 96, z: -80 }] });
        render(<SeedCard view={v} thumbnails={thumbs} />);
        const rows = within(screen.getByRole('list', { name: 'Structures' })).getAllByRole('listitem');
        expect(rows.map((r) => r.textContent.replace(/\s+/g, ' '))).toEqual([
            expect.stringMatching(/^Village.*\(96, -80\)125 blocks$/),
            'MansionNot found within 300 blocks',
        ]);
        expect(rows[1].querySelector('code')).toBeNull();
        expect(within(rows[1]).getByText('Not found within 300 blocks')).toBeInTheDocument();
        // Variants and thumbnail markers are asked for the found village only.
        expect(qm().pendingOf('STRUCTURE_VARIANT').map((r) => r.data.type)).toEqual([VILLAGE]);
        await seen();
        await answerThumb();
        const ctx = screen.getByRole('button', { name: 'Preview 3774' }).querySelector('canvas').getContext('2d');
        // The spawn's house, then one marker, the village's outlined icon (after the biome bitmap).
        const icons = ctx.callsOf('drawImage').slice(1).map((c) => c.args[0].getContext('2d').callsOf('drawImage').at(-1).args[0]);
        expect(icons.map((icon) => new URL(icon.src).pathname)).toEqual(['/img/spawn.png', '/img/village.png']);
        expect(ctx.callsOf('fillRect')).toEqual([]);
    });

    it('an open shared row previews its found structure, never an unverified one', async () => {
        const v = view({ structures: [{ type: MANSION, x: null, z: null, verified: false }] });
        render(<SeedCard view={v} open />);
        await act(async () => { await Promise.resolve(); });
        // Nothing found: the Overworld spawn, like a biome-only hit.
        expect(window.__seederDrawer.highlight).toEqual({ x: -32, z: 80, label: 'Spawn' });
    });

    it('shows the warning of a seed the engine could not describe', () => {
        render(<SeedCard view={{ ...view({ structures: [], spawnX: 0, spawnZ: 0 }), warning: 'The engine could not describe this seed on 26.3.' }} />);
        expect(screen.getByText('The engine could not describe this seed on 26.3.')).toBeInTheDocument();
    });

    describe('opening scrolls the row to the top of the screen', () => {
        // The row at `top` px from the viewport's top, the page scrolled by `scrollY`.
        const place = (top, scrollY) => {
            Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
                return this.matches('[data-testid="seed-card"]')
                    ? { top, bottom: top + 700, left: 0, right: 900, width: 900, height: 700, x: 0, y: top }
                    : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
            });
        };
        afterEach(() => { delete window.scrollY; });

        function Opener() {
            const [open, setOpen] = useState(false);
            return <SeedCard view={view()} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />;
        }

        it(`smoothly, ${OPEN_SCROLL_GAP} px under the top edge, from wherever the row was`, () => {
            render(<Opener />);
            place(612, 1500);
            fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
            expect(scrollTo).toHaveBeenCalledTimes(1);
            expect(scrollTo).toHaveBeenCalledWith({ top: 1500 + 612 - OPEN_SCROLL_GAP, behavior: 'smooth' });
        });

        it('also when the row is above the viewport (scrolls up), never above the page top', () => {
            render(<Opener />);
            place(-300, 1000);
            fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
            expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000 - 300 - OPEN_SCROLL_GAP, behavior: 'smooth' });
            place(4, 0);
            fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
            fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
            expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
        });

        it('instantly under prefers-reduced-motion', () => {
            FakeMatchMedia.set('(prefers-reduced-motion: reduce)', true);
            render(<Opener />);
            place(400, 0);
            fireEvent.click(screen.getByRole('button', { name: 'Preview 3774' }));
            expect(scrollTo).toHaveBeenCalledWith({ top: 400 - OPEN_SCROLL_GAP, behavior: 'auto' });
        });

        it('only when the user opened it: an open prop alone, or closing, never scrolls', () => {
            const { rerender } = render(<SeedCard view={view()} />);
            rerender(<SeedCard view={view()} open />);
            rerender(<SeedCard view={view()} />);
            expect(scrollTo).not.toHaveBeenCalled();
        });
    });
});
