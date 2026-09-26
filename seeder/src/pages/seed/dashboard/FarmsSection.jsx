import { STRUCTURES_OPTIONS } from '../../../util/constants';
import CopyButton from '../../../shared/CopyButton';
import { engineVersion } from '../../../util/seed';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { useVersionSupport } from '../../../shared/hooks/useVersionSupport';
import { distanceBlocks, formatCoords, formatDistance } from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import { SectionEmpty, SectionError, SectionLoading } from './Section';
import ResultRow from './ResultRow';
import { Block } from './Block';
import { HELP } from '../../../shared/help';
import { SLIME_REACH, SlimeChunks } from './SlimeChunks';
import { SWAMP_HUT, kBlocks, quadHutReach } from './farms';

// Fortresses: every region within ±4 of the origin, the 3 nearest listed.
const FORTRESS = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Fortress').value;
const FORTRESS_REGIONS = 4;
const FORTRESS_ROWS = 3;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/*
 * Farms. Every engine question here costs under a millisecond, so each is asked as soon
 * as the section mounts.
 */
export default function FarmsSection() {
    const { world } = useDashboard();
    // Another world starts over: open rows close.
    return <Farms key={`${world.mcVersion}:${world.largeBiomes}:${world.seed}:${world.dimension}`} />;
}

function Farms() {
    const { world, mapApi, sheetApi, slimeOverlay, setSlimeOverlay, setDimension } = useDashboard();
    const { seed, mcVersion, dimension, yHeight, largeBiomes } = world;
    const worldVersion = engineVersion(mcVersion, largeBiomes, dimension);
    const overworld = dimension === 0;

    // Every question is asked here, in the order the blocks need them, so each is asked once.
    const version = useVersionSupport(mcVersion);
    const support = version.support;
    // Spawn's params: one cached answer with Spawn, Strongholds and Structures.
    const summary = useSeedQuery('SEED_SUMMARY', { mcVersion: worldVersion, seed, dimension, yHeight }, { enabled: overworld });
    // Asked at once, with the version probe: on a version without huts it answers -3.
    const quadHuts = useSeedQuery('QUAD_HUTS', { mcVersion: worldVersion, seed }, { enabled: overworld });
    const spawn = summary.data ? { x: summary.data.spawnX, z: summary.data.spawnZ } : null;
    const slime = useSeedQuery('SLIME_CHUNKS', {
        seed, cx0: (spawn?.x >> 4) - SLIME_REACH, cz0: (spawn?.z >> 4) - SLIME_REACH, w: 2 * SLIME_REACH, h: 2 * SLIME_REACH,
    }, { enabled: overworld && spawn !== null });
    const fortressesExist = support != null && support.structures[FORTRESS] !== -100;
    const fortresses = useSeedQuery('GET_STRUCTURES_IN_REGIONS', {
        mcVersion, structType: FORTRESS, seed, regionsRange: FORTRESS_REGIONS, dimension: -1,
    }, { enabled: dimension === -1 && fortressesExist });

    const showOnMap = (x, z, label) => {
        mapApi.current?.panTo(x, z);
        mapApi.current?.setHighlight({ x, z, label });
        // On a phone the sheet covers the map: get out of the way.
        sheetApi.current?.close();
    };

    return (
        <>
            <Block title="Quad witch farm" help={HELP.quadWitchFarm}>
                {overworld ? (
                    <QuadWitchFarm version={version} query={quadHuts} summary={summary} world={world} onShow={showOnMap} />
                ) : <p className="section__note">Witch huts are in the Overworld.</p>}
            </Block>
            <Block title="Blaze spawners">
                {dimension === -1 ? (
                    <Blazes version={version} query={fortresses} world={world} onShow={showOnMap} />
                ) : (
                    <>
                        <p className="section__note">Blaze spawners live in Nether fortresses.</p>
                        <button type="button" className="btn" onClick={() => setDimension?.(-1)}>Switch to the Nether</button>
                    </>
                )}
            </Block>
            {overworld && (
                <SlimeChunks
                    query={summary.error ? { data: null, error: summary.error } : slime}
                    point={spawn}
                    onShow={showOnMap}
                    slimeOverlay={slimeOverlay}
                    setSlimeOverlay={setSlimeOverlay}
                />
            )}
            <p className="section__caveat farms-caveat">
                Dungeon (monster room) and mineshaft spawners depend on terrain carving and cannot be predicted from the seed here.
            </p>
        </>
    );
}

/*
 * Whether the seed has a quad witch farm near the origin: four witch huts that all
 * generate, close enough for one AFK spot. Yes or no; a yes names the one nearest to
 * spawn and can show it on the map.
 */
function QuadWitchFarm({ version, query, summary, world, onShow }) {
    const { support, error } = version;
    if (error) return <SectionError error={error} />;
    if (!support) return <SectionLoading />;
    if (support.structures[SWAMP_HUT] !== 0) {
        return <SectionEmpty>Witch huts don't generate on {world.versionLabel}.</SectionEmpty>;
    }
    if (query.error) return <SectionError error={query.error} />;
    // Measured from spawn: wait for it (one cached ~5 ms answer); the origin if it fails.
    if (!query.data || summary.loading) return <SectionLoading />;
    const reach = kBlocks(quadHutReach(support.regionBlocks[SWAMP_HUT]));
    const { farms } = query.data;
    if (farms.length === 0) {
        return (
            <>
                <SectionEmpty>No quad witch farm within {reach} blocks of the origin.</SectionEmpty>
                <p className="section__note">Quad witch huts are extremely rare: about one region in 100 million.</p>
            </>
        );
    }
    const spawn = summary.data ? { x: summary.data.spawnX, z: summary.data.spawnZ, name: 'spawn' } : { x: 0, z: 0, name: 'the origin' };
    // By the exact distance, ties by position: the same farm every time.
    const [nearest] = [...farms].sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z)
        || a.z - b.z || a.x - b.x);
    const more = farms.length - 1;
    return (
        <>
            <div className="quad-farm">
                <span>
                    <strong>Yes</strong>: a quad witch farm at <code>{formatCoords(nearest.x, nearest.z)}</code>,
                    {' '}{formatDistance(distanceBlocks(spawn.x, spawn.z, nearest.x, nearest.z))} from {spawn.name}.
                </span>
                <button type="button" className="btn" onClick={() => onShow(nearest.x, nearest.z, 'Quad witch farm')}>Show on map</button>
            </div>
            {more > 0 && <p className="section__note">{more} more within {reach} blocks of the origin.</p>}
        </>
    );
}

// In the Nether: the fortresses nearest to the origin, each with its blaze spawners.
function Blazes({ version, query, world, onShow }) {
    const { support, error } = version;
    if (error) return <SectionError error={error} />;
    if (!support) return <SectionLoading />;
    if (support.structures[FORTRESS] === -100) return <SectionEmpty>No fortresses on this version.</SectionEmpty>;
    if (query.error) return <SectionError error={query.error} />;
    if (!query.data) return <SectionLoading />;
    // Int32Array pairs off the heap: plain numbers before anything else touches them.
    const rows = query.data.coords
        .map((pair) => Array.from(pair))
        .map(([x, z]) => ({ x, z, distance: distanceBlocks(0, 0, x, z), exact: Math.hypot(x, z) }))
        // By the exact distance: two rows that both read "250 blocks" still come in true order.
        .sort((a, b) => a.exact - b.exact || a.z - b.z || a.x - b.x)
        .slice(0, FORTRESS_ROWS);
    if (rows.length === 0) {
        const reach = FORTRESS_REGIONS * support.regionBlocks[FORTRESS];
        return <SectionEmpty>No fortress within {reach} blocks of the origin.</SectionEmpty>;
    }
    return (
        <ul className="result-list" aria-label="Nearest fortresses">
            {rows.map((row) => <FortressSpawners key={`${row.x}:${row.z}`} row={row} world={world} onShow={onShow} />)}
        </ul>
    );
}

/*
 * One fortress: its spawners are asked for at once (0.3 ms), not on opening the row,
 * so the summary can say how many there are.
 */
function FortressSpawners({ row, world, onShow }) {
    const { x, z, distance } = row;
    const { mcVersion, seed } = world;
    const { data, error } = useSeedQuery('FORTRESS_SPAWNERS', { mcVersion, seed, chunkX: x >> 4, chunkZ: z >> 4 });
    let details;
    if (error?.code === -3) details = <SectionEmpty>No fortresses on this version.</SectionEmpty>;
    else if (error) details = <SectionError error={error} />;
    else if (!data) details = <SectionLoading />;
    else {
        details = (
            <>
                <ul className="fortress-spawners" aria-label="Blaze spawners">
                    {data.spawners.map((s) => (
                        <li key={`${s.x}:${s.y}:${s.z}`}>
                            <code>({s.x}, {s.y}, {s.z})</code>
                            <CopyButton text={`${s.x}, ${s.y}, ${s.z}`} label="Copy" />
                            <button type="button" className="btn" onClick={() => onShow(s.x, s.z, 'Blaze spawner')}>Show on map</button>
                        </li>
                    ))}
                </ul>
                <span className="fortress-warts">{plural(data.wartRooms, 'nether wart room', 'nether wart rooms')}</span>
                <p className="section__caveat fortress-note">
                    Blaze spawners sit on fortress bridge pieces; coordinates are the piece centre, Y is the bridge level.
                </p>
            </>
        );
    }
    return (
        <ResultRow
            summary={(
                <>
                    <span className="result-row__main">
                        <span className="result-row__name">Fortress</span>
                        <code>{formatCoords(x, z)}</code>
                        {data && <span className="fortress-count">{plural(data.spawners.length, 'blaze spawner', 'blaze spawners')}</span>}
                    </span>
                    <span className="result-row__meta">{formatDistance(distance)}</span>
                </>
            )}
        >
            {details}
        </ResultRow>
    );
}
