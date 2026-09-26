import CopyButton from '../../../shared/CopyButton';
import { engineVersion } from '../../../util/seed';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { formatCoords, formatDistance } from '../../../shared/format';
import { STRUCTURES_OPTIONS } from '../../../util/constants';
import { useDashboard } from './DashboardContext';
import ResultRow from './ResultRow';
import { badgesFor, VARIANT_TYPES } from './variants';

const END_GATEWAY = STRUCTURES_OPTIONS.find((s) => s.pureText === 'End Gateway').value;

// What a row without an instance says, for the radius the rows were searched in (4096
// blocks reads "4k"): End Gateways are chunk-scale, and the engine searches them within
// 1024 blocks whatever the radius asked for.
export const noneWithin = (type, radiusBlocks = 4096) => (type === END_GATEWAY
    ? 'None within 1k blocks'
    : `None within ${Math.round(radiusBlocks / 1000)}k blocks`);

/*
 * The variant badges of one found instance. Its own STRUCTURE_VARIANT query (default
 * low priority, ~1 ms each), only for the types that can carry a badge; a small
 * skeleton until it lands. Spans only: the badges sit inside the row's <button>.
 */
function VariantBadges({ world, row, enabled }) {
    const { mcVersion, seed, dimension, largeBiomes } = world;
    const { type, x, z } = row;
    const { data, loading } = useSeedQuery('STRUCTURE_VARIANT', { mcVersion: engineVersion(mcVersion, largeBiomes, dimension), seed, dimension, type, x, z }, { enabled });
    if (!enabled) return null;
    if (loading) return <span className="badge-skeleton" aria-hidden="true" />;
    const badges = badgesFor(type, data?.variant);
    if (badges.length === 0) return null;
    return (
        <span className="badges">
            {badges.map((b) => (
                <span key={b.key} className={b.tone === 'accent' ? 'badge' : `badge badge--${b.tone}`}>{b.label}</span>
            ))}
        </span>
    );
}

function StructureRow({ row, world, onShow, toggleAll, shown, radiusBlocks }) {
    const { type, pureText, icon, found, x, z, distance } = row;
    const summary = (
        <>
            <img className="result-row__icon" src={icon} alt="" width="20" height="20" />
            <span className="result-row__main">
                <span className="result-row__name">{pureText}</span>
                {found === 1 && <VariantBadges world={world} row={row} enabled={VARIANT_TYPES.has(type)} />}
            </span>
            <span className="result-row__meta">{found === 1 ? formatDistance(distance) : noneWithin(type, radiusBlocks)}</span>
        </>
    );
    if (found !== 1) return <ResultRow summary={summary} />;
    return (
        <ResultRow summary={summary}>
            <code>{formatCoords(x, z)}</code>
            <CopyButton text={`${x}, ${z}`} label="Copy" />
            {onShow && <button type="button" className="btn" onClick={() => onShow(row)}>Show on map</button>}
            {toggleAll && (
                <button type="button" className="btn" onClick={() => toggleAll(type)}>{shown ? 'Hide all' : 'Show all'}</button>
            )}
        </ResultRow>
    );
}

/*
 * The rows of a structures list (<li>s), shared by the Structures section, Find near me
 * (nearest structures around a point) and Farms. The caller renders the
 * <ul className="result-list"> around them. A row is
 *   { type, pureText, icon, found: 1 | 0, x, z, distance }
 * and shows icon, name, variant badges and distance on one line ("None within 4k
 * blocks" - 1k for End Gateways - when found is 0); a tap opens the coordinates, Copy
 * and the actions. Props:
 *   rows        the rows, in display order
 *   world       the dashboard's world ({ seed, mcVersion, dimension, … }): the variant
 *               queries are asked about it
 *   onShow      optional (row) => void; "Show on map" is rendered only when given
 *   toggleAll   optional (type) => void; "Show all" / "Hide all" (every instance of the
 *               type on the map), labelled from the context's structuresToShow
 *   radiusBlocks optional, default 4096: the radius the rows were searched in, for the
 *               "None within Nk blocks" copy (Find near me searches 2048)
 */
export default function StructureRows({ rows, world, onShow, toggleAll, radiusBlocks = 4096 }) {
    const { structuresToShow } = useDashboard();
    return rows.map((row) => (
        <StructureRow
            key={`${row.type}:${row.x}:${row.z}`}
            row={row}
            world={world}
            onShow={onShow}
            toggleAll={toggleAll}
            radiusBlocks={radiusBlocks}
            shown={structuresToShow.includes(row.type)}
        />
    ));
}
