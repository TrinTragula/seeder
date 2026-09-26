import CopyButton from '../../../shared/CopyButton';
import { distanceBlocks, formatCoords, formatDistance } from '../../../shared/format';
import { SectionEmpty, SectionError, SectionLoading } from './Section';
import ResultRow from './ResultRow';
import { Block } from './Block';
import { HELP } from '../../../shared/help';

// Slime chunks: a 32x32-chunk window (±256 blocks) around the point's chunk.
export const SLIME_REACH = 16;
export const SLIME_ROWS = 10;

// The slime chunks of the window around the point, nearest (by chunk centre) first.
export function slimeRows(data, point) {
    const { cx0, cz0, w, h, cells } = data;
    const rows = [];
    for (let dz = 0; dz < h; dz++) {
        for (let dx = 0; dx < w; dx++) {
            if (cells[dz * w + dx] !== 1) continue;
            const cx = cx0 + dx;
            const cz = cz0 + dz;
            const distance = distanceBlocks(point.x, point.z, cx * 16 + 8, cz * 16 + 8);
            rows.push({ cx, cz, distance });
        }
    }
    return rows.sort((a, b) => a.distance - b.distance || a.cz - b.cz || a.cx - b.cx).slice(0, SLIME_ROWS);
}

/*
 * The nearest slime chunks to a point (Find near me: the located point; Farms: the
 * spawn), with the map's slime-overlay checkbox and the slime caveat. `query` is the
 * caller's SLIME_CHUNKS answer for the window around the point's chunk; the checkbox is
 * bound to the context's slimeOverlay / setSlimeOverlay, passed in by the caller.
 */
export function SlimeChunks({ query, point, onShow, slimeOverlay, setSlimeOverlay }) {
    let body;
    if (query.error) body = <SectionError error={query.error} />;
    else if (!query.data) body = <SectionLoading />;
    else {
        const rows = slimeRows(query.data, point);
        body = rows.length === 0 ? <SectionEmpty>No slime chunks within 256 blocks.</SectionEmpty> : (
            <ul className="result-list" aria-label="Nearest slime chunks">
                {rows.map(({ cx, cz, distance }) => {
                    const x0 = cx * 16;
                    const z0 = cz * 16;
                    return (
                        <ResultRow
                            key={`${cx}:${cz}`}
                            summary={(
                                <>
                                    <span className="result-row__main">Chunk <code>{formatCoords(cx, cz)}</code></span>
                                    <span className="result-row__meta">{formatDistance(distance)}</span>
                                </>
                            )}
                        >
                            <span>Blocks {x0} to {x0 + 15}, {z0} to {z0 + 15}</span>
                            <CopyButton text={`${x0}, ${z0}`} label="Copy" />
                            <button type="button" className="btn" onClick={() => onShow(x0 + 8, z0 + 8, 'Slime chunk')}>Show on map</button>
                        </ResultRow>
                    );
                })}
            </ul>
        );
    }
    return (
        <Block title="Nearest slime chunks" help={HELP.slimeChunks}>
            {body}
            <label className="where-toggle">
                <input type="checkbox" checked={!!slimeOverlay} onChange={(event) => setSlimeOverlay?.(event.target.checked)} />
                Show slime chunks on the map
            </label>
            <p className="section__caveat">
                Slime chunks are fixed per seed (Overworld, below Y 40). Swamps also spawn slimes at night (not shown here).
            </p>
        </Block>
    );
}

export default SlimeChunks;
