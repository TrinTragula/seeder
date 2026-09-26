import { useState } from 'react';
import { STRUCTURES_OPTIONS } from '../../../util/constants';
import { STRUCTURE_ICONS } from '../../../library/draw';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { structureTypesIn, useVersionSupport } from '../../../shared/hooks/useVersionSupport';
import { dimensionLabel, distanceBlocks } from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import { SectionEmpty, SectionError, SectionLoading } from './Section';
import StructureRows from './StructureRows';

const RADIUS = 4096;
// Collapsed, the list shows the nearest few.
export const FIRST_STRUCTURES = 5;
const END_GATEWAY = STRUCTURES_OPTIONS.find((s) => s.pureText === 'End Gateway').value;
const OPTION_OF = new Map(STRUCTURES_OPTIONS.map((s, order) => [s.value, { ...s, order }]));

/*
 * Structures: the nearest instance of every type to the spawn (Overworld) or the origin.
 * One NEAREST_STRUCTURES request for all types (~8 ms on 26.3); each badge-carrying row
 * then asks for its own variant.
 */
export default function StructuresSection() {
    const { world } = useDashboard();
    // Another world is another list: nothing may carry over from the previous one.
    return <StructuresList key={`${world.mcVersion}:${world.seed}:${world.dimension}`} />;
}

function StructuresList() {
    const { world, mapApi, sheetApi, structuresToShow, setStructuresToShow } = useDashboard();
    const { seed, mcVersion, dimension, yHeight, versionLabel } = world;
    const overworld = dimension === 0;
    const [expanded, setExpanded] = useState(false);

    const version = useVersionSupport(mcVersion);
    // The same params as Spawn and Strongholds: one cached answer for all three.
    const summary = useSeedQuery('SEED_SUMMARY', { mcVersion, seed, dimension, yHeight }, { enabled: overworld });
    const types = version.support ? structureTypesIn(version.support, dimension) : [];
    const centre = overworld ? (summary.data ? [summary.data.spawnX, summary.data.spawnZ] : null) : [0, 0];
    const nearest = useSeedQuery('NEAREST_STRUCTURES', {
        mcVersion, seed, dimension, x: centre?.[0], z: centre?.[1], types, maxRadiusBlocks: RADIUS,
    }, { enabled: types.length > 0 && centre !== null });

    const error = version.error ?? (overworld ? summary.error : null) ?? nearest.error;
    if (error) return <SectionError error={error} />;
    if (!version.support || !centre) return <SectionLoading />;
    if (types.length === 0) {
        return <SectionEmpty>No structures exist for {versionLabel} in the {dimensionLabel(dimension)}.</SectionEmpty>;
    }
    if (!nearest.data) return <SectionLoading />;

    const [cx, cz] = centre;
    const rows = nearest.data.results
        .filter((r) => r.found === 1 || r.found === 0)             // -1: not in this version / dimension
        .map(({ type, found, x, z }) => {
            const option = OPTION_OF.get(type);
            return {
                type, pureText: option.pureText, icon: STRUCTURE_ICONS[type], found, x, z,
                distance: found === 1 ? distanceBlocks(cx, cz, x, z) : null, order: option.order,
            };
        })
        // Found ones nearest first, then the ones with none in reach, both in option order on ties.
        .sort((a, b) => (b.found - a.found) || (a.found === 1 ? a.distance - b.distance : 0) || a.order - b.order);

    const showOnMap = ({ x, z, pureText }) => {
        mapApi.current?.panTo(x, z);
        mapApi.current?.setHighlight({ x, z, label: pureText });
        // On a phone the sheet covers the map: get out of the way.
        sheetApi.current?.close();
    };
    const toggleAll = (type) => setStructuresToShow(structuresToShow.includes(type)
        ? structuresToShow.filter((t) => t !== type)
        : [...structuresToShow, type]);

    const visible = expanded ? rows : rows.slice(0, FIRST_STRUCTURES);
    const hidden = rows.length - FIRST_STRUCTURES;
    return (
        <>
            <ul className="result-list" aria-label="Nearest structures">
                <StructureRows rows={visible} world={world} onShow={showOnMap} toggleAll={toggleAll} />
            </ul>
            {hidden > 0 && (
                <div className="result-more">
                    <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
                        {expanded ? 'Show fewer' : `Show ${hidden} more`}
                    </button>
                </div>
            )}
            <p className="section__note">
                Nearest instance to {overworld ? 'spawn' : 'the origin'} within 4k blocks
                {types.includes(END_GATEWAY) ? '; End Gateways are searched within 1k.' : '.'}
            </p>
        </>
    );
}
