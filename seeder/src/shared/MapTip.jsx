import { useLayoutEffect, useRef } from 'react';
import { swatch } from './Legend';

// Distance (px) from the point to the bubble: clears the 24 px crosshair and the pin's dot.
const GAP = 16;
// The bubble's largest box (max-width in MapCanvas.css; two lines, or the close button),
// used until the bubble has been measured.
const TIP_W = 260;
const TIP_H = 60;
// The bubble never comes closer than this to the map's edge.
const EDGE = 4;

/*
 * Where a tip's bubble goes around its point ({ left, top }, canvas px) on a W x H map,
 * as the bubble's offset from the point, { x, y }. `size` is the bubble's measured
 * { width, height } (the largest box until then). The mouse's tip sits below right of
 * the pointer, like a tooltip; a pin's sits above right of its dot, where the finger
 * that tapped does not cover it. Either flips to the other side when it would leave the
 * map, and is pushed back inside when neither side has room (a narrow phone).
 */
export function placeTip({ left, top }, size, W, H, pinned = false) {
    const w = size?.width || TIP_W;
    const h = size?.height || TIP_H;
    let x = left + GAP;
    if (x + w > W - EDGE) x = left - GAP - w;
    if (x < EDGE) x = Math.max(EDGE, W - EDGE - w);
    let y = pinned ? top - GAP - h : top + GAP;
    if (pinned && y < EDGE) y = top + GAP;
    else if (!pinned && y + h > H - EDGE) y = top - GAP - h;
    y = Math.max(EDGE, Math.min(y, H - EDGE - h));
    return { x: x - left, y: y - top };
}

/*
 * The biome at a point of the map, next to that point: the colour it is painted in, its
 * name and its block coordinates. `tip` is DrawSeed's { x, z, biome, id, left, top };
 * `colors` the pool's palette (null until it has answered: the swatch is then empty).
 * A pinned tip (a tap) marks its point with a dot and has a close button; the mouse's
 * tip lets every pointer event through to the map.
 */
export default function MapTip({ tip, colors, width, height, pinned = false, onClose }) {
    const bubble = useRef(null);
    // The bubble's last measured size: the render places it with that, and the layout
    // effect corrects the place at once when the text made it another size.
    const size = useRef(null);
    const offset = placeTip(tip, size.current, width, height, pinned);
    useLayoutEffect(() => {
        const el = bubble.current;
        if (!el || !el.offsetWidth) return;   // no layout (jsdom): keep the estimate
        const measured = { width: el.offsetWidth, height: el.offsetHeight };
        if (measured.width === size.current?.width && measured.height === size.current?.height) return;
        size.current = measured;
        const next = placeTip(tip, measured, width, height, pinned);
        el.style.left = `${next.x}px`;
        el.style.top = `${next.y}px`;
    });
    return (
        <div className={pinned ? 'map-tip map-tip--pinned' : 'map-tip'} style={{ transform: `translate(${tip.left}px, ${tip.top}px)` }}>
            {pinned && <span className="map-tip__dot" aria-hidden="true" />}
            <div ref={bubble} className="map-tip__bubble" style={{ left: offset.x, top: offset.y }}>
                <div className="map-tip__biome">
                    <span className="map-tip__swatch" style={swatch(colors?.[tip.id])} aria-hidden="true" />
                    <span className="map-tip__name">{tip.biome}</span>
                    {pinned && (
                        // Not "… seed …": getByLabel('Seed') matches names by substring (see MapCanvas).
                        <button type="button" className="map-tip__close" aria-label="Close biome info" onClick={onClose}>
                            {/* A pixel-art cross, 2 px per cell, in the pixel font's style. */}
                            <svg viewBox="0 0 5 5" width="10" height="10" shapeRendering="crispEdges" aria-hidden="true">
                                <path fill="currentColor" d="M0 0h1v1H0zM4 0h1v1H4zM1 1h1v1H1zM3 1h1v1H3zM2 2h1v1H2zM1 3h1v1H1zM3 3h1v1H3zM0 4h1v1H0zM4 4h1v1H4z" />
                            </svg>
                        </button>
                    )}
                </div>
                <div className="map-tip__coords"><b>X:</b> {tip.x}, <b>Z:</b> {tip.z}</div>
            </div>
        </div>
    );
}
