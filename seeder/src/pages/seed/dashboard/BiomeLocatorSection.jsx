import { useMemo, useState } from 'react';
import Select from 'react-select';
import { BIOMES, VERSIONS } from '../../../util/constants';
import CopyButton from '../../../shared/CopyButton';
import { defaultSessionStorage, useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { ALL_BIOME_IDS, biomesIn, useVersionSupport } from '../../../shared/hooks/useVersionSupport';
import { biomeLabel, distanceBlocks, formatCoords, formatDistance } from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import { SectionEmpty, SectionError, SectionLoading } from './Section';
import ResultRow from './ResultRow';

// The engine's biome_centers fits 2032 blocks on 1.18+ and ~1200-1370 before (heap):
// the UI offers 1k everywhere and 2k (2000 blocks) from 1.18 only.
export const RADII = [1000, 2000];
const TWO_K_FROM = VERSIONS['1.18'];
export const FIRST_PATCHES = 8;
export const LOCATOR_STORAGE_KEY = 'seeder.locator.biome';
const MIN_SIZE_CELLS = 4;
const MAX_PATCHES = 32;

// Cave biomes live underground: at the default Y 256 they are never found.
const CAVE_BIOMES = new Set(BIOMES.filter((b) => ['Dripstone Caves', 'Lush Caves', 'Deep Dark'].includes(b.label)).map((b) => b.value));

// As in ControlsBlock: the panel scrolls and would clip an open menu, so it goes on the body.
const menuProps = {
    menuPortalTarget: document.body,
    menuPosition: 'fixed',
    styles: { menuPortal: (base) => ({ ...base, zIndex: 'var(--z-overlay)' }) },
};

const radiusText = (radius) => `${radius / 1000}k`;

function errorMessage(error, biome, versionLabel) {
    if (error.code === -6) return `The engine cannot locate ${biome} on ${versionLabel}.`;
    if (error.code === -8) return 'That radius is too large for this version. Use 1k.';
    if (error.code === -1) return 'Not available on Beta 1.7.';
    return error.message;
}

/*
 * Biome locator: the nearest patches of a biome around the spawn (BIOME_CENTERS, low
 * priority). Overworld only, like the engine (biome_centers answers -2 elsewhere).
 * Nothing is asked before Find: 2000 blocks cost ~0.75 s on 26.3.
 */
export default function BiomeLocatorSection() {
    const { world } = useDashboard();
    if (world.dimension !== 0) return <p className="section__note">The biome locator works in the Overworld.</p>;
    // Another world is another search: the results and the radius must not carry over.
    return <Locator key={`${world.mcVersion}:${world.seed}`} />;
}

function Locator() {
    const { world, mapApi, sheetApi } = useDashboard();
    const { seed, mcVersion, yHeight, versionLabel } = world;
    const [storedBiome, setStoredBiome] = useLocalStorage(LOCATOR_STORAGE_KEY, null, { storage: defaultSessionStorage() });
    const [radius, setRadius] = useState(RADII[0]);
    // What Find was pressed for; the results show only while the form still says that.
    const [asked, setAsked] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const twoK = mcVersion >= TWO_K_FROM;

    const version = useVersionSupport(mcVersion, { biomeIds: ALL_BIOME_IDS, structTypes: [] });
    // Spawn's params: one cached answer.
    const summary = useSeedQuery('SEED_SUMMARY', { mcVersion, seed, dimension: 0, yHeight });
    const options = useMemo(() => {
        const support = version.support;
        if (!support) return [];
        const here = new Set(biomesIn(support, 0));
        return BIOMES
            .filter((b) => here.has(b.value))
            .map((b) => ({ value: b.value, label: b.label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [version.support]);
    // A biome remembered from another version that this one lacks: nothing is chosen.
    const chosen = options.find((o) => o.value === storedBiome) ?? null;
    const biomeId = chosen?.value ?? null;

    const centre = summary.data ? [summary.data.spawnX, summary.data.spawnZ] : null;
    const current = asked && asked.biomeId === biomeId && asked.radius === radius && asked.yHeight === yHeight;
    const patches = useSeedQuery('BIOME_CENTERS', {
        mcVersion, seed, dimension: 0, biomeId, x: centre?.[0], z: centre?.[1],
        radiusBlocks: radius, yHeight, minSizeCells: MIN_SIZE_CELLS, nmax: MAX_PATCHES,
    }, { enabled: Boolean(current) && centre !== null });

    const error = version.error ?? summary.error;
    if (error) return <SectionError error={error} />;
    if (!version.support) return <SectionLoading />;

    const choose = (option) => {
        setStoredBiome(option?.value ?? null);
        setAsked(null);
        setExpanded(false);
    };
    const pickRadius = (r) => {
        setRadius(r);
        setAsked(null);
        setExpanded(false);
    };
    const find = () => {
        setAsked({ biomeId, radius, yHeight });
        setExpanded(false);
    };

    return (
        <>
            <div className="locator-form">
                <div className="locator-form__biome">
                    <Select
                        aria-label="Biome to locate"
                        placeholder="Choose a biome…"
                        options={options}
                        value={chosen}
                        onChange={choose}
                        {...menuProps}
                    />
                </div>
                <div className="locator-form__radius" role="group" aria-label="Radius">
                    {RADII.map((r) => (
                        <button
                            key={r}
                            type="button"
                            className="btn"
                            aria-pressed={radius === r}
                            disabled={r > RADII[0] && !twoK}
                            onClick={() => pickRadius(r)}
                        >
                            {radiusText(r)}
                        </button>
                    ))}
                </div>
                <button type="button" className="btn btn--primary" disabled={biomeId === null || centre === null} onClick={find}>
                    Find
                </button>
            </div>
            {!twoK && <p className="locator-hint">2k needs 1.18+ (engine memory)</p>}
            {current && (
                <Patches
                    query={patches}
                    ask={asked}
                    centre={centre}
                    versionLabel={versionLabel}
                    twoK={twoK}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    mapApi={mapApi}
                    sheetApi={sheetApi}
                />
            )}
        </>
    );
}

function Patches({ query, ask, centre, versionLabel, twoK, expanded, setExpanded, mapApi, sheetApi }) {
    const biome = biomeLabel(ask.biomeId);
    if (query.error) return <SectionError error={{ ...query.error, message: errorMessage(query.error, biome, versionLabel) }} />;
    if (!query.data) return <SectionLoading />;

    const [cx, cz] = centre;
    const rows = query.data.centers
        .map(({ x, z, size }) => ({ x, z, size, distance: distanceBlocks(cx, cz, x, z) }))
        .sort((a, b) => a.distance - b.distance);
    if (rows.length === 0) {
        return (
            <>
                <SectionEmpty>No {biome} within {radiusText(ask.radius)} blocks of spawn.</SectionEmpty>
                {ask.radius === RADII[0] && twoK && <p className="locator-hint">Try 2k.</p>}
                {/* Already searched underground: the advice would be wrong. */}
                {CAVE_BIOMES.has(ask.biomeId) && ask.yHeight > 0 && (
                    <p className="locator-hint">Cave biomes show at low heights: set Biome height to Y 0 first.</p>
                )}
            </>
        );
    }

    const showOnMap = ({ x, z }) => {
        mapApi.current?.panTo(x, z);
        mapApi.current?.setHighlight({ x, z, label: biome });
        // On a phone the sheet covers the map: get out of the way.
        sheetApi.current?.close();
    };
    const visible = expanded ? rows : rows.slice(0, FIRST_PATCHES);
    const hidden = rows.length - FIRST_PATCHES;
    return (
        <>
            <ul className="result-list" aria-label="Biome patches">
                {visible.map((row) => {
                    // `size` is in 1:4 cells: a square of the same area, in blocks.
                    const side = Math.round(Math.sqrt(row.size) * 4);
                    return (
                        <ResultRow
                            key={`${row.x}:${row.z}`}
                            summary={(
                                <>
                                    <span className="result-row__main">
                                        <code>{formatCoords(row.x, row.z)}</code>
                                        <span>{formatDistance(row.distance)}</span>
                                    </span>
                                    <span className="result-row__meta">~{side}×{side} blocks</span>
                                </>
                            )}
                        >
                            <CopyButton text={`${row.x}, ${row.z}`} label="Copy" />
                            <button type="button" className="btn" onClick={() => showOnMap(row)}>Show on map</button>
                        </ResultRow>
                    );
                })}
            </ul>
            {hidden > 0 && (
                <div className="result-more">
                    <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
                        {expanded ? 'Show fewer' : `Show ${hidden} more`}
                    </button>
                </div>
            )}
        </>
    );
}
