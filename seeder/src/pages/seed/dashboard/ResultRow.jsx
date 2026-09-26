import { useId, useState } from 'react';

/*
 * One line of a dashboard result list (Structures, Strongholds): a compact summary that
 * opens, on a tap, the details under it (coordinates to copy, map actions). A stacked
 * table card took ~200 px per row in the narrow panel. A row without details is a plain
 * line.
 *
 * `summary` is the line's content (phrasing content only: it sits inside a <button>);
 * `children` are the details, kept in the DOM but `hidden` while closed so the
 * button's aria-controls always points at something.
 */
export default function ResultRow({ summary, children }) {
    const [open, setOpen] = useState(false);
    const detailsId = useId();
    if (!children) {
        return (
            <li className="result-row">
                <div className="result-row__summary">
                    {summary}
                    {/* Keeps the line's right edge in step with the rows that open. */}
                    <span className="result-row__chevron" aria-hidden="true" />
                </div>
            </li>
        );
    }
    return (
        <li className="result-row">
            <button
                type="button"
                className="result-row__summary"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((o) => !o)}
            >
                {summary}
                <span className="result-row__chevron" aria-hidden="true">▸</span>
            </button>
            <div id={detailsId} className="result-row__details" hidden={!open}>{children}</div>
        </li>
    );
}
