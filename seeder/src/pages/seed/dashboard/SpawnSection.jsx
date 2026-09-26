import { VERSIONS } from '../../../util/constants';
import CopyButton from '../../../shared/CopyButton';
import HelpTip from '../../../shared/HelpTip';
import { HELP } from '../../../shared/help';
import { useQueueManager } from '../../../shared/hooks/useQueueManager';
import { useSeedQuery } from '../../../shared/hooks/useSeedQuery';
import { buildSeedUrl } from '../../../shared/seedUrl';
import { biomeLabel, formatCoords, shadowSeed } from '../../../shared/format';
import { useDashboard } from './DashboardContext';
import { SectionEmpty, SectionError, SectionLoading } from './Section';

// queue.COLORS is [r, g, b, a] per biome id (a = 255), null until the pool has answered:
// then the swatch is an empty bordered box.
export function BiomeSwatch({ colors, id }) {
    const rgba = colors?.[id];
    const style = rgba ? { backgroundColor: `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})` } : undefined;
    return <span className="swatch" style={style} aria-hidden="true" />;
}

/*
 * The shadow seed shares this seed's Overworld biome layers: cubiomes' getShadow
 * mirrors the layer stack's seed step, s * (s * A + B), which only the layer-based
 * generators (Beta 1.8 - 1.17) use. Measured on the engine (test/engine/dashboard.test.js):
 * identical biomes up to 1.12, identical except the ocean variants on 1.13 - 1.17
 * (ocean temperature is its own noise), unrelated from 1.18, and not the Nether's
 * noise biomes. Hence: Overworld only, Beta 1.8 - 1.17.
 */
function ShadowSeed({ seed, mcVersion, dimension }) {
    if (dimension !== 0 || mcVersion < VERSIONS['Beta 1.8'] || mcVersion >= VERSIONS['1.18']) return null;
    const shadow = shadowSeed(seed);
    const sentence = mcVersion < VERSIONS['1.13']
        ? 'It has the same biome layout as this seed.'
        : 'It has the same biome layout as this seed, except for ocean temperatures.';
    // Plain text + a link named by the digits: no accessible name on this page may
    // contain "Seed" except the seed box (getByLabel('Seed') matches by substring).
    return (
        <p className="section__note">
            Shadow seed: <a href={buildSeedUrl({ seed: shadow, mcVersion, dimension })}>{shadow}</a>. {sentence}
            {' '}<HelpTip {...HELP.shadow} />
        </p>
    );
}

/*
 * Spawn. The Nether and the End have no spawn: the dashboard is centred on the origin
 * there. SEED_SUMMARY's params are exactly the Strongholds section's, so both share one
 * answer.
 */
export default function SpawnSection() {
    const { world, mapApi, sheetApi } = useDashboard();
    const colors = useQueueManager().COLORS;
    const { seed, mcVersion, dimension, yHeight } = world;
    const { data, loading, error } = useSeedQuery('SEED_SUMMARY', { mcVersion, seed, dimension, yHeight });
    if (error) return <SectionError error={error} />;
    if (loading || !data) return <SectionLoading />;

    const { spawnX, spawnZ, spawnBiome, approxHeight } = data;
    const biome = (
        <div className="kv__row">
            <dt>Biome</dt>
            <dd><BiomeSwatch colors={colors} id={spawnBiome} />{biomeLabel(spawnBiome)}</dd>
        </div>
    );
    if (dimension !== 0) {
        return (
            <>
                <SectionEmpty>No spawn in this dimension. The dashboard is centred on (0, 0).</SectionEmpty>
                <dl className="kv">{biome}</dl>
            </>
        );
    }

    const showOnMap = () => {
        mapApi.current?.panTo(spawnX, spawnZ);
        mapApi.current?.setHighlight({ x: spawnX, z: spawnZ, label: 'Spawn' });
        // On a phone the sheet covers the map: get out of the way.
        sheetApi.current?.close();
    };
    return (
        <>
            <dl className="kv">
                <div className="kv__row">
                    <dt>Spawn</dt>
                    <dd>
                        <code>{formatCoords(spawnX, spawnZ)}</code>
                        <CopyButton text={`${spawnX}, ${spawnZ}`} label="Copy" />
                    </dd>
                </div>
                {biome}
                {approxHeight != null && (
                    <div className="kv__row">
                        <dt>Surface</dt>
                        <dd>≈ Y {approxHeight}</dd>
                    </div>
                )}
            </dl>
            <button type="button" className="btn" onClick={showOnMap}>Show on map</button>
            <ShadowSeed seed={seed} mcVersion={mcVersion} dimension={dimension} />
        </>
    );
}
