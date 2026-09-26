import { useState } from 'react';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../../util/constants';
import { STRUCTURE_ICONS } from '../../../library/draw';
import CopyButton from '../../../shared/CopyButton';
import HelpTip from '../../../shared/HelpTip';
import { HELP } from '../../../shared/help';
import { defaultSessionStorage, useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { useQueueManager } from '../../../shared/hooks/useQueueManager';
import { engineVersion } from '../../../util/seed';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { structureTypesIn, useVersionSupport } from '../../../shared/hooks/useVersionSupport';
import {
    biomeLabel, dimensionLabel, distanceBlocks, formatCoords, formatDistance, nether, overworld,
} from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import { SectionEmpty, SectionError, SectionLoading } from './Section';
import ResultRow from './ResultRow';
import StructureRows from './StructureRows';
import { BiomeSwatch } from './SpawnSection';
import { FIRST_STRUCTURES } from './StructuresSection';
import { Block } from './Block';
import { SLIME_REACH, SlimeChunks } from './SlimeChunks';

// The last located point, { x, z, y } (y null when left blank), for the browser session.
export const WHERE_STORAGE_KEY = 'seeder.where.v1';
// The world border, and the build height range of 1.18+.
const MAX_XZ = 30_000_000;
const MIN_Y = -64;
const MAX_Y = 320;
// Nearest structures are searched this far around the point (~8 ms on 26.3).
const STRUCTURE_RADIUS = 2048;
// Strongholds' "Show all" question, so both sections share one cached answer.
const STRONGHOLDS = 128;
const OPTION_OF = new Map(STRUCTURES_OPTIONS.map((s, order) => [s.value, { ...s, order }]));

const WHOLE = /^-?\d+$/;

// The form's text as a point, or null when it is not one: X and Z whole numbers inside
// the world border, Y blank or a whole number in the build height range.
export function parsePoint({ x, z, y }) {
    const whole = (text, min, max) => {
        const trimmed = text.trim();
        if (!WHOLE.test(trimmed)) return null;
        const n = Number(trimmed);
        return n >= min && n <= max ? n : null;
    };
    const px = whole(x, -MAX_XZ, MAX_XZ);
    const pz = whole(z, -MAX_XZ, MAX_XZ);
    if (px === null || pz === null) return null;
    if (y.trim() === '') return { x: px, z: pz, y: null };
    const py = whole(y, MIN_Y, MAX_Y);
    return py === null ? null : { x: px, z: pz, y: py };
}

// What the form shows for a stored point (anything else in storage is ignored).
function formOf(stored) {
    const text = (n) => (Number.isInteger(n) ? String(n) : '');
    if (!Number.isInteger(stored?.x) || !Number.isInteger(stored?.z)) return { x: '', z: '', y: '' };
    return { x: text(stored.x), z: text(stored.z), y: text(stored.y) };
}

/*
 * Find near me (section id `where`): the world around the coordinates you stand at.
 * Nothing is asked before Locate, not even the version probe.
 */
export default function WhereAmISection() {
    const { world } = useDashboard();
    // Another world is another answer: the stored point survives, the results do not.
    return <WhereAmI key={`${world.mcVersion}:${world.largeBiomes}:${world.seed}:${world.dimension}`} />;
}

function WhereAmI() {
    const { world } = useDashboard();
    const [stored, setStored] = useLocalStorage(WHERE_STORAGE_KEY, null, { storage: defaultSessionStorage() });
    const [form, setForm] = useState(() => formOf(stored));
    // The point Locate was pressed for; any edit of the form clears it (and the results).
    const [asked, setAsked] = useState(null);
    const [invalid, setInvalid] = useState(false);

    const change = (field) => (event) => {
        const { value } = event.target;
        setForm((current) => ({ ...current, [field]: value }));
        setAsked(null);
        setInvalid(false);
    };
    const locate = (event) => {
        event.preventDefault();
        const point = parsePoint(form);
        setInvalid(point === null);
        setAsked(point);
        if (point) setStored(point);
    };
    const field = (name, label, placeholder, modifier = '') => (
        <label className={`where-form__field${modifier}`}>
            <span>{name.toUpperCase()}</span>
            <input
                className="input"
                type="number"
                step="1"
                inputMode="numeric"
                aria-label={label}
                placeholder={placeholder}
                value={form[name]}
                onChange={change(name)}
            />
        </label>
    );

    return (
        <>
            {/* noValidate: the browser's own step check would swallow the submit, and the alert below with it. */}
            <form className="where-form" onSubmit={locate} noValidate>
                {field('x', 'X coordinate')}
                {field('z', 'Z coordinate')}
                {field('y', 'Y coordinate (optional)', String(world.yHeight), ' where-form__field--y')}
                <button type="submit" className="btn btn--primary">Locate</button>
            </form>
            {invalid && <p className="section__error" role="alert">Enter whole-number coordinates.</p>}
            {asked && <Results point={asked} />}
        </>
    );
}

function Results({ point }) {
    const { world, mapApi, sheetApi, slimeOverlay, setSlimeOverlay } = useDashboard();
    const colors = useQueueManager().COLORS;
    const { seed, mcVersion, dimension, yHeight, versionLabel, largeBiomes } = world;
    const worldVersion = engineVersion(mcVersion, largeBiomes, dimension);
    const { x, z } = point;
    const y = point.y ?? yHeight;
    const inOverworld = dimension === 0;
    const approx = mcVersion > VERSIONS['1.19.2'];

    const biome = useSeedQuery('BIOME_AT', { mcVersion: worldVersion, seed, dimension, x, y, z });
    const surface = useSeedQuery('APPROX_HEIGHT', { mcVersion: worldVersion, seed, dimension, x, z });
    const strongholds = useSeedQuery('STRONGHOLDS_LIST', { mcVersion: engineVersion(mcVersion, largeBiomes), seed, howMany: STRONGHOLDS, approx }, { enabled: inOverworld });
    const version = useVersionSupport(mcVersion);
    const types = version.support ? structureTypesIn(version.support, dimension) : [];
    const nearest = useSeedQuery('NEAREST_STRUCTURES', {
        mcVersion: worldVersion, seed, dimension, x, z, types, maxRadiusBlocks: STRUCTURE_RADIUS,
    }, { enabled: types.length > 0 });
    const slime = useSeedQuery('SLIME_CHUNKS', {
        seed, cx0: (x >> 4) - SLIME_REACH, cz0: (z >> 4) - SLIME_REACH, w: 2 * SLIME_REACH, h: 2 * SLIME_REACH,
    }, { enabled: inOverworld });

    const showOnMap = (tx, tz, label) => {
        mapApi.current?.panTo(tx, tz);
        mapApi.current?.setHighlight({ x: tx, z: tz, label });
        // On a phone the sheet covers the map: get out of the way.
        sheetApi.current?.close();
    };

    return (
        <>
            <Facts biome={biome} surface={surface} point={point} y={y} dimension={dimension} colors={colors} />
            {inOverworld && <NearestStronghold query={strongholds} point={point} approx={approx} onShow={showOnMap} />}
            <NearestStructures
                version={version}
                types={types}
                query={nearest}
                point={point}
                world={world}
                versionLabel={versionLabel}
                onShow={({ x: sx, z: sz, pureText }) => showOnMap(sx, sz, pureText)}
            />
            {inOverworld && (
                <SlimeChunks
                    query={slime}
                    point={point}
                    onShow={showOnMap}
                    slimeOverlay={slimeOverlay}
                    setSlimeOverlay={setSlimeOverlay}
                />
            )}
            <button type="button" className="btn btn--primary" onClick={() => showOnMap(x, z, 'You')}>Centre map here</button>
        </>
    );
}

// Biome, surface and the other dimension's coordinates: one block of label / value rows.
function Facts({ biome, surface, point, y, dimension, colors }) {
    const error = biome.error ?? surface.error;
    if (error) return <SectionError error={error} />;
    if (!biome.data || !surface.data) return <SectionLoading />;
    const { x, z } = point;
    // One Nether block is eight Overworld blocks; the End has no counterpart.
    let conversion = null;
    if (dimension === 0) conversion = { label: 'In the Nether', x: nether(x), z: nether(z) };
    if (dimension === -1) conversion = { label: 'In the Overworld', x: overworld(x), z: overworld(z) };
    const { height } = surface.data;
    return (
        <dl className="kv">
            <div className="kv__row">
                <dt>Biome</dt>
                <dd className="where-biome"><BiomeSwatch colors={colors} id={biome.data.biome} /><span>{biomeLabel(biome.data.biome)} at Y {y}</span></dd>
            </div>
            {height != null && (
                <div className="kv__row">
                    <dt>Surface</dt>
                    <dd>≈ Y {height}</dd>
                </div>
            )}
            {conversion && (
                <div className="kv__row">
                    <dt>{conversion.label} <HelpTip {...HELP.netherCoords} /></dt>
                    <dd>
                        <code>{formatCoords(conversion.x, conversion.z)}</code>
                        <CopyButton text={`${conversion.x}, ${conversion.z}`} label="Copy" />
                    </dd>
                </div>
            )}
        </dl>
    );
}

// The stronghold nearest to the point, out of all 128 (approximate from 1.19.3).
function NearestStronghold({ query, point, approx, onShow }) {
    let body;
    if (query.error) body = <SectionError error={query.error} />;
    else if (!query.data) body = <SectionLoading />;
    else if (query.data.strongholds.length === 0) body = <SectionEmpty>No strongholds in this version.</SectionEmpty>;
    else {
        const [nearest] = query.data.strongholds
            .map((s) => ({ ...s, distance: distanceBlocks(point.x, point.z, s.x, s.z) }))
            .sort((a, b) => a.distance - b.distance || a.index - b.index);
        const { x, z, ring, distance } = nearest;
        body = (
            <>
                <ul className="result-list" aria-label="Nearest stronghold">
                    <ResultRow
                        summary={(
                            <>
                                <span className="result-row__main"><code>{approx ? '≈ ' : ''}{formatCoords(x, z)}</code></span>
                                <span className="result-row__meta">{formatDistance(distance)} · Ring {ring + 1}</span>
                            </>
                        )}
                    >
                        <CopyButton text={`${x}, ${z}`} label="Copy" />
                        <button type="button" className="btn" onClick={() => onShow(x, z, 'Stronghold')}>Show on map</button>
                    </ResultRow>
                </ul>
                {approx && <p className="section__note">Positions approximate (±112 blocks).</p>}
            </>
        );
    }
    return <Block title="Nearest stronghold">{body}</Block>;
}

// The nearest structure of every type of this version and dimension, within 2k blocks.
function NearestStructures({ version, types, query, point, world, versionLabel, onShow }) {
    const [expanded, setExpanded] = useState(false);
    const error = version.error ?? query.error;
    let body;
    if (error) body = <SectionError error={error} />;
    else if (!version.support) body = <SectionLoading />;
    else if (types.length === 0) {
        body = <SectionEmpty>No structures exist for {versionLabel} in the {dimensionLabel(world.dimension)}.</SectionEmpty>;
    } else if (!query.data) body = <SectionLoading />;
    else {
        // As in the Structures section: found ones nearest first, then the ones with none
        // in reach, both in option order on ties; -1 (not in this version / dimension) dropped.
        const rows = query.data.results
            .filter((r) => r.found === 1 || r.found === 0)
            .map(({ type, found, x, z }) => {
                const option = OPTION_OF.get(type);
                return {
                    type, pureText: option.pureText, icon: STRUCTURE_ICONS[type], found, x, z,
                    distance: found === 1 ? distanceBlocks(point.x, point.z, x, z) : null, order: option.order,
                };
            })
            .sort((a, b) => (b.found - a.found) || (a.found === 1 ? a.distance - b.distance : 0) || a.order - b.order);
        const visible = expanded ? rows : rows.slice(0, FIRST_STRUCTURES);
        const hidden = rows.length - FIRST_STRUCTURES;
        body = (
            <>
                <ul className="result-list" aria-label="Nearest structures around this point">
                    <StructureRows rows={visible} world={world} onShow={onShow} radiusBlocks={STRUCTURE_RADIUS} />
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
    return <Block title="Nearest structures">{body}</Block>;
}
