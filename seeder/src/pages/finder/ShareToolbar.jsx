import { useId, useState } from 'react';
import CopyButton from '../../shared/CopyButton';
import { buildFinderUrl } from '../../shared/finderUrl';
import { downloadCsv, downloadJson, seedsText } from './exporters';

// Beyond this many characters some chat apps and URL fields cut a link short.
export const LONG_LINK = 2000;

/*
 * Share and export: one compact row inside the stats box, short visible labels, the
 * full phrases as accessible names.
 *   Share:  "Share link" (Share these results: criteria + every row's seed + the
 *           resume cursor, so the recipient sees the same rows at once),
 *           "Share…" (the system share sheet, where there is one). No criteria-only
 *           link: a criteria URL never searches by itself, so it opened on a bare form.
 *   Export: "Copy seeds" (Copy all seeds), "CSV" (Download CSV), "JSON" (Download JSON)
 * Links are absolute (mcseeder.com): they are meant for someone else. Copies are
 * confirmed by the site-wide toast. Props:
 *   criteria        what the rows were searched with (the last run's, or the shared URL's)
 *   views           HitView[]: the rows, in order
 *   cursor          BigInt: where "Find more" continues (the run's resumeSeed)
 *   canShareNative  whether navigator.share exists
 *   collapsible     phones: one "Share / export" button that shows the row, which
 *                   otherwise costs two lines above the first result
 */
export default function ShareToolbar({ criteria, views, cursor, canShareNative = false, collapsible = false }) {
    const shareLabel = useId();
    const exportLabel = useId();
    const toolbarId = useId();
    const [open, setOpen] = useState(false);
    const hasRows = views.length > 0;
    const seedsUrl = buildFinderUrl(criteria, { seeds: views.map((v) => v.seed), start: cursor, absolute: true });
    const btn = 'btn finder__toolbar-btn';

    const shareNative = async () => {
        try {
            await navigator.share({ title: document.title, url: seedsUrl });
        } catch (_) { /* the sheet was closed (AbortError) or refused: nothing to undo */ }
    };

    const toggle = collapsible && (
        <button
            type="button"
            className="btn finder__toolbar-btn finder__toolbar-toggle"
            aria-expanded={open}
            aria-controls={toolbarId}
            onClick={() => setOpen((o) => !o)}
        >
            Share / export<span className="finder__toolbar-caret" aria-hidden="true" />
        </button>
    );
    if (collapsible && !open) return toggle;

    const toolbar = (
        <div id={toolbarId} className="finder__toolbar" role="toolbar" aria-label="Share and export">
            <div className="finder__toolbar-group" role="group" aria-labelledby={shareLabel}>
                <span id={shareLabel} className="finder__toolbar-label">Share</span>
                {hasRows
                    ? <CopyButton text={seedsUrl} label="Share link" ariaLabel="Share these results" className={btn} />
                    : <button type="button" className={btn} aria-label="Share these results" disabled>Share link</button>}
                {canShareNative && (
                    <button type="button" className={btn} disabled={!hasRows} onClick={shareNative}>Share…</button>
                )}
            </div>
            <div className="finder__toolbar-group" role="group" aria-labelledby={exportLabel}>
                <span id={exportLabel} className="finder__toolbar-label">Export</span>
                {hasRows
                    ? <CopyButton text={seedsText(views)} label="Copy seeds" ariaLabel="Copy all seeds" className={btn} />
                    : <button type="button" className={btn} aria-label="Copy all seeds" disabled>Copy seeds</button>}
                <button type="button" className={btn} aria-label="Download CSV" disabled={!hasRows} onClick={() => downloadCsv(criteria, views)}>
                    CSV
                </button>
                <button type="button" className={btn} aria-label="Download JSON" disabled={!hasRows} onClick={() => downloadJson(criteria, views, { start: cursor })}>
                    JSON
                </button>
            </div>
            {hasRows && seedsUrl.length > LONG_LINK && (
                <p className="finder__toolbar-hint">Long link: some apps truncate it.</p>
            )}
        </div>
    );
    return collapsible ? <>{toggle}{toolbar}</> : toolbar;
}
