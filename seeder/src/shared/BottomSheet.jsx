import { useCallback, useEffect, useRef, useState } from 'react';
import './BottomSheet.css';

const SNAPS = ['collapsed', 'half', 'full'];
// The toggle cycles through the snaps; Escape and close() always collapse.
const TOGGLE_NEXT = { collapsed: 'half', half: 'full', full: 'collapsed' };
// `collapsed` must equal --sheet-collapsed (tokens.css): CSS positions the resting
// sheet, these numbers only drive the drag maths. Values <= 1 are fractions of the
// sheet's area, larger ones pixels.
const DEFAULT_SNAPS = { collapsed: 72, half: 0.5, full: 1 };

// A press on one of these is never a drag: typing, selecting text and opening a menu
// need the finger. Buttons, tabs and links do drag once the finger travels (SLOP): the
// collapsed header is almost all tabs and the seed row's buttons, and a sheet that only
// moved from its thin grip felt broken.
const NO_DRAG = 'input, select, textarea, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="slider"]';
// Travel (px) before a press becomes a drag; below it a press stays a tap (a click).
export const SLOP = 8;
// Faster than this (px/ms) on release goes on to the next snap in that direction.
// Velocity is measured over the last WINDOW_MS.
const FLICK = 0.5;
const WINDOW_MS = 80;
// A slower release that moved the sheet at least COMMIT px settles on the nearest snap
// in the direction it was dragged, never back where it started; a shorter one springs
// back. (Nearest-overall made a 150 px swipe up from half slide back down by itself.)
export const COMMIT = 48;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/*
 * The mobile seed page's bottom sheet. The root covers its positioned
 * parent (the map area under the header) but lets every pointer through; only the
 * panel takes pointers, so the sheet never shares a gesture with the canvas. The
 * resting position comes from CSS per `data-snap`; while a drag is running the panel
 * follows the finger through an inline `--visible`. Uncontrolled: `initial` is the
 * first snap, `apiRef.current = { open(snap), close(), getSnap() }` moves it from outside,
 * and `onSnapChange(snap)` reports every change after mount. Children stay mounted at
 * every snap (ads and lazy sections rely on it).
 *
 * Gestures, like a standard sheet:
 *   - grip and header: a press anywhere, controls included (not NO_DRAG), becomes a
 *     drag after SLOP px of mostly vertical travel; the click that ends it is swallowed.
 *   - content, collapsed or half: every vertical swipe moves the sheet (CSS makes the
 *     content touch-action: none there), so swiping up opens it fully.
 *   - content, full: it scrolls natively (pan-y); at scrollTop 0 a downward swipe takes
 *     the sheet down instead, through touch events - a pan-y pointer is cancelled the
 *     moment the browser starts to scroll, so pointer events cannot see it.
 *   - a drag from the content that reaches the top of the area hands the rest of the
 *     swipe to the content's scroll, so one swipe opens the sheet and reads on.
 * The panel starts moving where the finger crossed the slop (no jump), and a release
 * settles as FLICK and COMMIT say.
 */
export default function BottomSheet({
    snapPoints = DEFAULT_SNAPS, initial = 'collapsed', header, apiRef, onSnapChange,
    ariaLabel, toggleLabel = ariaLabel ? `Toggle ${ariaLabel.toLowerCase()}` : 'Toggle panel',
    contentId, children,
}) {
    const [snap, setSnap] = useState(SNAPS.includes(initial) ? initial : 'collapsed');
    // Visible height in px while a drag is running, null at rest.
    const [dragPx, setDragPx] = useState(null);
    const rootRef = useRef(null);
    const contentRef = useRef(null);
    // The latest snap for callers outside React's render (getSnap, pointer handlers).
    const snapRef = useRef(snap);
    const drag = useRef(null);
    // Props read from handlers and effects keyed on the snap only (onSnapChange is
    // usually an inline arrow), like MapCanvas does with its callbacks.
    const props = useRef({ snapPoints, onSnapChange });
    useEffect(() => { props.current = { snapPoints, onSnapChange }; });

    const changeSnap = useCallback((next) => {
        snapRef.current = next;
        setSnap(next);
    }, []);

    // Reported from an effect so every path (toggle, drag, Escape, apiRef) is covered
    // exactly once, and the initial snap is not a "change".
    const reported = useRef(snap);
    useEffect(() => {
        if (reported.current === snap) return;
        reported.current = snap;
        props.current.onSnapChange?.(snap);
    }, [snap]);

    useEffect(() => {
        if (!apiRef) return undefined;
        apiRef.current = {
            open: (to = 'half') => changeSnap(SNAPS.includes(to) ? to : 'half'),
            close: () => changeSnap('collapsed'),
            getSnap: () => snapRef.current,
        };
        return () => { apiRef.current = null; };
    }, [apiRef, changeSnap]);

    // Escape collapses an open sheet, unless a control already used the key (an open
    // react-select menu closes itself and marks the event handled).
    useEffect(() => {
        if (snap === 'collapsed') return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) changeSnap('collapsed');
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [snap, changeSnap]);

    // Pixel height of each snap for an area `height` px tall.
    const snapPixels = (height) => SNAPS.map((name) => {
        const value = props.current.snapPoints[name];
        return { name, px: value <= 1 ? value * height : value };
    });

    // --- the drag engine, fed by pointers (grip, header, content) or touches (content) ---

    // startY: where the panel starts following the finger; t0: the press, for the
    // velocity. `scroller`: the content, when the drag started there (see follow).
    const beginDrag = (startY, t0, scroller = null) => {
        const height = rootRef.current.getBoundingClientRect().height;
        const snaps = snapPixels(height);
        // From the resting position of the current snap: the panel is only ever
        // grabbed at rest or while it animates towards that snap.
        const startVisible = snaps.find((s) => s.name === snapRef.current).px;
        drag.current = {
            height, snaps, startY, startVisible, visible: startVisible, samples: [{ t: t0, y: startY }],
            scroller, scrollStart: scroller?.scrollTop ?? 0,
        };
        setDragPx(startVisible);
    };
    const follow = (y) => {
        const d = drag.current;
        const t = performance.now();
        const raw = d.startVisible + (d.startY - y);
        d.visible = clamp(raw, d.snaps[0].px, d.height);
        // Past the top: the rest of a swipe that started on the content scrolls it.
        if (d.scroller) d.scroller.scrollTop = d.scrollStart + Math.max(0, raw - d.height);
        d.samples.push({ t, y });
        // Keep one sample older than the window so a slow drag still has a baseline.
        while (d.samples.length > 2 && d.samples[1].t < t - WINDOW_MS) d.samples.shift();
        return t;
    };
    const moveDrag = (y) => {
        follow(y);
        setDragPx(drag.current.visible);
    };
    const nearest = (visible) => drag.current.snaps.reduce((best, s) => (
        Math.abs(s.px - visible) < Math.abs(best.px - visible) ? s : best)).name;
    const settle = (next) => {
        drag.current = null;
        setDragPx(null);
        changeSnap(next);
    };
    const endDrag = (y) => {
        const t = follow(y);
        const d = drag.current;
        const first = d.samples.find((s) => s.t >= t - WINDOW_MS);
        const dt = t - first.t;
        // Positive = opening (the finger moved up).
        const velocity = dt > 0 ? (first.y - y) / dt : 0;
        const moved = d.visible - d.startVisible;
        let next;
        if (velocity > FLICK) next = (d.snaps.find((s) => s.px > d.visible) ?? d.snaps.at(-1)).name;
        else if (velocity < -FLICK) next = (d.snaps.findLast((s) => s.px < d.visible) ?? d.snaps[0]).name;
        else if (Math.abs(moved) < COMMIT) next = snapRef.current;
        else {
            // The nearest snap on the side it was dragged towards.
            const ahead = d.snaps.filter((s) => (moved > 0 ? s.px > d.startVisible : s.px < d.startVisible));
            next = ahead.reduce((best, s) => (Math.abs(s.px - d.visible) < Math.abs(best.px - d.visible) ? s : best)).name;
        }
        settle(next);
    };
    const cancelDrag = () => settle(nearest(drag.current.visible));
    const engine = useRef(null);
    engine.current = { beginDrag, moveDrag, endDrag, cancelDrag };

    // --- pointers -------------------------------------------------------------------

    const stopListening = useRef(() => { });
    useEffect(() => () => stopListening.current(), []);

    // Whether a vertical move on the content (dy > 0 = the finger went up) belongs to the
    // sheet rather than to the content's own scroll.
    const contentClaims = (dy) => snapRef.current !== 'full' || (dy < 0 && contentRef.current.scrollTop <= 0);

    const onPointerDown = (event) => {
        if (stopListening.current.active || event.target.closest?.(NO_DRAG)) return;
        if (event.pointerType === 'mouse' && event.button > 0) return;
        const fromContent = event.currentTarget === contentRef.current;
        // Fully open, a finger on the content scrolls it; the touch listeners below
        // take the pull-down at the top.
        if (fromContent && snapRef.current === 'full' && event.pointerType === 'touch') return;
        const pointerId = event.pointerId ?? 0;
        const target = event.currentTarget;
        const startX = event.clientX ?? 0;
        const startY = event.clientY ?? 0;
        const t0 = performance.now();
        let dragged = false;

        const mine = (e) => (e.pointerId ?? 0) === pointerId;
        const onMove = (e) => {
            if (!mine(e)) return;
            const y = e.clientY ?? startY;
            if (dragged) {
                moveDrag(y);
                return;
            }
            const dx = Math.abs((e.clientX ?? startX) - startX);
            const dy = startY - y;
            if (Math.max(dx, Math.abs(dy)) <= SLOP) return;
            // Sideways first, or the content's own scroll: not the sheet's gesture.
            if (dx >= Math.abs(dy) || (fromContent && !contentClaims(dy))) {
                stop();
                return;
            }
            dragged = true;
            try {
                if (typeof target.setPointerCapture === 'function') target.setPointerCapture(pointerId);
            } catch { /* a synthetic or already-released pointer: the window listeners still follow it */ }
            // From the slop's edge, so the panel does not jump SLOP px when it starts.
            beginDrag(startY - Math.sign(dy) * SLOP, t0, fromContent ? contentRef.current : null);
            moveDrag(y);
        };
        const onUp = (e) => {
            if (!mine(e)) return;
            if (dragged) {
                endDrag(e.clientY ?? startY);
                swallowClick();
            }
            stop();
        };
        const onCancel = (e) => {
            if (!mine(e)) return;
            if (dragged) cancelDrag();
            stop();
        };
        // On the window, not the element: with pointer capture the events target the
        // grabbed element and bubble here; without it (capture refused) they still arrive.
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        const stop = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            if (drag.current) {
                drag.current = null;
                setDragPx(null);
            }
            stopListening.current = () => { };
        };
        stop.active = true;
        stopListening.current = stop;
    };

    // A drag that started on a tab or a button must not also press it: the click the
    // browser sends after the release is dropped, once, before anything sees it. The
    // browser sends it in the same task, if at all; the next press disarms it too.
    const swallowClick = () => {
        const disarm = () => {
            window.removeEventListener('click', swallow, { capture: true });
            window.removeEventListener('pointerdown', disarm, { capture: true });
        };
        const swallow = (e) => {
            e.preventDefault();
            e.stopPropagation();
            disarm();
        };
        window.addEventListener('click', swallow, { capture: true });
        window.addEventListener('pointerdown', disarm, { capture: true });
        setTimeout(disarm, 0);
    };

    // --- touches: the pull-down from the top of fully open content ----------------------

    useEffect(() => {
        const el = contentRef.current;
        if (!el) return undefined;
        let touch = null;   // { id, x, y, t0, dragging } for the finger being watched
        const find = (list) => [...list].find((t) => t.identifier === touch?.id);
        const onStart = (e) => {
            touch = null;
            if (snapRef.current !== 'full' || e.touches.length !== 1 || e.target.closest?.(NO_DRAG)) return;
            const [t] = e.touches;
            touch = { id: t.identifier, x: t.clientX, y: t.clientY, t0: performance.now(), dragging: false };
        };
        const onMove = (e) => {
            const t = touch && find(e.changedTouches);
            if (!t) return;
            if (!touch.dragging) {
                const dy = t.clientY - touch.y;   // positive = the finger went down
                const dx = Math.abs(t.clientX - touch.x);
                if (dy === 0 && dx === 0) return;
                // Only down, mostly vertical, from the very top; anything else is a scroll.
                if (dy <= 0 || dx >= dy || el.scrollTop > 0) {
                    touch = null;
                    return;
                }
                touch.dragging = true;
                engine.current.beginDrag(touch.y, touch.t0, el);
            }
            // Claimed: the content must not scroll (nor the page bounce) under the drag.
            if (e.cancelable) e.preventDefault();
            engine.current.moveDrag(t.clientY);
        };
        const onEnd = (e) => {
            const t = touch && find(e.changedTouches);
            if (!t) return;
            if (touch.dragging) {
                if (e.type === 'touchcancel') engine.current.cancelDrag();
                else engine.current.endDrag(t.clientY);
            }
            touch = null;
        };
        el.addEventListener('touchstart', onStart, { passive: true });
        // Not passive: a claimed move is cancelled so the content does not scroll too.
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd);
        el.addEventListener('touchcancel', onEnd);
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onEnd);
            el.removeEventListener('touchcancel', onEnd);
        };
    }, []);

    const dragging = dragPx != null;
    return (
        <div ref={rootRef} className="sheet" data-snap={snap}>
            <section
                className={dragging ? 'sheet__panel is-dragging' : 'sheet__panel'}
                aria-label={ariaLabel}
                style={dragging ? { '--visible': `${dragPx}px` } : undefined}
            >
                <div className="sheet__grip" onPointerDown={onPointerDown}>
                    <span className="sheet__handle" aria-hidden="true" />
                    <button
                        type="button"
                        className="sheet__toggle"
                        aria-expanded={snap !== 'collapsed'}
                        aria-controls={contentId}
                        aria-label={toggleLabel}
                        onClick={() => changeSnap(TOGGLE_NEXT[snapRef.current])}
                    >
                        <svg className="sheet__chevron" viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
                            <path d="M1 7 6 2l5 5" fill="none" stroke="currentColor" strokeWidth="2" />
                        </svg>
                    </button>
                </div>
                <div className="sheet__header" onPointerDown={onPointerDown}>{header}</div>
                <div ref={contentRef} className="sheet__content" id={contentId} onPointerDown={onPointerDown}>{children}</div>
            </section>
        </div>
    );
}
