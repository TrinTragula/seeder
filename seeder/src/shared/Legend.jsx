import { BIOMES } from '../util/constants';

// queue.COLORS is [r, g, b, a] per biome id, straight from the engine (a = 255).
// No colour yet -> no inline style: the swatch is an empty bordered box.
export const swatch = (rgba) => (rgba ? { backgroundColor: `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})` } : undefined);

/*
 * Every biome the map can paint here, with the colour it is painted in. `biomes` is the
 * ids this version has in this dimension (useVersionSupport + biomesIn), or null while
 * that is unknown: then every biome. `colors` is the pool's palette (null until
 * GET_COLORS has answered - the list still renders, with blank swatches, rather than
 * nothing).
 */
export default function Legend({ colors, biomes = null, onClose }) {
    const shown = biomes ? BIOMES.filter((b) => biomes.includes(b.value)) : BIOMES;
    return (
        <div className="legend flex-column">
            <div className="legend__list overflow-auto flex-1">
                {shown.map(({ value, label }) => (
                    <div key={value} className="flex-row flex-align-center margin-3">
                        <div className="legend__swatch" style={swatch(colors?.[value])} />
                        <div>{label}</div>
                    </div>
                ))}
            </div>
            <div className="margin-3">
                <button type="button" className="btn btn--full" onClick={onClose}>Close</button>
            </div>
        </div>
    );
}
