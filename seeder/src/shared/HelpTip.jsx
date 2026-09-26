import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './HelpTip.css';

// Gap (px) between the button and the bubble, and the bubble's margin to the viewport.
const GAP = 6;
const GUTTER = 16;

// The open tip's close(), or null: opening one closes the other.
let closeOpen = null;

/*
 * Where the bubble goes for a button at `rect` (viewport px), as { left, top }: below
 * the button, centred on it, or above when there is no room below; always inside the
 * viewport's gutter. `size` is the bubble's measured { width, height }. `across`, the
 * { left, right } of the box the button scrolls in (the seed panel, the sheet), keeps
 * the bubble inside that box sideways when it is wide enough: off the map beside it.
 */
export function placeHelp(rect, size, viewport, across = null) {
    const { width: w, height: h } = size;
    let top = rect.bottom + GAP;
    if (top + h > viewport.height - GUTTER && rect.top - GAP - h >= GUTTER) top = rect.top - GAP - h;
    let min = GUTTER;
    let max = viewport.width - GUTTER;
    if (across && across.right - across.left - 2 * GUTTER >= w) {
        min = Math.max(min, across.left + GUTTER);
        max = Math.min(max, across.right - GUTTER);
    }
    const centred = rect.left + rect.width / 2 - w / 2;
    const left = Math.max(min, Math.min(centred, max - w));
    return { left, top };
}

// The box `el` scrolls in, or null when that is the page itself.
function scrollBox(el) {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') return node.getBoundingClientRect();
    }
    return null;
}

/*
 * A "?" button that explains a term: a tap or click opens a small bubble with `text`,
 * a second one (or the close button, Escape, a press elsewhere, a scroll or a resize)
 * closes it. The button has no text node, so the text around it reads the same to
 * tests and screen readers; `label` is its accessible name, which must not contain
 * the name of a field next to it (Playwright's getByLabel matches by substring). The
 * bubble is portalled to <body> while open, out of every scroll box and of the bottom
 * sheet's transform. Nothing here touches the DOM while rendering: prerender-safe.
 */
export default function HelpTip({ label, text }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const button = useRef(null);
    const bubble = useRef(null);
    const id = useId();

    const close = useCallback((refocus = false) => {
        setOpen(false);
        setPos(null);
        if (refocus) button.current?.focus({ preventScroll: true });
    }, []);

    const toggle = () => {
        if (open) {
            close();
            return;
        }
        closeOpen?.();
        setOpen(true);
    };

    useLayoutEffect(() => {
        if (!open || !button.current || !bubble.current) return;
        const size = { width: bubble.current.offsetWidth, height: bubble.current.offsetHeight };
        const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
        setPos(placeHelp(button.current.getBoundingClientRect(), size, viewport, scrollBox(button.current)));
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const shut = () => close();
        closeOpen = shut;
        const onPointerDown = (event) => {
            if (button.current?.contains(event.target) || bubble.current?.contains(event.target)) return;
            close();
        };
        // Capture: before the bottom sheet's own Escape (document, bubbling) sees the key.
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close(true);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', shut, true);
        window.addEventListener('resize', shut);
        return () => {
            if (closeOpen === shut) closeOpen = null;
            document.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('scroll', shut, true);
            window.removeEventListener('resize', shut);
        };
    }, [open, close]);

    // Tab leaves the bubble for the button it belongs to: the bubble sits at the end of <body>.
    const onBubbleKeyDown = (event) => {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        close(true);
    };

    const bubbleId = `${id}-help`;
    return (
        <>
            <button
                ref={button}
                type="button"
                className="help-tip"
                aria-label={label}
                aria-expanded={open}
                aria-controls={open ? bubbleId : undefined}
                aria-describedby={open ? `${bubbleId}-text` : undefined}
                onClick={toggle}
            >
                <img src="/svg/help.svg" alt="" width="16" height="16" />
            </button>
            {open && createPortal(
                <div
                    ref={bubble}
                    id={bubbleId}
                    className="help-tip__bubble"
                    role="dialog"
                    aria-label={label}
                    style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
                    onKeyDown={onBubbleKeyDown}
                >
                    <p id={`${bubbleId}-text`} className="help-tip__text">{text}</p>
                    <button type="button" className="help-tip__close" aria-label="Close help" onClick={() => close(true)}>
                        {/* The pixel-art cross of MapTip. */}
                        <svg viewBox="0 0 5 5" width="10" height="10" shapeRendering="crispEdges" aria-hidden="true">
                            <path fill="currentColor" d="M0 0h1v1H0zM4 0h1v1H4zM1 1h1v1H1zM3 1h1v1H3zM2 2h1v1H2zM1 3h1v1H1zM3 3h1v1H3zM0 4h1v1H0zM4 4h1v1H4z" />
                        </svg>
                    </button>
                </div>,
                document.body,
            )}
        </>
    );
}
