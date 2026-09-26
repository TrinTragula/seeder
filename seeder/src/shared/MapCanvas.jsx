import { useEffect, useRef, useState } from 'react';
import { DrawSeed } from '../library/draw';
import { useQueueManager } from './hooks/useQueueManager';
import MapTip from './MapTip';
import './MapCanvas.css';

// World-aligned tiles of 75x75 biome cells, one screen pixel per cell at zoom 1.
// 1 canvas px = 1 CSS px (no HiDPI scaling): DrawSeed's pan maths assumes it.
const TILE = 75;
const PIX_DIM = 1;

// Stable defaults: a fresh [] or {} on every render would re-run their effects each time.
const NONE = [];
const NO_OVERLAYS = Object.freeze({});

const ARROWS = [
    { action: 'up', label: 'Pan up' },
    { action: 'left', label: 'Pan left' },
    { action: 'down', label: 'Pan down' },
    { action: 'right', label: 'Pan right' },
];
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/*
 * The interactive biome map: one canvas, one DrawSeed, sized to its container.
 * Props are the world to show; the component owns the renderer, resizing, the
 * arrow buttons / keys, the biome tips (the biome under the mouse, next to the
 * pointer; on touch screens the place a finger tapped: MapTip) and the hint at the
 * bottom that says what the map can do, until the user first moves it. Results come back
 * through callbacks (onBusy, onSpawn, onStrongholds, onHover(x, z, biome) for the
 * mouse) and `apiRef` (zoom, dezoom, up, down,
 * left, right, panTo(blockX, blockZ, { animate }), setHighlight({ x, z, label } | null)
 * until the world changes, setOverlay(name, on), getDrawer). `overlays` = { slime,
 * chunkGrid } (bools) survive world changes. `exposeGlobal` publishes the renderer
 * as window.__seederDrawer for the bench and the e2e tests (main map only).
 */
export default function MapCanvas({
    mcVersion, seed, dimension = 0, yHeight = 256,
    structuresToShow = NONE, showStructureCoords = true, overlays = NO_OVERLAYS,
    onHover, onBusy, onSpawn, onStrongholds,
    apiRef, exposeGlobal = false, className = '',
}) {
    const queue = useQueueManager();
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const drawerRef = useRef(null);
    // DrawSeed's { hover, pin }; and whether the user has moved the map yet (the hint's end).
    const [tip, setTip] = useState({ hover: null, pin: null });
    const [moved, setMoved] = useState(false);

    // The callbacks are usually inline arrows (a new function every render); a ref keeps
    // the effects below keyed on data only, like useSearchParamsState does.
    const callbacks = useRef({});
    useEffect(() => { callbacks.current = { onHover, onBusy, onSpawn, onStrongholds }; });

    // Which world the pending spawn / stronghold callbacks belong to: a result for a
    // seed the user has already left must not clear the busy flag or reach the page.
    const generation = useRef(0);
    // Structure types already requested for the current world (see the structures effect).
    const requested = useRef(new Set());

    // Mount: size the canvas, then build the renderer, then follow the container's size.
    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        // The bitmap must be exactly the CSS box or the browser rescales it (a squashed
        // map). Assigning width/height also wipes the bitmap, so it only happens when
        // the size really changed.
        const fit = () => {
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (canvas.width === width && canvas.height === height) return false;
            canvas.width = width;
            canvas.height = height;
            return true;
        };
        fit();   // before construction: DrawSeed centres world (0,0) from canvas.width/height
        const drawer = new DrawSeed(mcVersion, queue, canvas, null, (next) => {
            setTip(next);
            if (next.hover) callbacks.current.onHover?.(next.hover.x, next.hover.z, next.hover.biome);
        }, TILE, PIX_DIM, { exposeGlobal, onUserMove: () => setMoved(true) });
        drawerRef.current = drawer;

        const observer = new ResizeObserver(() => { if (fit()) drawer.draw(); });
        observer.observe(container);

        if (apiRef) {
            apiRef.current = {
                zoom: () => drawer.zoom(),
                dezoom: () => drawer.dezoom(),
                up: () => drawer.up(),
                down: () => drawer.down(),
                left: () => drawer.left(),
                right: () => drawer.right(),
                panTo: (x, z, opts) => drawer.panTo(x, z, opts),
                setHighlight: (marker) => drawer.setHighlight(marker),
                setOverlay: (name, on) => drawer.setOverlay(name, on),
                getDrawer: () => drawer,
            };
        }
        return () => {
            observer.disconnect();
            drawer.destroy();
            drawerRef.current = null;
            if (apiRef) apiRef.current = null;
        };
        // One renderer per mount; every other prop is applied by the effects below.
    }, []);

    // A new world: drop the overlays and the pan, repaint, then look up spawn,
    // strongholds and the structures on show. The lookups wait for the first repaint
    // so the tiles the user is looking at are queued before anything else.
    useEffect(() => {
        const drawer = drawerRef.current;
        if (!drawer) return;
        const mine = ++generation.current;
        const current = () => mine === generation.current;
        drawer.clear();
        drawer.setSeed(seed);
        drawer.setMcVersion(mcVersion);
        drawer.setDimension(dimension);
        drawer.setYHeight(yHeight);
        drawer.setStructuresShown(structuresToShow);
        drawer.setShowStructureCoords(showStructureCoords);
        requested.current = new Set(structuresToShow);
        callbacks.current.onBusy?.(true);
        drawer.draw(() => {
            if (!current()) return;
            drawer.findSpawn((spawnSeed, x, z) => {
                if (!current()) return;
                callbacks.current.onBusy?.(false);
                callbacks.current.onSpawn?.(spawnSeed, x, z);
            }, () => {
                // No spawn to show, but the seed box must not stay disabled.
                if (current()) callbacks.current.onBusy?.(false);
            });
            drawer.findStrongholds((strongholdSeed, coords) => {
                if (current()) callbacks.current.onStrongholds?.(strongholdSeed, coords);
            });
            for (const type of structuresToShow) drawer.findStructure(type);
        });
        // yHeight, structuresToShow and showStructureCoords are read as this render's
        // values; their own changes are handled below without a clear().
    }, [seed, mcVersion, dimension]);

    // Height only: tiles are keyed by height, so a repaint fetches the new layer while
    // the pan and the overlays stay where they are.
    useEffect(() => {
        const drawer = drawerRef.current;
        if (!drawer) return;
        drawer.setYHeight(yHeight);
        drawer.draw();
    }, [yHeight]);

    // Structures on show / coordinate labels: look up only the types not yet requested
    // for this world (the world effect above has asked for the initial ones).
    useEffect(() => {
        const drawer = drawerRef.current;
        if (!drawer) return;
        drawer.setStructuresShown(structuresToShow);
        drawer.setShowStructureCoords(showStructureCoords);
        for (const type of structuresToShow) {
            if (requested.current.has(type)) continue;
            requested.current.add(type);
            drawer.findStructure(type);
        }
        drawer.drawStructures();
    }, [structuresToShow, showStructureCoords]);

    // Overlays follow the prop's values, not its identity: a new object saying the same
    // thing changes nothing.
    const slime = !!overlays.slime;
    useEffect(() => {
        drawerRef.current?.setOverlay('slime', slime);
    }, [slime]);
    const chunkGrid = !!overlays.chunkGrid;
    useEffect(() => {
        drawerRef.current?.setOverlay('chunkGrid', chunkGrid);
    }, [chunkGrid]);

    // Arrow keys pan the map, but only when nothing has focus: arrow keys inside the
    // seed box (or any other control) belong to that control.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.target !== document.body) return;
            const action = KEYS[event.key];
            const drawer = drawerRef.current;
            if (!action || !drawer) return;
            event.preventDefault();
            drawer[action]();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    // The tips flip by the map's size: the canvas bitmap is exactly its CSS box.
    const width = canvasRef.current?.width ?? 0;
    const height = canvasRef.current?.height ?? 0;
    return (
        <div ref={containerRef} className={['map-canvas', className].filter(Boolean).join(' ')}>
            {/*
              * Not "Seed map": Playwright's getByLabel matches accessible names by substring,
              * so any label containing "Seed" makes getByLabel('Seed') - the seed box in every
              * spec - ambiguous.
              */}
            <canvas ref={canvasRef} role="img" aria-label="Biome map" />
            {ARROWS.map(({ action, label }) => (
                <button
                    key={action}
                    type="button"
                    className={`map-arrow map-arrow--${action}`}
                    aria-label={label}
                    onClick={() => drawerRef.current?.[action]()}
                >
                    <img src="/svg/arrow.svg" alt="" />
                </button>
            ))}
            {/* One wording per input (CSS shows it): "Drag… scroll… point" / "Drag… pinch… tap". */}
            {!moved && (
                <p className="map-hint">
                    <span className="map-hint__mouse">Drag to move, scroll to zoom, point at the map to see the biome</span>
                    {/* Two lines on purpose: the box hugs them on a narrow phone (wrapped text would not). */}
                    <span className="map-hint__touch"><span>Drag to move, pinch to zoom,</span> <span>tap to see the biome</span></span>
                </p>
            )}
            {tip.pin && (
                <MapTip tip={tip.pin} colors={queue.COLORS} width={width} height={height} pinned
                    onClose={() => drawerRef.current?.clearPin()} />
            )}
            {tip.hover && <MapTip tip={tip.hover} colors={queue.COLORS} width={width} height={height} />}
        </div>
    );
}
