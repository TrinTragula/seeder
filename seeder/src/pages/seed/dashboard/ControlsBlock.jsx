import { useMemo, useState } from 'react';
import Select, { createFilter } from 'react-select';
import { VERSIONS, VERSIONS_OPTIONS, STRUCTURES_OPTIONS, DIMENSIONS_OPTIONS, HEIGHT_OPTIONS } from '../../../util/constants';
import { MAX_NAME } from '../../../shared/worlds';
import { WORLD_TYPE_OPTIONS, worldTypeHint } from '../../../util/seed';
import { DEFAULT_VIEW } from '../../../shared/seedUrl';
import Legend from '../../../shared/Legend';
import CopyButton from '../../../shared/CopyButton';
import HelpTip from '../../../shared/HelpTip';
import { HELP } from '../../../shared/help';
import { useDashboard } from './DashboardContext';

// Biomes are 3D from 1.18 on; before that a height would be a lie.
const HEIGHT_FROM = VERSIONS['1.18'];
// One source with the Share link's y param, which is only written when it differs.
export const DEFAULT_HEIGHT = DEFAULT_VIEW.yHeight;

// Structure options are markup (icon + name); search them by their plain text.
const filterConfig = {
    ignoreCase: true,
    ignoreAccents: true,
    trim: true,
    matchFrom: 'any',
    stringify: (option) => option.data.pureText,
};

// The panel scrolls (overflow: auto) and would clip an open menu: render menus on
// the body instead, above everything else on the page.
const menuProps = {
    menuPortalTarget: document.body,
    menuPosition: 'fixed',
    styles: { menuPortal: (base) => ({ ...base, zIndex: 'var(--z-overlay)' }) },
};

/*
 * "Save this world", used by the controls and by the empty My worlds section. The store
 * is the dashboard's single useWorlds() (see DashboardContext), so both places agree.
 */
export function SaveWorld({ world }) {
    const { worlds: store, showSection } = useDashboard();
    const [name, setName] = useState(null);             // null = not naming
    const { seed, versionLabel, dimension, largeBiomes = false } = world;

    if (store.isSaved(seed, versionLabel, dimension, largeBiomes)) {
        return (
            <div className="save-world margin-3">
                <span className="badge">Saved ✓</span>
                <a
                    href="#worlds"
                    onClick={(event) => {
                        event.preventDefault();
                        showSection('worlds');
                    }}
                >
                    My worlds
                </a>
            </div>
        );
    }
    if (name === null) {
        return (
            <div className="margin-3">
                <button type="button" className="btn btn--full" onClick={() => setName(`Seed ${seed}`)}>
                    Save this world
                </button>
            </div>
        );
    }
    return (
        <form
            className="save-world save-world--naming margin-3"
            onSubmit={(event) => {
                event.preventDefault();
                store.add({ name, seed, version: versionLabel, dimension, largeBiomes });
                setName(null);
            }}
        >
            <input
                className="input"
                aria-label="World name"
                value={name}
                maxLength={MAX_NAME}
                onChange={(event) => setName(event.target.value)}
                autoFocus
            />
            <button type="submit" className="btn btn--primary">Save</button>
            <button type="button" className="btn" onClick={() => setName(null)}>Cancel</button>
        </form>
    );
}

// The seed page's controls. All state lives in SeedPage; this block only renders it and reports changes.
export default function ControlsBlock({
    world, yHeight, setYHeight, setMcVersion, setDimension, setLargeBiomes,
    structuresToShow, setStructuresToShow, availableStructures = null, legendBiomes = null,
    showStructureCoords, setShowStructureCoords, showChunkGrid = false, setShowChunkGrid,
    showLegend, setShowLegend, colors, mapApi, shareUrl, finderUrl,
}) {
    const { mcVersion, dimension, largeBiomes = false } = world;
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    const selectedDimension = useMemo(() => DIMENSIONS_OPTIONS.find((o) => o.value === dimension), [dimension]);
    const selectedVersion = useMemo(() => VERSIONS_OPTIONS.find((o) => o.value === mcVersion), [mcVersion]);
    const selectedHeight = useMemo(() => HEIGHT_OPTIONS.find((o) => o.value === yHeight), [yHeight]);
    const selectedWorldType = WORLD_TYPE_OPTIONS.find((o) => o.value === largeBiomes);
    const worldTypeNote = worldTypeHint(mcVersion, dimension);
    // Only the types this version has in this dimension (every type while that is
    // unknown). A pick that does not apply here stays in structuresToShow, hidden, and is
    // back when the world changes to one where it does.
    const structureOptions = useMemo(
        () => (availableStructures ? STRUCTURES_OPTIONS.filter((o) => availableStructures.includes(o.value)) : STRUCTURES_OPTIONS),
        [availableStructures],
    );
    const selectedStructures = useMemo(
        () => structureOptions.filter((o) => structuresToShow.includes(o.value)),
        [structureOptions, structuresToShow],
    );
    const changeStructures = (options) => {
        const hidden = availableStructures ? structuresToShow.filter((type) => !availableStructures.includes(type)) : [];
        setStructuresToShow([...hidden, ...(options?.map((o) => o.value) ?? [])]);
    };

    return (
        <>
            <div className="margin-3">
                <div className="margin-3">Dimension</div>
                <Select
                    aria-label="Dimension"
                    options={DIMENSIONS_OPTIONS}
                    value={selectedDimension}
                    onChange={(option) => setDimension(option?.value)}
                    {...menuProps}
                />
            </div>
            <div className="margin-3">
                <div className="margin-3">Minecraft version</div>
                <Select
                    aria-label="Minecraft version"
                    options={VERSIONS_OPTIONS}
                    value={selectedVersion}
                    onChange={(option) => setMcVersion(option?.value)}
                    {...menuProps}
                />
            </div>
            <div className="margin-3">
                <div className="margin-3">World type</div>
                <Select
                    aria-label="World type"
                    options={WORLD_TYPE_OPTIONS}
                    value={selectedWorldType}
                    isDisabled={worldTypeNote !== null}
                    isSearchable={false}
                    onChange={(option) => setLargeBiomes?.(option?.value ?? false)}
                    {...menuProps}
                />
                {worldTypeNote && <p className="structure-coords__hint margin-3">{worldTypeNote}</p>}
            </div>
            {mcVersion >= HEIGHT_FROM && (
                <div className="margin-3">
                    <div className="margin-3 control-label">Biome height<HelpTip {...HELP.biomeHeight} /></div>
                    <Select
                        aria-label="Biome height"
                        options={HEIGHT_OPTIONS}
                        value={selectedHeight}
                        onChange={(option) => setYHeight(option?.value ?? DEFAULT_HEIGHT)}
                        {...menuProps}
                    />
                </div>
            )}

            <div className="margin-3 flex-row">
                <button type="button" className="btn btn--half" onClick={() => mapApi.current?.zoom()}>Zoom +</button>
                <button type="button" className="btn btn--half" onClick={() => mapApi.current?.dezoom()}>Zoom -</button>
            </div>
            <div className="margin-3">
                <button type="button" className="btn btn--full" onClick={() => setShowLegend((shown) => !shown)}>
                    {showLegend ? 'Close legend' : 'Show legend'}
                </button>
            </div>
            {showLegend && <Legend colors={colors} biomes={legendBiomes} onClose={() => setShowLegend(false)} />}

            <div className="margin-3">
                <div className="margin-3">Structures to show</div>
                <Select
                    aria-label="Structures to show"
                    options={structureOptions}
                    isMulti
                    isClearable
                    value={selectedStructures}
                    onChange={changeStructures}
                    filterOption={createFilter(filterConfig)}
                    {...menuProps}
                />
            </div>
            <label className="structure-coords">
                <input
                    type="checkbox"
                    checked={showStructureCoords}
                    onChange={() => setShowStructureCoords((shown) => !shown)}
                />
                Show structure coords
            </label>
            <div className="structure-coords">
                <label className="structure-coords__label">
                    <input
                        type="checkbox"
                        checked={showChunkGrid}
                        aria-describedby="chunk-grid-hint"
                        onChange={() => setShowChunkGrid?.((shown) => !shown)}
                    />
                    Show chunk grid lines
                </label>
                {/* At zoom 1-2 a chunk is 4-8 px: the lines would hide the map, so they start at 3. */}
                <span id="chunk-grid-hint" className="structure-coords__hint">from zoom 3</span>
                <HelpTip {...HELP.chunkGrid} />
            </div>

            <hr />

            <div className="card margin-3 seed-cta">
                <h3 className="no-margin">Looking for a seed with specific biomes or structures?</h3>
                <p>Use the advanced finder and find your perfect seed in seconds</p>
                <a className="btn btn--primary" href={finderUrl}>Open the advanced finder</a>
            </div>

            <hr />

            <h3 className="margin-3">Share your seed</h3>
            <div className="margin-3 flex-row share-row">
                <input aria-label="Share URL" className="input flex-3" value={shareUrl} readOnly />
                <CopyButton text={shareUrl} className="btn flex-1" />
                {canShare && (
                    <button
                        type="button"
                        className="btn"
                        onClick={() => navigator.share({ title: document.title, url: shareUrl }).catch(() => { })}
                    >
                        Share
                    </button>
                )}
            </div>
            <SaveWorld world={world} />
        </>
    );
}
