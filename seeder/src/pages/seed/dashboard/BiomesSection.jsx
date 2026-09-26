import { useState } from 'react';
import { VERSIONS } from '../../../util/constants';
import { useDebounce } from '../../../util/functions';
import { useQueueManager } from '../../../shared/hooks/useQueueManager';
import { engineVersion } from '../../../util/seed';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { biomeLabel } from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import { SectionError, SectionLoading } from './Section';
import { BiomeSwatch } from './SpawnSection';
import { useAreaTally } from './biomeStats';

// 500×500 cells at 1:4 = 1000 blocks on each side of the centre (~0.7 s on 26.3).
const HALF_CELLS = 250;
export const AREA_CELLS = 2 * HALF_CELLS;
export const FIRST_BIOMES = 10;
// Every height change would cost a whole area: wait until the select has settled.
export const HEIGHT_DEBOUNCE_MS = 500;
const HEIGHT_FROM = VERSIONS['1.18'];

const pctText = (pct) => `${pct.toFixed(1)}%`;

/*
 * Biomes: the share of each biome in the 500×500-cell area around the spawn (Overworld)
 * or the origin, at the map's height. The area goes through queue.requestArea and only
 * its tally is kept (biomeStats.js).
 */
export default function BiomesSection() {
    const { world } = useDashboard();
    // Another world is another breakdown: the unfolded list must not carry over.
    return <BiomeBreakdown key={`${world.mcVersion}:${world.largeBiomes}:${world.seed}:${world.dimension}`} />;
}

function BiomeBreakdown() {
    const { world } = useDashboard();
    const colors = useQueueManager().COLORS;
    const { seed, mcVersion, dimension, yHeight, largeBiomes } = world;
    const worldVersion = engineVersion(mcVersion, largeBiomes, dimension);
    const overworld = dimension === 0;
    const [expanded, setExpanded] = useState(false);

    const y = useDebounce(yHeight, HEIGHT_DEBOUNCE_MS);
    // Spawn's params once the height has settled, so one cached answer serves both; asked
    // at the debounced height, the breakdown on screen stays put while the select moves.
    const summary = useSeedQuery('SEED_SUMMARY', { mcVersion: worldVersion, seed, dimension, yHeight: y }, { enabled: overworld });
    const centre = overworld ? (summary.data ? [summary.data.spawnX, summary.data.spawnZ] : null) : [0, 0];
    const area = useAreaTally({
        mcVersion: worldVersion, seed,
        startX: centre ? (centre[0] >> 2) - HALF_CELLS : null,
        startY: centre ? (centre[1] >> 2) - HALF_CELLS : null,
        widthX: AREA_CELLS, widthY: AREA_CELLS, dimension, yHeight: y,
    }, { enabled: centre !== null });

    const error = (overworld ? summary.error : null) ?? area.error;
    if (error) return <SectionError error={error} />;
    if (!area.tally) {
        return (
            <>
                <SectionLoading />
                <p className="section__note">Computing a 2,000 × 2,000-block area…</p>
            </>
        );
    }

    const rows = expanded ? area.tally : area.tally.slice(0, FIRST_BIOMES);
    const hidden = area.tally.length - FIRST_BIOMES;
    const barLabel = `Top biomes: ${rows.map(({ id, pct }) => `${biomeLabel(id)} ${Math.round(pct)}%`).join(', ')}`;
    const rgb = (id) => (colors?.[id] ? `rgb(${colors[id][0]}, ${colors[id][1]}, ${colors[id][2]})` : undefined);
    return (
        <>
            <div className="biome-bar" role="img" aria-label={barLabel}>
                {rows.map(({ id, pct }) => (
                    <span key={id} style={{ width: `${pct}%`, backgroundColor: rgb(id) }} />
                ))}
            </div>
            <ul className="result-list" aria-label="Biome breakdown">
                {rows.map(({ id, pct }) => (
                    <li key={id} className="result-row biome-row">
                        <div className="result-row__summary">
                            <BiomeSwatch colors={colors} id={id} />
                            <span className="result-row__main">{biomeLabel(id)}</span>
                            <span className="result-row__meta">{pctText(pct)}</span>
                        </div>
                    </li>
                ))}
            </ul>
            {hidden > 0 && (
                <div className="result-more">
                    <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
                        {expanded ? 'Show fewer' : `Show ${hidden} more biomes`}
                    </button>
                </div>
            )}
            <p className="section__note">
                Within 1000 blocks of {overworld ? 'spawn' : 'the origin'}
                {mcVersion >= HEIGHT_FROM ? ` at Y ${y}` : ''}.
            </p>
        </>
    );
}
