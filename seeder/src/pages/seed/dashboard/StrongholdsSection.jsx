import { useState } from 'react';
import { VERSIONS } from '../../../util/constants';
import CopyButton from '../../../shared/CopyButton';
import HelpTip from '../../../shared/HelpTip';
import { HELP } from '../../../shared/help';
import { engineVersion } from '../../../util/seed';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { distanceBlocks, formatCoords, formatDistance } from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import ResultRow from './ResultRow';
import { SectionEmpty, SectionError, SectionLoading } from './Section';

// The first list; "Show all" asks for every stronghold the game places (128) and
// reveals them PAGE rows at a time. Collapsed, only the nearest one shows; "Show 7 more"
// opens the rest of the first list.
const FIRST = 8;
const COLLAPSED = 1;
const ALL = 128;
const PAGE = 32;

/*
 * One stronghold's portal room, analysed on demand: STRONGHOLD_ANALYSE walks hundreds
 * of pieces, so it runs for the row whose Analyse was clicked, never for all of them.
 * Before 1.13 the eye count is unknown (cubiomes has no loot salt there).
 */
function StrongholdAnalysis({ mcVersion, seed, x, z }) {
    const { data, loading, error } = useSeedQuery('STRONGHOLD_ANALYSE', { mcVersion, seed, x, z });
    if (error) return <SectionError error={error} />;
    if (loading || !data) return <SectionLoading />;
    const { eyes, libraries, portalX, portalZ } = data;
    return (
        <ul className="stronghold-analysis">
            <li>{eyes === -1 ? 'Eye count unknown before 1.13' : `${eyes} / 12 eyes in the portal room`}</li>
            <li>{libraries === 1 ? '1 library' : `${libraries} libraries`}</li>
            <li>Portal room at {formatCoords(portalX, portalZ)}</li>
        </ul>
    );
}

function StrongholdRow({ stronghold, world, canAnalyse, onShow }) {
    const [analysing, setAnalysing] = useState(false);
    const { x, z, ring, distance, approximate } = stronghold;
    const summary = (
        <>
            <span className="result-row__main"><code>{approximate ? '≈ ' : ''}{formatCoords(x, z)}</code></span>
            <span className="result-row__meta">Ring {ring + 1} · {formatDistance(distance)}</span>
        </>
    );
    return (
        <ResultRow summary={summary}>
            <CopyButton text={`${x}, ${z}`} label="Copy" />
            {onShow && <button type="button" className="btn" onClick={() => onShow(stronghold)}>Show on map</button>}
            {canAnalyse && !approximate && !analysing && (
                <button type="button" className="btn" onClick={() => setAnalysing(true)}>Analyse</button>
            )}
            {analysing && <StrongholdAnalysis mcVersion={world.mcVersion} seed={world.seed} x={x} z={z} />}
        </ResultRow>
    );
}

/*
 * Strongholds, nearest first from the spawn (Overworld) or the origin (Nether / End,
 * where they live in Overworld coordinates, so the map cannot show them).
 *
 * From 1.19.3 the 128 come approximate (±112 blocks: no biome search, far cheaper). The
 * first list keeps exact positions and Analyse; the others read "≈ (x, z)" and cannot be
 * analysed, since the analysis builds the stronghold at the given chunk and would
 * describe the wrong one.
 */
export default function StrongholdsSection() {
    const { world } = useDashboard();
    // Another seed or version is another list: "Show all", the page size and every open
    // analysis start over. A dimension change keeps them (same strongholds).
    return <StrongholdsList key={`${world.mcVersion}:${world.largeBiomes}:${world.seed}`} />;
}

function StrongholdsList() {
    const { world, mapApi, sheetApi } = useDashboard();
    const { seed, mcVersion, dimension, yHeight, largeBiomes } = world;
    // Strongholds are the Overworld's, wherever the page is.
    const overworldVersion = engineVersion(mcVersion, largeBiomes);
    const [showAll, setShowAll] = useState(false);
    const [visible, setVisible] = useState(COLLAPSED);
    const approx = mcVersion > VERSIONS['1.19.2'];

    // The same params as the Spawn section: one cached answer for both.
    const summary = useSeedQuery('SEED_SUMMARY', { mcVersion: engineVersion(mcVersion, largeBiomes, dimension), seed, dimension, yHeight });
    const list = useSeedQuery('STRONGHOLDS_LIST', { mcVersion: overworldVersion, seed, howMany: FIRST });
    // ~1.3 s for 128 exact: keeps the default low priority so the map's tiles keep a worker.
    const all = useSeedQuery('STRONGHOLDS_LIST', { mcVersion: overworldVersion, seed, howMany: ALL, approx }, { enabled: showAll });

    const overworld = dimension === 0;
    const error = list.error ?? (overworld ? summary.error : null);
    if (error) return <SectionError error={error} />;
    if (!list.data || (overworld && !summary.data)) return <SectionLoading />;

    const first = list.data.strongholds;
    if (first.length === 0) return <SectionEmpty>No strongholds in this version.</SectionEmpty>;

    const exact = new Map(first.map((s) => [s.index, s]));
    const source = showAll && all.data
        ? all.data.strongholds.map((s) => exact.get(s.index) ?? { ...s, approximate: approx })
        : first;
    const [cx, cz] = overworld ? [summary.data.spawnX, summary.data.spawnZ] : [0, 0];
    const rows = source
        .map((s) => ({ ...s, distance: distanceBlocks(cx, cz, s.x, s.z) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index);

    const showOnMap = overworld ? ({ x, z }) => {
        mapApi.current?.panTo(x, z);
        mapApi.current?.setHighlight({ x, z, label: 'Stronghold' });
        sheetApi.current?.close();
    } : null;
    const canAnalyse = mcVersion >= VERSIONS['1.8'];

    return (
        <>
            {!overworld && (
                <p className="section__note">Overworld coordinates. Switch to the Overworld to see them on the map.</p>
            )}
            <ul className="result-list" aria-label="Nearest strongholds">
                {rows.slice(0, visible).map((stronghold) => (
                    <StrongholdRow
                        key={stronghold.index}
                        stronghold={stronghold}
                        world={world}
                        canAnalyse={canAnalyse}
                        onShow={showOnMap}
                    />
                ))}
            </ul>
            {showAll && all.error && <SectionError error={all.error} />}
            {showAll && !all.data && !all.error && <SectionLoading />}
            {showAll && all.data && approx && (
                <p className="section__note">Positions approximate (±112 blocks). <HelpTip {...HELP.approxStrongholds} /></p>
            )}
            <div className="result-more">
                {!showAll && visible < first.length && (
                    <button type="button" className="btn" onClick={() => setVisible(first.length)}>
                        Show {first.length - visible} more
                    </button>
                )}
                {!showAll && visible >= first.length && first.length === FIRST && (
                    <button type="button" className="btn" onClick={() => { setShowAll(true); setVisible(FIRST + PAGE); }}>
                        Show all {ALL}
                    </button>
                )}
                {showAll && all.data && visible < rows.length && (
                    <button type="button" className="btn" onClick={() => setVisible((n) => n + PAGE)}>Show {PAGE} more</button>
                )}
                {visible > COLLAPSED && rows.length > COLLAPSED && (
                    <button type="button" className="btn" onClick={() => { setShowAll(false); setVisible(COLLAPSED); }}>Show fewer</button>
                )}
            </div>
            <p className="section__note">
                Strongholds generate in rings; the first ring holds 3 within about 2.8k blocks of the origin.
            </p>
        </>
    );
}
