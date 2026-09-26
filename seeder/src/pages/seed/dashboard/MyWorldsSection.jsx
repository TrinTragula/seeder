import { useState } from 'react';
import { VERSIONS } from '../../../util/constants';
import { DEFAULT_VERSION } from '../../../util/seed';
import { MAX_NAME } from '../../../shared/worlds';
import { buildSeedUrl } from '../../../shared/seedUrl';
import { useDashboard } from './DashboardContext';
import { SaveWorld } from './ControlsBlock';
import { SectionEmpty } from './Section';
import { DIMENSION_LABELS, relativeTime } from './format';

const isShown = (saved, world) => saved.seed === world.seed
    && saved.version === world.versionLabel
    && saved.dimension === world.dimension;

// The name cell: the name, or an inline form while it is being renamed.
function NameCell({ saved, renaming, onRename, onDone }) {
    return (
        <td data-label="Name">
            {renaming ? <RenameForm saved={saved} onRename={onRename} onDone={onDone} /> : saved.name}
        </td>
    );
}

// Mounted per rename, so it always starts from the stored name.
function RenameForm({ saved, onRename, onDone }) {
    const [name, setName] = useState(saved.name);
    return (
        <form
            className="save-world save-world--naming"
            onSubmit={(event) => {
                event.preventDefault();
                onRename(name);
                onDone();
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
            <button type="button" className="btn" onClick={onDone}>Cancel</button>
        </form>
    );
}

function WorldRow({ saved, current, store }) {
    // null | 'rename' | 'delete': one inline step at a time.
    const [mode, setMode] = useState(null);
    const open = () => {
        store.touch(saved.id);
        window.location.assign(buildSeedUrl({
            seed: saved.seed,
            mcVersion: VERSIONS[saved.version] ?? VERSIONS[DEFAULT_VERSION],
            dimension: saved.dimension,
        }));
    };
    return (
        <tr>
            <NameCell
                saved={saved}
                renaming={mode === 'rename'}
                onRename={(name) => store.rename(saved.id, name)}
                onDone={() => setMode(null)}
            />
            <td data-label="Seed"><code>{saved.seed}</code></td>
            <td data-label="Version">{saved.version}</td>
            <td data-label="Dimension">{DIMENSION_LABELS[saved.dimension]}</td>
            <td data-label="Last opened">{relativeTime(saved.lastOpenedAt)}</td>
            <td data-label="Actions">
                <div className="world-actions">
                    {mode === 'delete' ? (
                        <>
                            <button type="button" className="btn btn--danger" onClick={() => store.remove(saved.id)}>Delete for good</button>
                            <button type="button" className="btn" onClick={() => setMode(null)}>Cancel</button>
                        </>
                    ) : (
                        <>
                            {current
                                ? <span className="badge">Current</span>
                                : <button type="button" className="btn btn--primary" onClick={open}>Open</button>}
                            <button type="button" className="btn" onClick={() => setMode('rename')} disabled={mode === 'rename'}>Rename</button>
                            <button type="button" className="btn" onClick={() => setMode('delete')}>Delete</button>
                        </>
                    )}
                </div>
            </td>
        </tr>
    );
}

/*
 * My worlds, most recently opened first. Opening one is a full page load of its
 * canonical URL. Deleting takes a second, inline click - never window.confirm, which
 * looks wrong inside the bottom sheet.
 */
export default function MyWorldsSection() {
    const { world, worlds: store } = useDashboard();
    if (store.worlds.length === 0) {
        return (
            <>
                <SectionEmpty>No saved worlds yet. Save the seed you are playing to find it here.</SectionEmpty>
                <SaveWorld world={world} />
            </>
        );
    }
    return (
        <table className="table worlds-table">
            <thead>
                <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Seed</th>
                    <th scope="col">Version</th>
                    <th scope="col">Dimension</th>
                    <th scope="col">Last opened</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
            </thead>
            <tbody>
                {store.worlds.map((saved) => (
                    <WorldRow key={saved.id} saved={saved} current={isShown(saved, world)} store={store} />
                ))}
            </tbody>
        </table>
    );
}
