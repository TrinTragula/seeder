// The bottom sheet as a user drives it: toggle, Escape, drags and flicks, and the
// touch pull-down. jsdom lays nothing out, so the sheet's area is mocked to 800px
// (an 848px phone under a 48px header) and performance.now() is mocked so
// velocities are exact.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import BottomSheet, { COMMIT, SLOP } from './BottomSheet';

let now = 0;
const at = (t) => { now = t; };

let api;
let go;
function Sheet({ onSnapChange, children }) {
    const ref = useRef(null);
    api = ref;
    return (
        <BottomSheet
            header={<div><input aria-label="Header field" /><button type="button" onClick={() => go()}>GO</button></div>}
            apiRef={ref}
            onSnapChange={onSnapChange}
            ariaLabel="World details"
            contentId="sheet-content"
        >
            {children ?? <p>Panel body</p>}
        </BottomSheet>
    );
}

const root = () => document.querySelector('.sheet');
const snap = () => root().getAttribute('data-snap');
const panel = () => screen.getByRole('region', { name: 'World details' });
const grip = () => document.querySelector('.sheet__grip');
const toggle = () => screen.getByRole('button', { name: 'Toggle world details' });
const dragging = () => panel().classList.contains('is-dragging');
const content = () => document.querySelector('.sheet__content');
const goButton = () => screen.getByRole('button', { name: 'GO' });
// jsdom never scrolls: pin what the content reports.
const scrolledTo = (top) => Object.defineProperty(content(), 'scrollTop', { value: top, configurable: true, writable: true });
const touches = (y, x = 0) => [{ identifier: 7, clientX: x, clientY: y }];

// One pointer gesture: [t, clientY] steps, the first is the press, the last the release.
function gesture(target, steps, { end = 'up' } = {}) {
    const [[t0, y0], ...rest] = steps;
    at(t0);
    fireEvent.pointerDown(target, { clientY: y0, pointerId: 1 });
    rest.forEach(([t, y], i) => {
        at(t);
        if (i < rest.length - 1) fireEvent.pointerMove(target, { clientY: y, pointerId: 1 });
        else if (end === 'up') fireEvent.pointerUp(target, { clientY: y, pointerId: 1 });
        else fireEvent.pointerCancel(target, { clientY: y, pointerId: 1 });
    });
}

beforeEach(() => {
    go = vi.fn();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 48, bottom: 848, height: 800, left: 0, right: 412, width: 412, x: 0, y: 48,
    });
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('at rest', () => {
    it('starts collapsed, with a toggle that controls the content', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        expect(snap()).toBe('collapsed');
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(toggle()).toHaveAttribute('aria-controls', 'sheet-content');
        expect(document.getElementById('sheet-content')).toBe(document.querySelector('.sheet__content'));
        expect(document.getElementById('sheet-content')).toHaveTextContent('Panel body');
        expect(onSnapChange).not.toHaveBeenCalled();
        expect(dragging()).toBe(false);
    });

    it('the toggle cycles collapsed → half → full → collapsed and reports each snap', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        fireEvent.click(toggle());
        expect(snap()).toBe('half');
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(onSnapChange).toHaveBeenLastCalledWith('half');
        fireEvent.click(toggle());
        expect(snap()).toBe('full');
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(toggle());
        expect(snap()).toBe('collapsed');
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(onSnapChange.mock.calls).toEqual([['half'], ['full'], ['collapsed']]);
    });

    it('apiRef opens, closes and reports the snap, and is released on unmount', () => {
        const onSnapChange = vi.fn();
        const { unmount } = render(<Sheet onSnapChange={onSnapChange} />);
        const ref = api;
        expect(ref.current.getSnap()).toBe('collapsed');
        act(() => ref.current.open('full'));
        expect(snap()).toBe('full');
        expect(ref.current.getSnap()).toBe('full');
        act(() => ref.current.close());
        expect(snap()).toBe('collapsed');
        act(() => ref.current.open());
        expect(snap()).toBe('half');
        expect(onSnapChange.mock.calls).toEqual([['full'], ['collapsed'], ['half']]);
        unmount();
        expect(ref.current).toBeNull();
    });

    it('Escape collapses an open sheet and does nothing when already collapsed', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(snap()).toBe('collapsed');
        expect(onSnapChange).not.toHaveBeenCalled();

        act(() => api.current.open('full'));
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(snap()).toBe('collapsed');
        expect(onSnapChange).toHaveBeenLastCalledWith('collapsed');
    });

    it('leaves an Escape that a control already handled alone (an open select menu closes first)', () => {
        render(<Sheet />);
        act(() => api.current.open('half'));
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        event.preventDefault();
        act(() => { document.body.dispatchEvent(event); });
        expect(snap()).toBe('half');
    });

    it('keeps its children mounted at every snap', () => {
        function Counter() {
            const [n, setN] = useState(0);
            return <button type="button" onClick={() => setN(n + 1)}>{`count ${n}`}</button>;
        }
        render(<Sheet><Counter /></Sheet>);
        fireEvent.click(screen.getByRole('button', { name: 'count 0' }));
        fireEvent.click(toggle());
        fireEvent.click(toggle());
        fireEvent.click(toggle());
        expect(snap()).toBe('collapsed');
        expect(screen.getByRole('button', { name: 'count 1' })).toBeInTheDocument();
    });
});

describe('dragging', () => {
    it('follows the finger from the slop\'s edge with an inline --visible, and settles past COMMIT', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        at(0);
        fireEvent.pointerDown(grip(), { clientY: 800, pointerId: 1 });
        at(1000);
        fireEvent.pointerMove(grip(), { clientY: 480, pointerId: 1 });
        expect(dragging()).toBe(true);
        expect(panel().style.getPropertyValue('--visible')).toBe('384px');   // 72 + 320 - SLOP: no jump at the start
        expect(snap()).toBe('collapsed');
        fireEvent.pointerUp(grip(), { clientY: 480, pointerId: 1 });
        expect(snap()).toBe('half');
        expect(dragging()).toBe(false);
        expect(panel().style.getPropertyValue('--visible')).toBe('');
        expect(onSnapChange.mock.calls).toEqual([['half']]);
    });

    it('never drags past the collapsed height or the top of its area', () => {
        render(<Sheet />);
        at(0);
        fireEvent.pointerDown(grip(), { clientY: 800, pointerId: 1 });
        fireEvent.pointerMove(grip(), { clientY: 900, pointerId: 1 });
        expect(panel().style.getPropertyValue('--visible')).toBe('72px');
        fireEvent.pointerMove(grip(), { clientY: -500, pointerId: 1 });
        expect(panel().style.getPropertyValue('--visible')).toBe('800px');
        at(1000);
        fireEvent.pointerUp(grip(), { clientY: -500, pointerId: 1 });
        expect(snap()).toBe('full');
    });

    it('an upward flick goes on to the next snap even when the nearest is still collapsed', () => {
        render(<Sheet />);
        gesture(grip(), [[0, 800], [15, 770], [30, 740]]);                    // 60px in 30ms = 2 px/ms
        expect(snap()).toBe('half');
    });

    it('a slow drag shorter than COMMIT springs back; a longer one goes on the way it was dragged', () => {
        render(<Sheet />);
        expect(COMMIT).toBe(48);
        gesture(grip(), [[0, 800], [500, 780], [1000, 760]]);                 // 32 px moved, 0.04 px/ms
        expect(snap()).toBe('collapsed');
        gesture(grip(), [[0, 800], [500, 770], [1000, 740]]);                 // 52 px: nearest is still collapsed
        expect(snap()).toBe('half');
    });

    it('a slow 150 px swipe up from half ends fully open, not back at half', () => {
        render(<Sheet />);
        act(() => api.current.open('half'));
        gesture(content(), [[0, 700], [500, 625], [1000, 550]]);              // visible 542: nearest is half
        expect(snap()).toBe('full');
        act(() => api.current.open('half'));
        gesture(content(), [[0, 300], [500, 375], [1000, 450]]);              // down 142: collapsed, not half
        expect(snap()).toBe('collapsed');
    });

    it('a swipe from the content that reaches the top scrolls the content with the rest', () => {
        render(<Sheet />);
        act(() => api.current.open('half'));
        scrolledTo(0);
        at(0);
        fireEvent.pointerDown(content(), { clientY: 700, pointerId: 1 });
        at(500);
        fireEvent.pointerMove(content(), { clientY: 400, pointerId: 1 });
        expect(content().scrollTop).toBe(0);                                 // visible 692: still opening
        at(1000);
        fireEvent.pointerMove(content(), { clientY: 150, pointerId: 1 });
        // 400 + 700 - 150 - SLOP = 942 wanted: the panel stops at 800, the other 142 px scroll.
        expect(panel().style.getPropertyValue('--visible')).toBe('800px');
        expect(content().scrollTop).toBe(142);
        at(1500);
        fireEvent.pointerUp(content(), { clientY: 150, pointerId: 1 });
        expect(snap()).toBe('full');
    });

    it('a downward flick from full past half collapses the sheet', () => {
        render(<Sheet />);
        act(() => api.current.open('full'));
        gesture(grip(), [[0, 100], [20, 350], [40, 550]]);                    // visible 350, -11 px/ms
        expect(snap()).toBe('collapsed');
    });

    it('a slow drag from full to just under half settles on half', () => {
        render(<Sheet />);
        act(() => api.current.open('full'));
        gesture(grip(), [[0, 100], [500, 300], [1000, 550]]);                 // visible 350
        expect(snap()).toBe('half');
    });

    it('pointercancel settles on the nearest snap, whatever the speed', () => {
        render(<Sheet />);
        // Where the last move left it (visible 700): a cancel's own coordinates are not a position.
        gesture(grip(), [[0, 800], [10, 500], [20, 172], [30, 0]], { end: 'cancel' });
        expect(snap()).toBe('full');
        expect(dragging()).toBe(false);
    });

    it('starts from the header, once the finger has travelled more than the slop', () => {
        render(<Sheet />);
        const header = document.querySelector('.sheet__header');
        at(0);
        fireEvent.pointerDown(header, { clientY: 800, pointerId: 1 });
        expect(dragging()).toBe(false);
        fireEvent.pointerMove(header, { clientY: 800 - SLOP, pointerId: 1 });
        expect(dragging()).toBe(false);
        at(1000);
        fireEvent.pointerMove(header, { clientY: 480, pointerId: 1 });
        // From the slop's edge: 72 + 320 - SLOP, so the panel does not jump when it starts.
        expect(panel().style.getPropertyValue('--visible')).toBe('384px');
        fireEvent.pointerUp(header, { clientY: 480, pointerId: 1 });
        expect(snap()).toBe('half');
    });

    it('ignores other pointers while one drag is running', () => {
        render(<Sheet />);
        at(0);
        fireEvent.pointerDown(grip(), { clientY: 800, pointerId: 1 });
        fireEvent.pointerMove(grip(), { clientY: 780, pointerId: 1 });
        fireEvent.pointerMove(grip(), { clientY: 100, pointerId: 2 });
        expect(panel().style.getPropertyValue('--visible')).toBe('84px');
        fireEvent.pointerUp(grip(), { clientY: 100, pointerId: 2 });
        expect(dragging()).toBe(true);
        at(1000);
        fireEvent.pointerUp(grip(), { clientY: 800, pointerId: 1 });
        expect(snap()).toBe('collapsed');
        expect(dragging()).toBe(false);
    });

    it('a tap on a header button still presses it and leaves the sheet alone', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        gesture(goButton(), [[0, 800], [10, 800 - SLOP], [20, 800 - SLOP]]);
        fireEvent.click(goButton());
        expect(go).toHaveBeenCalledTimes(1);
        expect(dragging()).toBe(false);
        expect(onSnapChange).not.toHaveBeenCalled();
    });

    it('a drag that starts on a header button moves the sheet, and its click is swallowed', async () => {
        render(<Sheet />);
        gesture(goButton(), [[0, 800], [500, 640], [1000, 480]]);
        expect(snap()).toBe('half');
        // The click the browser sends after the release.
        fireEvent.click(goButton());
        expect(go).not.toHaveBeenCalled();
        // Only that one: the next tap works.
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
        fireEvent.click(goButton());
        expect(go).toHaveBeenCalledTimes(1);
    });

    it('a text field never drags, and a sideways move is not the sheet\'s', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        gesture(screen.getByLabelText('Header field'), [[0, 800], [15, 500], [30, 200]]);
        expect(dragging()).toBe(false);
        at(0);
        fireEvent.pointerDown(goButton(), { clientX: 100, clientY: 800, pointerId: 1 });
        fireEvent.pointerMove(goButton(), { clientX: 160, clientY: 795, pointerId: 1 });
        fireEvent.pointerMove(goButton(), { clientX: 160, clientY: 400, pointerId: 1 });
        expect(dragging()).toBe(false);
        fireEvent.pointerUp(goButton(), { clientX: 160, clientY: 400, pointerId: 1 });
        expect(onSnapChange).not.toHaveBeenCalled();
    });

    it('collapsed or half open, a swipe on the content moves the sheet, either way', () => {
        render(<Sheet />);
        gesture(screen.getByText('Panel body'), [[0, 800], [15, 770], [30, 740]]);   // flick up
        expect(snap()).toBe('half');
        scrolledTo(200);   // even scrolled: at half the content does not scroll, the sheet moves
        gesture(content(), [[0, 400], [500, 250], [1000, 100]]);                    // visible 700
        expect(snap()).toBe('full');
        act(() => api.current.open('half'));
        gesture(content(), [[0, 400], [500, 550], [1000, 700]]);                    // visible 100
        expect(snap()).toBe('collapsed');
    });

    it('fully open, the content scrolls: up is its own, down only drags from the top', () => {
        const onSnapChange = vi.fn();
        render(<Sheet onSnapChange={onSnapChange} />);
        act(() => api.current.open('full'));
        onSnapChange.mockClear();
        scrolledTo(0);
        gesture(content(), [[0, 500], [500, 300], [1000, 100]]);
        expect(snap()).toBe('full');
        scrolledTo(120);
        gesture(content(), [[0, 100], [500, 300], [1000, 450]]);
        expect(snap()).toBe('full');
        expect(onSnapChange).not.toHaveBeenCalled();
        // At the top, pulling down takes the sheet with it (a mouse or pen; a finger is below).
        scrolledTo(0);
        gesture(content(), [[0, 100], [500, 300], [1000, 450]]);                    // visible 450
        expect(snap()).toBe('half');
    });

    it('fully open, a finger pulling down from the top of the content drags the sheet (touch events)', () => {
        render(<Sheet />);
        act(() => api.current.open('full'));
        scrolledTo(0);
        // The pointer side of a touch stays out of it: the browser owns a pan-y pointer.
        fireEvent.pointerDown(content(), { clientY: 100, pointerId: 3, pointerType: 'touch' });
        at(0);
        fireEvent.touchStart(content(), { touches: touches(100), changedTouches: touches(100) });
        at(500);
        // Claimed: the move is cancelled so the content does not scroll under the drag.
        expect(fireEvent.touchMove(content(), { touches: touches(300), changedTouches: touches(300) })).toBe(false);
        expect(dragging()).toBe(true);
        expect(panel().style.getPropertyValue('--visible')).toBe('600px');
        at(1000);
        fireEvent.touchMove(content(), { touches: touches(450), changedTouches: touches(450) });
        fireEvent.touchEnd(content(), { touches: [], changedTouches: touches(450) });
        fireEvent.pointerUp(content(), { clientY: 450, pointerId: 3, pointerType: 'touch' });
        expect(snap()).toBe('half');
        expect(dragging()).toBe(false);
    });

    it('fully open, a finger scrolls the content when it is scrolled down or moves up', () => {
        render(<Sheet />);
        act(() => api.current.open('full'));
        for (const [top, from, to] of [[120, 100, 300], [0, 300, 100]]) {
            scrolledTo(top);
            fireEvent.touchStart(content(), { touches: touches(from), changedTouches: touches(from) });
            expect(fireEvent.touchMove(content(), { touches: touches(to), changedTouches: touches(to) })).toBe(true);
            fireEvent.touchEnd(content(), { touches: [], changedTouches: touches(to) });
            expect(dragging()).toBe(false);
            expect(snap()).toBe('full');
        }
    });

    it('stops listening when it unmounts in the middle of a drag', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<Sheet />);
        fireEvent.pointerDown(grip(), { clientY: 800, pointerId: 1 });
        unmount();
        expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
    });
});
