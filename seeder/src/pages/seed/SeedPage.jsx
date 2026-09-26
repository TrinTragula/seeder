import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRandomSeed } from '../../util/seed';
import { DEFAULT_VIEW, buildSeedUrl, parseSeedPage, versionLabelOf } from '../../shared/seedUrl';
import { useSearchParamsState } from '../../shared/hooks/useSearchParamsState';
import { useQueueManager } from '../../shared/hooks/useQueueManager';
import { ALL_BIOME_IDS, biomesIn, structureTypesIn, useVersionSupport } from '../../shared/hooks/useVersionSupport';
import { saveLastSeed } from '../../shared/worlds';
import MapCanvas from '../../shared/MapCanvas';
import SeedInput from '../../shared/SeedInput';
import WhatsNew from '../../shared/WhatsNew';
import BottomSheet from '../../shared/BottomSheet';
import { useIsDesktop } from '../../shared/hooks/useMediaQuery';
import SeedPanel from './dashboard/SeedPanel';
import ControlsBlock from './dashboard/ControlsBlock';
import './SeedPage.css';

// The phone sheet's collapsed height: the grip, the seed row and the tab strip. Must
// equal --sheet-collapsed as SeedPage.css sets it for this page.
const SHEET_COLLAPSED = 124;
const SHEET_SNAPS = { collapsed: SHEET_COLLAPSED, half: 0.5, full: 1 };

/*
 * /seed/: the map plus the panel (controls, ads, dashboard). Seed, version and
 * dimension live in the URL. Desktop shows the panel in a right column, phones in a
 * bottom sheet whose collapsed header is the seed row.
 */
export default function SeedPage() {
    const [urlState, setUrlState] = useSearchParamsState({
        parse: parseSeedPage,
        build: buildSeedUrl,
        title: (state) => `Seed ${state.seed} (${versionLabelOf(state.mcVersion)}) - Seeder`,
    });
    const { seed, mcVersion, dimension } = urlState;
    // from=legacy is gone after the first replaceState, so it is read before any effect.
    // So is the view (structures, overlays, height) a link opened the page with: it seeds
    // the controls' state once, here; from then on that state writes the URL.
    const [{ fromLegacy, view: linkView }] = useState(() => {
        const { fromLegacy: legacy, view } = parseSeedPage(window.location.search);
        return { fromLegacy: legacy, view: { ...DEFAULT_VIEW, ...view } };
    });

    // Re-entering the current seed keeps the state object, so nothing re-renders.
    const setSeed = useCallback((value) => setUrlState((state) => (
        String(value) === state.seed ? state : { ...state, seed: String(value) }
    )), [setUrlState]);
    const setMcVersion = useCallback((value) => setUrlState((state) => ({ ...state, mcVersion: value })), [setUrlState]);
    const setDimension = useCallback((value) => setUrlState((state) => ({ ...state, dimension: value ?? 0 })), [setUrlState]);

    const [yHeight, setYHeight] = useState(linkView.yHeight);
    // Every type ever picked; the map shows those this version has in this dimension, so
    // a pick comes back when the user returns to a world where it applies.
    const [structuresToShow, setStructuresToShow] = useState(() => [...linkView.structures]);
    const [showStructureCoords, setShowStructureCoords] = useState(linkView.showCoords);
    const [showLegend, setShowLegend] = useState(false);
    // The slime-chunk grid on the map. Here rather than in a section so that every section
    // offering the toggle (Find near me, Farms) shares it, and it outlives dimension changes
    // (the grid draws in the Overworld only; the sections hide the toggle elsewhere).
    const [slimeOverlay, setSlimeOverlay] = useState(linkView.slime);
    // Chunk grid lines on the map (the controls' checkbox; drawn from zoom 3).
    const [showChunkGrid, setShowChunkGrid] = useState(linkView.grid);
    const overlays = useMemo(() => ({ slime: slimeOverlay, chunkGrid: showChunkGrid }), [slimeOverlay, showChunkGrid]);
    // True from a seed change until its spawn is known: holds the Random button.
    const [busy, setBusy] = useState(false);
    const mapApi = useRef(null);
    // open(snap) / close() / getSnap() of the phone layout's sheet (null on desktop).
    const sheetApi = useRef(null);
    const desktop = useIsDesktop();
    // Where the dashboard's tab strip goes on a phone: the sheet's header (null on desktop).
    const [tabsHost, setTabsHost] = useState(null);
    const queue = useQueueManager();

    // What this version has here: the structure types the controls offer and the map
    // draws, and the biomes the legend lists. null while unknown (then: everything).
    const { support } = useVersionSupport(mcVersion, { biomeIds: ALL_BIOME_IDS });
    const availableStructures = useMemo(() => (support ? structureTypesIn(support, dimension) : null), [support, dimension]);
    const legendBiomes = useMemo(() => (support ? biomesIn(support, dimension) : null), [support, dimension]);
    // The map draws nothing until the support is known: the drawer clears on a world
    // change anyway, and a pick that does not apply here must never be asked for.
    const shownStructures = useMemo(
        () => (availableStructures ? structuresToShow.filter((type) => availableStructures.includes(type)) : []),
        [availableStructures, structuresToShow],
    );

    // The landing's last-seed section reopens whatever was looked at last, so every seed
    // that reaches the map is remembered.
    useEffect(() => {
        saveLastSeed({ seed, version: versionLabelOf(mcVersion), dimension });
    }, [seed, mcVersion, dimension]);

    const versionLabel = versionLabelOf(mcVersion);
    const view = useMemo(
        () => ({ structures: structuresToShow, showCoords: showStructureCoords, slime: slimeOverlay, grid: showChunkGrid, yHeight }),
        [structuresToShow, showStructureCoords, slimeOverlay, showChunkGrid, yHeight],
    );
    // The address bar and the Share box carry the view too (owner, 2026-09-26), so a
    // reload or a copied address keeps it. useSearchParamsState writes the canonical URL
    // on world changes; this effect runs after it in the same commit and adds the view.
    // replaceState, like the hook: toggles never add history entries.
    useEffect(() => {
        window.history.replaceState(null, '', buildSeedUrl(urlState, { view }));
    }, [urlState, view]);
    const shareUrl = buildSeedUrl(urlState, { absolute: true, view });
    const finderUrl = `/finder/?${new URLSearchParams({ version: versionLabel, dim: String(dimension) })}`;

    // First in the panel on both layouts (above the seed box on desktop).
    const whatsNew = <WhatsNew show={fromLegacy} />;
    // The seed box of the desktop column; on a phone the sheet's header is the seed row.
    const seedBox = (
        <>
            <h1 className="seed-page__title margin-3">Seed</h1>
            <div className="margin-3">
                <SeedInput
                    value={seed}
                    onSubmit={setSeed}
                    onRandom={() => setSeed(getRandomSeed())}
                    disabled={busy}
                />
            </div>
        </>
    );
    // Everything else the panel holds, rendered by either layout: the controls, the
    // ads and the dashboard sections.
    const world = { seed, mcVersion, dimension, yHeight, versionLabel };
    const panel = (
        <SeedPanel
            world={world}
            mapApi={mapApi}
            sheetApi={sheetApi}
            structuresToShow={structuresToShow}
            setStructuresToShow={setStructuresToShow}
            slimeOverlay={slimeOverlay}
            setSlimeOverlay={setSlimeOverlay}
            setDimension={setDimension}
            tabsHost={desktop ? null : tabsHost}
            controls={(
                <ControlsBlock
                    world={world}
                    yHeight={yHeight}
                    setYHeight={setYHeight}
                    setMcVersion={setMcVersion}
                    setDimension={setDimension}
                    structuresToShow={structuresToShow}
                    setStructuresToShow={setStructuresToShow}
                    availableStructures={availableStructures}
                    legendBiomes={legendBiomes}
                    showStructureCoords={showStructureCoords}
                    setShowStructureCoords={setShowStructureCoords}
                    showChunkGrid={showChunkGrid}
                    setShowChunkGrid={setShowChunkGrid}
                    showLegend={showLegend}
                    setShowLegend={setShowLegend}
                    colors={queue.COLORS}
                    mapApi={mapApi}
                    shareUrl={shareUrl}
                    finderUrl={finderUrl}
                />
            )}
        />
    );

    return (
        <div className="seed-page flex-row">
            {/*
              * MapCanvas stays the first child in both layouts: only its sibling switches,
              * so a rotation or resize across the breakpoint never remounts the map (which
              * would drop every tile).
              */}
            <MapCanvas
                mcVersion={mcVersion}
                seed={seed}
                dimension={dimension}
                yHeight={yHeight}
                structuresToShow={shownStructures}
                showStructureCoords={showStructureCoords}
                overlays={overlays}
                onBusy={setBusy}
                apiRef={mapApi}
                exposeGlobal
                className="flex-5"
            />
            {/* id="dashboard": the target of the what's-new card's in-page link, in both layouts. */}
            {desktop ? (
                <aside id="dashboard" className="seed-panel flex-2 overflow-auto">
                    {whatsNew}
                    {seedBox}
                    {panel}
                </aside>
            ) : (
                <BottomSheet
                    snapPoints={SHEET_SNAPS}
                    header={(
                        <>
                            <SeedInput
                                compact
                                value={seed}
                                onSubmit={setSeed}
                                onRandom={() => setSeed(getRandomSeed())}
                                disabled={busy}
                            />
                            {/* The dashboard's tab strip lands here (SeedPanel portals it). */}
                            <div ref={setTabsHost} className="seed-page__tabs" />
                        </>
                    )}
                    apiRef={sheetApi}
                    ariaLabel="World details"
                    contentId="dashboard"
                >
                    {whatsNew}
                    {panel}
                </BottomSheet>
            )}
        </div>
    );
}
