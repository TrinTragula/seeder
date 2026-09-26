import { useEffect, useId, useMemo, useState } from 'react';
import Select, { createFilter } from 'react-select';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS_OPTIONS, DIMENSIONS_OPTIONS, HEIGHT_OPTIONS } from '../../util/constants';
import { parseSeed64 } from '../../shared/finderUrl';
import HelpTip from '../../shared/HelpTip';
import { HELP } from '../../shared/help';
import {
    CHECKING_SUPPORT, COUNT_OPTIONS, HEIGHT_FROM, NO_CRITERION,
    biomeProblem, dropUnsupported, rangeChoices, rangeLabel, structureProblem, validate, warningsFor,
} from './criteria';

// Structure options are markup (icon + name); search them by their plain text.
const filterConfig = {
    ignoreCase: true,
    ignoreAccents: true,
    trim: true,
    matchFrom: 'any',
    stringify: (option) => option.data.pureText,
};

// The criteria column scrolls on its own (it is sticky and capped to the viewport)
// and would clip an open menu: render menus on the body instead.
const menuProps = {
    menuPortalTarget: document.body,
    menuPosition: 'fixed',
    styles: { menuPortal: (base) => ({ ...base, zIndex: 'var(--z-overlay)' }) },
};

const HEIGHT_MIN = -64;
const HEIGHT_MAX = 320;
const INTEGER = /^-?\d+$/;

// Menus show the icon; a selected chip shows the name only, so four of them fit a row.
const structureLabel = (option, { context }) => (context === 'menu' ? option.label : option.pureText);

function rangeOptionLabel(option, { context }) {
    return (
        <span className="range-option">
            <span className="range-option__line">
                {option.label}
                {option.slow && <span className="badge badge--muted">SLOW</span>}
            </span>
            {context === 'menu' && option.reason && <span className="range-option__reason">{option.reason}</span>}
        </span>
    );
}

/*
 * A text field that only reports values it can parse: it keeps what is typed while
 * it is incomplete ("-", "") and follows the criteria when they change elsewhere.
 */
function useDraft(value, format = String) {
    const [draft, setDraft] = useState(() => format(value));
    const [shown, setShown] = useState(value);
    if (shown !== value) {
        // A new value from outside (a preset, the range select): show it.
        setShown(value);
        setDraft(format(value));
    }
    return [draft, (text, parsed) => {
        setDraft(text);
        if (parsed !== undefined) setShown(parsed);
    }];
}

/*
 * The finder's criteria form. The criteria live in FinderPage (they are the URL); this
 * form renders them and reports every change through onChange.
 *
 * When the version or the dimension changes, selections the new support cannot hold
 * are dropped as soon as that support is known, and the form says so in one line.
 * That drop is reported as onChange(next, { pruned: true }): it is not the visitor's
 * edit, so a shared results page keeps its rows.
 */
export default function CriteriaForm({ criteria, onChange, onSearch, support, disabled = false }) {
    const id = useId();
    const { mcVersion, dimension, biomes, structures, rangeBlocks, yHeight, count, startingSeed } = criteria;
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [removed, setRemoved] = useState(null);

    const change = (patch) => {
        setRemoved(null);
        onChange({ ...criteria, ...patch });
    };

    // Only a support answer for the version on screen may drop anything: right after a
    // version change the previous version's answer is gone and the new one is loading.
    useEffect(() => {
        if (!support || support.mcVersion !== mcVersion) return;
        const { criteria: next, removed: gone } = dropUnsupported(criteria, support);
        if (gone.length === 0) return;
        setRemoved(gone.map(({ label, problem }) => `Removed ${label}: it ${problem}`).join(' '));
        onChange(next, { pruned: true });
    }, [support, criteria, mcVersion, onChange]);

    const biomeOptions = useMemo(
        () => BIOMES.filter((b) => !support || !biomeProblem(b.value, dimension, support)),
        [support, dimension],
    );
    const structureOptions = useMemo(
        () => STRUCTURES_OPTIONS.filter((s) => !support || !structureProblem(s.value, dimension, support)),
        [support, dimension],
    );
    const choices = rangeChoices(criteria);
    const rangeValue = choices.find((c) => c.value === rangeBlocks)
        ?? { value: rangeBlocks, label: `${rangeLabel(rangeBlocks)} (exact)`, slow: false, disabled: false, reason: null };
    const rangeReason = choices.find((c) => c.disabled)?.reason;
    const hasHeight = mcVersion >= HEIGHT_FROM;
    const heightValue = HEIGHT_OPTIONS.find((o) => o.value === yHeight) ?? { value: yHeight, label: `Y=${yHeight} (exact)` };

    const { ok, errors } = validate(criteria, support);
    // "Nothing picked yet" and "still checking" are not mistakes: they explain the
    // disabled button quietly instead of raising an alert on an empty form.
    const pendingNotes = errors.filter((e) => e === NO_CRITERION || e === CHECKING_SUPPORT);
    const shownErrors = errors.filter((e) => !pendingNotes.includes(e));
    const warnings = warningsFor(criteria);

    const [startDraft, setStartDraft] = useDraft(startingSeed, (n) => (n === 0n ? '' : String(n)));
    const [rangeDraft, setRangeDraft] = useDraft(rangeBlocks);
    const [heightDraft, setHeightDraft] = useDraft(yHeight);
    const startInvalid = startDraft.trim() !== '' && parseSeed64(startDraft) === null;
    // The select's "Bedrock (Y=-64)" is -70: whatever the criteria hold is never flagged.
    const heightInvalid = !(INTEGER.test(heightDraft.trim())
        && (Number(heightDraft) === yHeight || (Number(heightDraft) >= HEIGHT_MIN && Number(heightDraft) <= HEIGHT_MAX)));

    return (
        <form
            className="criteria-form"
            aria-label="Search criteria"
            onSubmit={(event) => {
                event.preventDefault();
                if (ok && !disabled) onSearch?.(criteria);
            }}
        >
            <div className="criteria-form__field">
                <label htmlFor={`${id}-biomes`}>Biomes</label>
                <Select
                    inputId={`${id}-biomes`}
                    options={biomeOptions}
                    isMulti
                    isDisabled={disabled}
                    value={biomes.map((b) => BIOMES.find((o) => o.value === b)).filter(Boolean)}
                    onChange={(options) => change({ biomes: (options ?? []).map((o) => o.value) })}
                    placeholder="Any biome"
                    {...menuProps}
                />
            </div>
            <div className="criteria-form__field">
                <label htmlFor={`${id}-structures`}>Structures</label>
                <Select
                    inputId={`${id}-structures`}
                    options={structureOptions}
                    isMulti
                    isDisabled={disabled}
                    value={structures.map((t) => STRUCTURES_OPTIONS.find((o) => o.value === t)).filter(Boolean)}
                    onChange={(options) => change({ structures: (options ?? []).map((o) => o.value) })}
                    getOptionLabel={(option) => option.pureText}
                    formatOptionLabel={structureLabel}
                    filterOption={createFilter(filterConfig)}
                    placeholder="Any structure"
                    {...menuProps}
                />
            </div>
            <div className="criteria-form__field">
                <div className="criteria-form__label-row">
                    <label htmlFor={`${id}-range`}>Range</label>
                    <HelpTip {...HELP.range} />
                </div>
                <Select
                    inputId={`${id}-range`}
                    options={choices}
                    isDisabled={disabled}
                    isSearchable={false}
                    value={rangeValue}
                    isOptionDisabled={(option) => option.disabled}
                    getOptionLabel={(option) => option.label}
                    formatOptionLabel={rangeOptionLabel}
                    onChange={(option) => change({ rangeBlocks: option.value })}
                    {...menuProps}
                />
                {/* react-select owns its input's aria-describedby: the reason is also inside the option. */}
                {rangeReason && <p className="criteria-form__hint">2k blocks: {rangeReason}</p>}
            </div>
            <div className="criteria-form__field">
                <label htmlFor={`${id}-version`}>Minecraft version</label>
                <Select
                    inputId={`${id}-version`}
                    options={VERSIONS_OPTIONS}
                    isDisabled={disabled}
                    value={VERSIONS_OPTIONS.find((o) => o.value === mcVersion)}
                    onChange={(option) => change({ mcVersion: option.value })}
                    {...menuProps}
                />
            </div>
            <div className="criteria-form__field">
                <label htmlFor={`${id}-dimension`}>Dimension</label>
                <Select
                    inputId={`${id}-dimension`}
                    options={DIMENSIONS_OPTIONS}
                    isDisabled={disabled}
                    isSearchable={false}
                    value={DIMENSIONS_OPTIONS.find((o) => o.value === dimension)}
                    onChange={(option) => change({ dimension: option.value })}
                    {...menuProps}
                />
            </div>
            {hasHeight && (
                <div className="criteria-form__field">
                    <div className="criteria-form__label-row">
                        <label htmlFor={`${id}-height`}>Biome height</label>
                        <HelpTip {...HELP.biomeHeight} />
                    </div>
                    <Select
                        inputId={`${id}-height`}
                        options={HEIGHT_OPTIONS}
                        isDisabled={disabled}
                        isSearchable={false}
                        value={heightValue}
                        onChange={(option) => change({ yHeight: option.value })}
                        {...menuProps}
                    />
                </div>
            )}

            <fieldset className="criteria-form__field criteria-form__count" disabled={disabled}>
                <legend>Results</legend>
                {COUNT_OPTIONS.map((n) => (
                    <label key={n} className="criteria-form__radio">
                        <input
                            type="radio"
                            name={`${id}-count`}
                            value={n}
                            checked={count === n}
                            onChange={() => change({ count: n })}
                        />
                        {n}
                    </label>
                ))}
            </fieldset>

            <div className="criteria-form__field">
                <button
                    type="button"
                    className="btn btn--full criteria-form__advanced-toggle"
                    aria-expanded={advancedOpen}
                    aria-controls={`${id}-advanced`}
                    disabled={disabled}
                    onClick={() => setAdvancedOpen((open) => !open)}
                >
                    Advanced
                </button>
                <div id={`${id}-advanced`} className="criteria-form__advanced" hidden={!advancedOpen}>
                    <label htmlFor={`${id}-start`}>Start seed</label>
                    <input
                        id={`${id}-start`}
                        className="input"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        value={startDraft}
                        disabled={disabled}
                        aria-invalid={startInvalid || undefined}
                        aria-describedby={`${id}-start-hint`}
                        onChange={(event) => {
                            const text = event.target.value;
                            // Blank = start from 0; a partial or invalid number keeps the last good one.
                            const parsed = text.trim() === '' ? 0n : parseSeed64(text);
                            setStartDraft(text, parsed ?? undefined);
                            if (parsed !== null) change({ startingSeed: parsed });
                        }}
                    />
                    <p id={`${id}-start-hint`} className="criteria-form__hint">
                        {startInvalid ? 'A whole number that fits in 64 bits.' : 'The first seed to check; blank starts at 0.'}
                    </p>

                    <label htmlFor={`${id}-exact-range`}>Exact range (blocks)</label>
                    <input
                        id={`${id}-exact-range`}
                        className="input"
                        type="number"
                        min={1}
                        max={2048}
                        step={1}
                        value={rangeDraft}
                        disabled={disabled}
                        onChange={(event) => {
                            const text = event.target.value;
                            // Any whole number is reported, so an out-of-range one shows the form's error.
                            const parsed = INTEGER.test(text.trim()) ? Number(text) : undefined;
                            setRangeDraft(text, parsed);
                            if (parsed !== undefined) change({ rangeBlocks: parsed });
                        }}
                    />

                    {hasHeight && (
                        <>
                            <label htmlFor={`${id}-exact-height`}>Exact height</label>
                            <input
                                id={`${id}-exact-height`}
                                className="input"
                                type="number"
                                min={HEIGHT_MIN}
                                max={HEIGHT_MAX}
                                step={1}
                                value={heightDraft}
                                disabled={disabled}
                                aria-invalid={heightInvalid || undefined}
                                aria-describedby={`${id}-height-hint`}
                                onChange={(event) => {
                                    const text = event.target.value;
                                    const n = Number(text);
                                    const valid = INTEGER.test(text.trim()) && n >= HEIGHT_MIN && n <= HEIGHT_MAX;
                                    setHeightDraft(text, valid ? n : undefined);
                                    if (valid) change({ yHeight: n });
                                }}
                            />
                            <p id={`${id}-height-hint`} className="criteria-form__hint">Y from {HEIGHT_MIN} to {HEIGHT_MAX}.</p>
                        </>
                    )}
                </div>
            </div>

            {removed && <p className="criteria-form__removed">{removed}</p>}
            <ul className="finder__warnings" role="status">
                {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
            <ul className="finder__errors" role="alert">
                {shownErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>

            <button type="submit" className="btn btn--primary btn--full criteria-form__search" disabled={!ok || disabled}>
                Search
            </button>
            {pendingNotes.map((note) => <p key={note} className="criteria-form__hint">{note}</p>)}
        </form>
    );
}
