import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '../../shared/CopyButton';
import { useSeedQuery } from '../../shared/hooks/useSeedQuery';
import { useQueueManager } from '../../shared/hooks/useQueueManager';
import { useInView } from '../../shared/hooks/useInView';
import { biomeLabel, formatCoords, formatDistance } from '../../shared/format';
import { buildSeedUrl, versionLabelOf } from '../../shared/seedUrl';
import { BiomeSwatch } from '../seed/dashboard/SpawnSection';
import { badgesFor, VARIANT_TYPES } from '../seed/dashboard/variants';
import { THUMB_SCALE } from '../../library/thumbnail';
import { rangeLabel } from './criteria';
import { previewTarget } from './hitModel';
import PreviewMap from './PreviewMap';
import { buildShareCard, shareOrDownloadCard } from './sharecard';
import { engineVersion } from '../../util/seed';

// Gap between the top of the screen and an opened row's top edge (--space-4).
export const OPEN_SCROLL_GAP = 16;
const prefersReducedMotion = () => typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A row's thumbnail is asked for this far before it scrolls into view (two screens), so
// scrolling down finds it drawn; the first rows (ResultsGrid's EAGER_THUMBS) ask at once.
export const THUMB_LOOKAHEAD = '200% 0px';

// Variant badges are asked for the first few rows that can carry one: each is a query
// on the reserved worker while the search runs, and a card is a summary, not a report.
export const MAX_VARIANT_ROWS = 3;

// The biome at the spawn. The coordinator's spawn is always the Overworld's, so that is
// the dimension asked about, whatever the search's dimension.
function SpawnBiome({ view }) {
    const { COLORS } = useQueueManager();
    const { mcVersion, largeBiomes, seed, yHeight, spawn } = view;
    const { data, loading } = useSeedQuery('BIOME_AT', {
        mcVersion: engineVersion(mcVersion, largeBiomes), seed, dimension: 0, x: spawn.x, y: yHeight, z: spawn.z,
    });
    if (loading) return <span className="badge-skeleton" aria-hidden="true" />;
    if (data?.biome == null) return null;
    return (
        <span className="seed-card__biome">
            <BiomeSwatch colors={COLORS} id={data.biome} />
            {biomeLabel(data.biome)}
        </span>
    );
}

function VariantBadges({ view, row }) {
    const { mcVersion, largeBiomes, seed, dimension } = view;
    const { type, x, z } = row;
    const { data, loading } = useSeedQuery('STRUCTURE_VARIANT', {
        mcVersion: engineVersion(mcVersion, largeBiomes, dimension), seed, dimension, type, x, z,
    });
    if (loading) return <span className="badge-skeleton" aria-hidden="true" />;
    const badges = badgesFor(type, data?.variant);
    if (badges.length === 0) return null;
    return (
        <span className="badges">
            {badges.map((b) => (
                <span key={b.key} className={b.tone === 'accent' ? 'badge' : `badge badge--${b.tone}`}>{b.label}</span>
            ))}
        </span>
    );
}

// The thumbnail canvas is built outside React (thumbnail.js); the card only hosts it. A placeholder box of the same size holds the layout until it lands.
// The band along its bottom says the picture opens a map: without it the thumbnail read
// as a plain image. It is aria-hidden: the button's own name ("Preview <seed>") says it.
function Thumbnail({ canvas }) {
    const host = useRef(null);
    useEffect(() => {
        const el = host.current;
        if (!el || !canvas) return undefined;
        el.replaceChildren(canvas);
        return () => { if (canvas.parentNode === el) el.removeChild(canvas); };
    }, [canvas]);
    // The host holds no React children: React must never try to remove a node that
    // replaceChildren() has already taken out.
    return (
        <span className="seed-card__thumb">
            {!canvas && <span className="seed-card__placeholder" aria-hidden="true" />}
            <span ref={host} className="seed-card__canvas" />
            <span className="seed-card__cta" aria-hidden="true">
                <img src="/svg/map.svg" alt="" width="16" height="16" />
                <span className="seed-card__cta-mouse">Click to explore the map</span>
                <span className="seed-card__cta-touch">Tap to explore the map</span>
            </span>
        </span>
    );
}

// The thumbnail is the opened map's first frame: the same box (--preview-h), 1 px per
// biome cell like the map at zoom 1, centred on the same block (previewTarget). About 1 s
// of engine time on 26.3, so a non-eager row asks only once it is within THUMB_LOOKAHEAD
// of the screen. A box without a layout (hidden, jsdom) asks for nothing.
function useThumbnail(thumbnails, view, box, open, target, eager) {
    const [canvas, setCanvas] = useState(null);
    const { mcVersion, largeBiomes, seed, dimension, yHeight, found, spawn } = view;
    const near = useInView(box, { rootMargin: THUMB_LOOKAHEAD });
    const wanted = eager || near;
    useLayoutEffect(() => {
        const el = box.current;
        if (!thumbnails || !el || canvas || !wanted) return undefined;
        const widthCells = Math.floor(el.clientWidth / THUMB_SCALE);
        const heightCells = Math.floor(el.clientHeight / THUMB_SCALE);
        if (widthCells < 1 || heightCells < 1) return undefined;
        let live = true;
        // Markers only where the engine found a structure (a shared row's unverified ones have no place).
        const markers = found.map(({ type, x, z }) => ({ type, x, z }));
        // The spawn is the Overworld's: marked on Overworld rows only, as the opened map does.
        // The packed version keys the thumbnail cache too: Default and Large never share one.
        thumbnails.request({
            mcVersion: engineVersion(mcVersion, largeBiomes, dimension), seed, dimension, yHeight, markers, spawn: dimension === 0 ? spawn : null,
            widthCells, heightCells, centreX: target.x, centreZ: target.z,
        }, (ready) => {
            if (live) setCanvas(ready.canvas);
        });
        return () => { live = false; };
        // One request per row: the size is measured once, a later resize only scales it.
        // `open`: a row opened before the requester existed asks once it closes.
    }, [thumbnails, open, wanted]);
    return canvas;
}

/*
 * One search result, a full-width row. Clicking the thumbnail opens the row: the
 * interactive map takes its place at the same size, on the same block. Props:
 *   view        a HitView (hitModel.js): seed as a decimal string
 *   thumbnails  the page's thumbnail requester (library/thumbnail.js), or null
 *   eager       ask for the thumbnail at once, not only when the row comes near the screen
 *   open        whether this row is the open preview
 *   onOpen      (seed) => void, from the thumbnail
 *   onClose     (seed) => void, from "Close preview"
 *   saved       whether My worlds holds this seed / version / dimension
 *   onSave      (view) => void
 *   criteriaSummary  the share card's criteria line (summaryOf the search's criteria)
 */
export default function SeedCard({ view, thumbnails = null, eager = false, open = false, onOpen, onClose, saved = false, onSave, criteriaSummary = '' }) {
    const { seed, mcVersion, dimension, spawn, structures, warning } = view;
    // The rows the engine found: the thumbnail's markers, the preview's target and badges.
    const found = useMemo(() => structures.filter((s) => s.verified !== false), [structures]);
    const located = useMemo(() => (found.length === structures.length ? view : { ...view, structures: found }), [view, found, structures]);
    const article = useRef(null);
    const box = useRef(null);
    const target = previewTarget(located);
    const canvas = useThumbnail(thumbnails, { ...view, found }, box, open, target, eager);
    const [sharing, setSharing] = useState(false);
    // A ref, not the state: a second tap before React re-renders would still read
    // `sharing` as false and hand the target app a second copy of the image.
    const busy = useRef(false);
    // The card is drawn from the canvas the row already shows (kept while the row is
    // open), so it is instant and costs the engine nothing.
    const shareImage = async () => {
        if (!canvas || busy.current) return;
        busy.current = true;
        setSharing(true);
        try {
            const card = await buildShareCard({ view, thumbnailCanvas: canvas, versionLabel: versionLabelOf(mcVersion), criteriaSummary });
            await shareOrDownloadCard(card, seed);
        } catch (_) {
            /* the PNG could not be encoded: nothing was shared, nothing to undo */
        } finally {
            busy.current = false;
            setSharing(false);
        }
    };
    // Opened by the user: bring the row's top to OPEN_SCROLL_GAP px under the top of the
    // screen, so its seed line and its 60vh map are in view.
    // Measured after the commit, when the row above (if it was the open one) has shrunk.
    const scrollOnOpen = useRef(false);
    useLayoutEffect(() => {
        if (!open || !scrollOnOpen.current || !article.current) return;
        scrollOnOpen.current = false;
        const top = window.scrollY + article.current.getBoundingClientRect().top - OPEN_SCROLL_GAP;
        window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }, [open]);
    const openHere = () => {
        scrollOnOpen.current = true;
        onOpen?.(seed);
    };

    let variantRows = 0;
    return (
        <article ref={article} className={open ? 'card seed-card seed-card--open' : 'card seed-card'} data-testid="seed-card" data-seed={seed}>
            <header className="seed-card__head">
                <code className="seed-card__seed">{seed}</code>
                <span className="seed-card__head-actions">
                    {open && (
                        <button type="button" className="btn seed-card__close" data-row-handle="close" onClick={() => onClose?.(seed)}>
                            Close preview
                        </button>
                    )}
                    <CopyButton text={seed} label="Copy" className="btn seed-card__copy" />
                </span>
            </header>
            {open ? (
                <PreviewMap view={located} />
            ) : (
                <>
                    <button
                        ref={box}
                        type="button"
                        className="seed-card__preview"
                        aria-expanded="false"
                        aria-label={`Preview ${seed}`}
                        data-row-handle="preview"
                        onClick={openHere}
                    >
                        <Thumbnail canvas={canvas} />
                    </button>
                    <p className="seed-card__caption">Around {formatCoords(target.x, target.z)}</p>
                </>
            )}
            <dl className="seed-card__facts">
                <div className="seed-card__fact">
                    <dt>{dimension === 0 ? 'Spawn' : 'Overworld spawn'}</dt>
                    <dd>
                        <code>{formatCoords(spawn.x, spawn.z)}</code>
                        <SpawnBiome view={view} />
                    </dd>
                </div>
            </dl>
            {warning && <p className="seed-card__warning">{warning}</p>}
            {structures.length > 0 && (
                <ul className="seed-card__structures" aria-label="Structures">
                    {structures.map((row) => {
                        if (row.verified === false) {
                            return (
                                <li key={`${row.type}:unverified`} className="seed-card__structure seed-card__structure--unverified">
                                    {row.icon && <img className="seed-card__icon" src={row.icon} alt="" width="20" height="20" />}
                                    <span className="seed-card__structure-main">
                                        <span className="seed-card__structure-name">{row.name}</span>
                                        <span className="badge badge--muted seed-card__unverified">Not found within {rangeLabel(view.rangeBlocks)}</span>
                                    </span>
                                </li>
                            );
                        }
                        const withBadges = VARIANT_TYPES.has(row.type) && variantRows < MAX_VARIANT_ROWS;
                        if (withBadges) variantRows += 1;
                        return (
                            <li key={`${row.type}:${row.x}:${row.z}`} className="seed-card__structure">
                                {row.icon && <img className="seed-card__icon" src={row.icon} alt="" width="20" height="20" />}
                                <span className="seed-card__structure-main">
                                    <span className="seed-card__structure-name">{row.name}</span>
                                    {withBadges && <VariantBadges view={view} row={row} />}
                                </span>
                                <span className="seed-card__structure-meta">
                                    <code>{formatCoords(row.x, row.z)}</code>
                                    <span className="seed-card__distance">{formatDistance(row.distance)}</span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            <footer className="seed-card__actions">
                {/* A new tab: the finder's results survive opening a seed. */}
                <a className="btn btn--primary" href={buildSeedUrl({ seed, mcVersion, dimension, largeBiomes: view.largeBiomes })} target="_blank" rel="noopener">Open seed</a>
                <button type="button" className="btn" onClick={() => onSave?.(view)} disabled={saved}>
                    {saved ? 'Saved ✓' : 'Save world'}
                </button>
                <button type="button" className="btn" onClick={shareImage} disabled={!canvas || sharing}>Share image</button>
            </footer>
        </article>
    );
}
