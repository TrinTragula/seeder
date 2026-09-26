import { Fragment, useLayoutEffect, useRef } from 'react';
import AdFeed from '../../shared/AdFeed';
import SeedCard from './SeedCard';

// The first rows draw their thumbnails at once, whether on screen or not, so the list
// looks loaded; later rows ask shortly before they are seen.
export const EAGER_THUMBS = 10;

/*
 * The results: one full-width row per seed, with the in-feed ad units
 * AdFeed weaves in after every 5th row. One row is open at a time (its map replaces
 * its thumbnail). Keyboard: ArrowUp / ArrowDown move the focus between the rows (a
 * closed row's thumbnail, the open row's "Close preview"); Enter / Space open a row
 * (they click its thumbnail); Escape closes the open one. Focus follows: an opened row
 * focuses its Close button, a closed row its thumbnail. Props:
 *   hits        HitView[] in the order found
 *   thumbnails  the page's thumbnail requester, or null
 *   openSeed    the open row's seed, or null
 *   onOpen      (seed) => void
 *   onClose     (seed) => void
 *   saved       (view) => bool: whether My worlds holds this row's world
 *   onSave      (view) => void
 *   criteriaSummary  the criteria line every row's share card prints
 *   afterFirst  what goes right after the first row (the phone's results ad), or null
 */
export default function ResultsGrid({ hits, thumbnails, openSeed, onOpen, onClose, saved, onSave, criteriaSummary = '', afterFirst = null }) {
    const list = useRef(null);
    // Where the focus goes once React has swapped a row's thumbnail and map.
    const focusNext = useRef(null);

    useLayoutEffect(() => {
        const next = focusNext.current;
        focusNext.current = null;
        if (!next || !list.current) return;
        const row = [...list.current.querySelectorAll('[data-seed]')].find((el) => el.dataset.seed === next.seed);
        // preventScroll: the row scrolls itself into place; a focus scroll would fight it.
        row?.querySelector(`[data-row-handle="${next.handle}"]`)?.focus({ preventScroll: true });
    }, [openSeed]);

    const open = (seed) => {
        focusNext.current = { seed, handle: 'close' };
        onOpen?.(seed);
    };
    const close = (seed) => {
        focusNext.current = { seed, handle: 'preview' };
        onClose?.(seed);
    };

    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            if (openSeed == null) return;
            event.preventDefault();
            close(openSeed);
            return;
        }
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!step || !list.current) return;
        const handles = [...list.current.querySelectorAll('[data-row-handle]')];
        const from = handles.indexOf(event.target);
        if (from < 0) return;
        event.preventDefault();
        handles[Math.min(handles.length - 1, Math.max(0, from + step))].focus();
    };

    return (
        <div ref={list} className="results-grid" role="list" aria-label="Seeds found" onKeyDown={onKeyDown}>
            <AdFeed
                items={hits}
                renderItem={(view, index) => (
                    <Fragment key={view.seed}>
                        <div role="listitem" className="results-grid__item">
                            <SeedCard
                                view={view}
                                thumbnails={thumbnails}
                                eager={index < EAGER_THUMBS}
                                open={view.seed === openSeed}
                                onOpen={open}
                                onClose={close}
                                saved={saved ? saved(view) : false}
                                onSave={onSave}
                                criteriaSummary={criteriaSummary}
                            />
                        </div>
                        {index === 0 && afterFirst}
                    </Fragment>
                )}
            />
        </div>
    );
}
