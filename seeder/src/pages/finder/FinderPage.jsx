import { useCallback, useEffect, useMemo, useState } from 'react';
import GoogleAd from '../../shared/GoogleAd';
import { AD_SLOT_RESPONSIVE } from '../../shared/ads';
import { buildFinderUrl, parseFinderUrl } from '../../shared/finderUrl';
import { useSearchParamsState } from '../../shared/hooks/useSearchParamsState';
import { ALL_BIOME_IDS, useVersionSupport } from '../../shared/hooks/useVersionSupport';
import { useIsDesktop } from '../../shared/hooks/useMediaQuery';
import { useQueueManager } from '../../shared/hooks/useQueueManager';
import { versionLabelOf } from '../../shared/seedUrl';
import { useWorlds } from '../../shared/worlds';
import { createThumbnailRequester } from '../../library/thumbnail';
import CriteriaForm from './CriteriaForm';
import { validate } from './criteria';
// Explicit extension: presets.js and Presets.jsx differ only in case, and on a
// case-insensitive disk './Presets' resolves to presets.js first.
import Presets from './Presets.jsx';
import StatsBar from './StatsBar';
import ResultsGrid from './ResultsGrid';
import ShareToolbar from './ShareToolbar';
import { summaryOf } from './hitModel';
import { useFinderSearch } from './useFinderSearch';
import { useSeedsMode } from './useSeedsMode';
import './FinderPage.css';
import { supportsLargeBiomes } from '../../util/seed';

const buildUrl = (state) => buildFinderUrl(state.criteria, { seeds: state.seeds, start: state.start });

export const FIND_MORE_HINT = 'Continues from where the last search stopped; a few thousand candidates at the edge may be skipped.';

// One key per 64-bit seed, so a shared seed written unsigned (Minecraft accepts both)
// and the signed seed a search reports are the same row.
const seedKey = (seed) => String(BigInt.asIntN(64, BigInt(seed)));

/*
 * /finder/. The state is the URL (finderUrl.js): { criteria, seeds, start }, published
 * with replaceState on every change. A criteria URL never starts a search: Search does,
 * and so does a preset (it fills the form and searches at once; "Back to presets" next
 * to the title then returns to the first view). "Find more" continues the last run from its resumeSeed (or
 * a shared link from its `start`). Seeds mode (`seeds=` in the URL) describes the shared
 * seeds again without searching; any criteria change or Search leaves it.
 */
export default function FinderPage() {
    const [state, setState] = useSearchParamsState({ parse: parseFinderUrl, build: buildUrl });
    const { criteria } = state;
    const desktop = useIsDesktop();
    const queue = useQueueManager();
    // One probe per version, for every biome and every structure type: it gates the
    // form's options, the validation and the presets.
    const { support } = useVersionSupport(criteria.mcVersion, { biomeIds: ALL_BIOME_IDS });
    const search = useFinderSearch(queue);
    const searching = search.status === 'searching';
    const seedsMode = useSeedsMode(queue, { seeds: state.seeds, criteria });
    const inSeedsMode = state.seeds != null;
    // Rows of earlier "Find more" runs: search.start() resets the hook's hits.
    const [found, setFound] = useState([]);
    // One store for the page: two useWorlds() would not see each other's writes.
    const { add, isSaved } = useWorlds();

    // The one open result row (its map replaces its thumbnail), or null: nothing opens by itself.
    const [openSeed, setOpenSeed] = useState(null);
    const [expanded, setExpanded] = useState(false);
    // A preset's criteria waiting for its version's support (see applyPreset), or null.
    const [pendingPreset, setPendingPreset] = useState(null);
    // The rows on screen come from a preset: "Back to presets" starts over.
    const [fromPreset, setFromPreset] = useState(false);
    // The presets take the focus when they come back after "Back to presets".
    const [focusPresets, setFocusPresets] = useState(false);

    // One thumbnail requester per mount; each row asks it for its own size. Built in
    // the effect, not during render, so StrictMode's mount / unmount / mount leaves
    // exactly one live requester.
    const [thumbnails, setThumbnails] = useState(null);
    useEffect(() => {
        const thumbs = createThumbnailRequester(queue);
        setThumbnails(thumbs);
        return () => {
            thumbs.destroy();
            setThumbnails((current) => (current === thumbs ? null : current));
        };
    }, [queue]);

    const setCriteria = useCallback((next, { pruned = false } = {}) => {
        // The form's "Start seed" is the URL's `start` cursor. New criteria are not the
        // shared ones any more: seeds mode ends - unless the form only dropped what the
        // version cannot hold, which a shared link's rows survive.
        setState((s) => ({ ...s, criteria: next, start: next.startingSeed, seeds: pruned ? s.seeds : null }));
    }, [setState]);

    const onSearch = useCallback((next, { preset = false } = {}) => {
        if (searching) return;
        setPendingPreset(null);
        setFromPreset(preset);
        setFocusPresets(false);
        // The presets give way to the results: a chip clicked far down the list must not
        // leave the page scrolled into the middle of the new rows.
        if (preset) window.scrollTo({ top: 0 });
        setOpenSeed(null);
        setExpanded(false);
        setFound([]);
        setState((s) => (s.seeds == null ? s : { ...s, seeds: null }));
        search.start(next);
    }, [searching, search, setState]);

    // A preset fills the form and searches with those criteria at once. The search reads
    // `next` itself, never the URL state the first call has only scheduled. validate() is
    // stricter than presetAvailable(): a preset over a limit only fills the form. A pinned
    // preset may switch the version: it waits for that version's support, and any edit
    // of the form before it lands cancels the search.
    // A preset keeps the world type, as it keeps the version: it is the world being played.
    const applyPreset = useCallback((preset) => {
        const next = { ...preset, largeBiomes: !!criteria.largeBiomes && supportsLargeBiomes(preset.mcVersion) };
        setCriteria(next);
        if (support?.mcVersion !== next.mcVersion) setPendingPreset(next);
        else if (validate(next, support).ok) onSearch(next, { preset: true });
    }, [setCriteria, onSearch, support, criteria.largeBiomes]);
    useEffect(() => {
        if (!pendingPreset || support?.mcVersion !== pendingPreset.mcVersion) return;
        setPendingPreset(null);
        if (validate(pendingPreset, support).ok) onSearch(pendingPreset, { preset: true });
    }, [pendingPreset, support, onSearch]);
    const onFormChange = useCallback((next, options) => {
        if (!options?.pruned) setPendingPreset(null);
        setCriteria(next, options);
    }, [setCriteria]);

    // "Back to presets": the first view again - the form as the preset left it, the
    // presets, no rows. A running search is stopped.
    const startOver = useCallback(() => {
        search.reset();
        setFound([]);
        setOpenSeed(null);
        setExpanded(false);
        setFromPreset(false);
        setFocusPresets(true);
    }, [search]);

    const { hits } = search;
    // Shared rows first, then what the searches found, each seed once.
    const views = useMemo(() => {
        const seen = new Set();
        const out = [];
        const add = (view) => {
            const key = seedKey(view.seed);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(view);
        };
        seedsMode.views.forEach(add);
        // A shared seed still loading keeps its place: a hit equal to it is not a new row.
        for (const seed of state.seeds ?? []) seen.add(seedKey(seed));
        found.forEach(add);
        hits.forEach(add);
        return out;
    }, [seedsMode.views, state.seeds, found, hits]);

    // Share URLs describe the last run, or the shared URL's criteria before any run.
    const shareCriteria = search.criteria ?? criteria;
    const cursor = search.result?.resumeSeed ?? search.criteria?.startingSeed ?? state.start;

    // The last run's criteria from its resumeSeed, or a shared link's from its `start`.
    const findMore = useCallback(() => {
        if (searching) return;
        const from = search.result?.resumeSeed ?? state.start;
        if (hits.length > 0) setFound((list) => [...list, ...hits]);
        search.start({ ...(search.criteria ?? criteria), startingSeed: from });
    }, [searching, search, hits, criteria, state.start]);

    const onOpen = useCallback((seed) => setOpenSeed(seed), []);
    const onClose = useCallback((seed) => setOpenSeed((s) => (s === seed ? null : s)), []);
    const saved = useCallback((view) => isSaved(view.seed, versionLabelOf(view.mcVersion), view.dimension, view.largeBiomes), [isSaved]);
    const onSave = useCallback((view) => {
        add({ name: `Seed ${view.seed}`, seed: view.seed, version: versionLabelOf(view.mcVersion), dimension: view.dimension, largeBiomes: view.largeBiomes });
    }, [add]);

    const ran = search.status !== 'idle';
    // Seeds mode reads like a finished run: the rows are the content.
    const settledView = ran || inSeedsMode;
    const collapsed = !desktop && settledView && !expanded;
    const showPresets = !settledView || (!desktop && expanded);
    const seedsLoading = seedsMode.status === 'loading';
    const hasRows = views.length > 0;
    const showToolbar = hasRows || inSeedsMode;
    // Once rows are on screen and something produced them: a run or a shared link.
    const showFindMore = hasRows && (ran || inSeedsMode);
    const findMoreDisabled = searching || seedsLoading || search.result?.reason === 'error';
    const showBack = fromPreset && ran && !inSeedsMode;

    // On a phone the first row must show without scrolling: the ad waits under it
    // (never between STOP and the rows), and nothing shows while no row exists.
    const resultsAd = <GoogleAd slot={AD_SLOT_RESPONSIVE} className="finder__ad finder__ad--results" />;

    return (
        <div className={`finder ${desktop ? 'finder--desktop' : 'finder--phone'}`}>
            <div className={collapsed ? 'finder__intro finder__intro--compact' : 'finder__intro'}>
                <h1>Minecraft seed finder</h1>
                {/* The compact phone line has no room for the full label: it stays the name. */}
                {showBack && (
                    <button type="button" className="btn finder__back" aria-label={collapsed ? 'Back to presets' : undefined} onClick={startOver}>
                        {collapsed ? 'Presets' : 'Back to presets'}
                    </button>
                )}
            </div>
            <div className="finder__grid">
                {/* Collapsed on a phone: the criteria are one line in the status box. */}
                {!collapsed && (
                    <aside className="finder__criteria">
                        <CriteriaForm criteria={criteria} onChange={onFormChange} onSearch={onSearch} support={support} disabled={searching} />
                    </aside>
                )}
                <section className="finder__results" aria-label="Results">
                    {showPresets && <Presets mcVersion={criteria.mcVersion} support={support} onApply={applyPreset} disabled={searching} focusTitle={focusPresets} />}
                    <div className="finder__slot finder__slot--results">
                        {/* Not sticky: nothing may slide over an ad. */}
                        {(ran || showToolbar || collapsed) && (
                            <div className="finder__status">
                                {collapsed && (
                                    <div className="finder__summary">
                                        <p className="finder__summary-text">{summaryOf(search.criteria ?? criteria)}</p>
                                        <button type="button" className="btn finder__toolbar-btn" onClick={() => setExpanded(true)}>Edit criteria</button>
                                    </div>
                                )}
                                <StatsBar
                                    status={search.status}
                                    progress={search.progress}
                                    target={search.criteria?.count}
                                    result={search.result}
                                    criteria={search.criteria}
                                    onStop={search.stop}
                                />
                                {showToolbar && (
                                    <ShareToolbar
                                        criteria={shareCriteria}
                                        views={views}
                                        cursor={cursor}
                                        canShareNative={typeof navigator.share === 'function'}
                                        collapsible={!desktop}
                                    />
                                )}
                            </div>
                        )}
                        {desktop && resultsAd}
                        {hasRows && (
                            <ResultsGrid
                                hits={views}
                                thumbnails={thumbnails}
                                openSeed={openSeed}
                                onOpen={onOpen}
                                onClose={onClose}
                                saved={saved}
                                onSave={onSave}
                                criteriaSummary={summaryOf(shareCriteria)}
                                afterFirst={desktop ? null : resultsAd}
                            />
                        )}
                        {showFindMore && (
                            <div className="finder__more">
                                <button
                                    type="button"
                                    className="btn btn--primary finder__more-btn"
                                    title={FIND_MORE_HINT}
                                    onClick={findMore}
                                    disabled={findMoreDisabled}
                                >
                                    Find more
                                </button>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
