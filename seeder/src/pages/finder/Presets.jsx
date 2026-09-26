import { useEffect, useId, useRef, useState } from 'react';
import { useIsDesktop } from '../../shared/hooks/useMediaQuery';
import { versionLabelOf } from '../../shared/seedUrl';
import {
    PINNED_GROUP, PRESET_GROUPS, presetAvailable, presetBadge, presetCaption, presetCriteria, presetVersion, presetsOf,
} from './presets.js';

/*
 * The preset chips, one group per heading, the pinned newest-version group first. A
 * chip shows its catchy name (its accessible name) over the plain contents (its
 * description). A click hands the preset's criteria to onApply, which fills the form
 * and starts the search (FinderPage). A preset the version cannot run stays visible but
 * disabled, with the reason printed under it and tied to the chip with aria-describedby
 * - a title tooltip alone reaches neither touch screens nor screen readers. On phones
 * only the pinned group starts open; each other group is a disclosure. `focusTitle`
 * moves the focus to the heading (the page's "Back to presets" removed the focused button).
 */
export default function Presets({ mcVersion, support, onApply, disabled = false, focusTitle = false }) {
    const id = useId();
    const desktop = useIsDesktop();
    const title = useRef(null);
    useEffect(() => {
        const heading = title.current;
        if (!focusTitle || !heading) return;
        heading.focus({ preventScroll: true });
        // On a phone the presets sit under the whole form: bring them up to the top.
        if (heading.getBoundingClientRect().top > window.innerHeight / 3) heading.scrollIntoView({ block: 'start' });
    }, [focusTitle]);
    const [open, setOpen] = useState(() => new Set([PINNED_GROUP]));
    const toggle = (group) => setOpen((s) => {
        const next = new Set(s);
        if (!next.delete(group)) next.add(group);
        return next;
    });
    return (
        <section className="presets" aria-labelledby={`${id}-title`}>
            <h2 id={`${id}-title`} ref={title} className="presets__title" tabIndex={-1}>Presets</h2>
            <p className="presets__hint">One click fills the form and starts the search. Ranges are measured from 0,0, where the world spawn usually is.</p>
            {PRESET_GROUPS.map((group) => {
                const listId = `${id}-${group.id}`;
                const expanded = desktop || open.has(group.id);
                return (
                    <div key={group.id} className={`preset-group${group.id === PINNED_GROUP ? ' preset-group--pinned' : ''}`}>
                        <h3 className="preset-group__title">
                            {desktop ? group.title : (
                                <button
                                    type="button"
                                    className="preset-group__toggle"
                                    aria-expanded={expanded}
                                    aria-controls={listId}
                                    onClick={() => toggle(group.id)}
                                >
                                    {/* Hidden from the accessible name: CSS content counts in it. */}
                                    <span className="preset-group__chevron" aria-hidden="true" />
                                    {group.title}
                                </button>
                            )}
                        </h3>
                        <ul id={listId} className="preset-group__list" hidden={!expanded}>
                            {presetsOf(group.id).map((preset) => (
                                <PresetChip
                                    key={preset.slug}
                                    preset={preset}
                                    idBase={`${id}-${preset.slug}`}
                                    mcVersion={mcVersion}
                                    support={support}
                                    disabled={disabled}
                                    onApply={onApply}
                                />
                            ))}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}

function PresetChip({ preset, idBase, mcVersion, support, disabled, onApply }) {
    const { ok, reason: why } = presetAvailable(preset, support);
    // While the version is being checked (milliseconds) every chip waits quietly:
    // thirty-seven "Checking…" lines would only flash.
    const reason = support ? why : null;
    const runsOn = presetVersion(preset, mcVersion);
    const note = support && runsOn !== mcVersion ? `Switches to ${versionLabelOf(runsOn)}.` : null;
    const badge = presetBadge(preset);
    const ids = { name: `${idBase}-name`, badge: `${idBase}-badge`, caption: `${idBase}-caption`, reason: `${idBase}-reason`, note: `${idBase}-note` };
    return (
        <li className="preset">
            <button
                type="button"
                className="chip preset__chip"
                disabled={!ok || disabled}
                title={why ?? undefined}
                aria-labelledby={badge ? `${ids.name} ${ids.badge}` : ids.name}
                aria-describedby={[reason && ids.reason, note && ids.note, ids.caption].filter(Boolean).join(' ')}
                onClick={() => onApply(presetCriteria(preset, mcVersion))}
            >
                <span className="preset__name">
                    <span id={ids.name}>{preset.label}</span>
                    {badge && <span id={ids.badge} className="badge badge--muted">{badge}</span>}
                </span>
                <span id={ids.caption} className="preset__caption">{presetCaption(preset)}</span>
            </button>
            {reason && <p id={ids.reason} className="preset__reason">{reason}</p>}
            {note && <p id={ids.note} className="preset__reason">{note}</p>}
        </li>
    );
}
