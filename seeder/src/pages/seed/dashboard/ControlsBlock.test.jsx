// The controls block on its own; SeedPage.test.jsx covers the selects, zoom, legend and
// share row as the page wires them. This file pins Save world and the chunk grid option.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ControlsBlock from './ControlsBlock';
import { STRUCTURES_OPTIONS } from '../../../util/constants';
import { DashboardProvider } from './DashboardContext';
import { useWorlds, loadWorlds, addWorld, saveWorlds, WORLDS_KEY } from '../../../shared/worlds';

const WORLD = { seed: '8091867987493326313', mcVersion: 35, dimension: 0, yHeight: 256, versionLabel: '26.3' };

function Harness({
    world, showSection, showChunkGrid = false, setShowChunkGrid = vi.fn(),
    structuresToShow = [], setStructuresToShow = vi.fn(), availableStructures = null,
}) {
    const worlds = useWorlds();
    const value = { world, mapApi: { current: null }, sheetApi: { current: null }, structuresToShow: [], setStructuresToShow: () => { }, worlds, showSection };
    return (
        <DashboardProvider value={value}>
            <ControlsBlock
                world={world}
                yHeight={256}
                setYHeight={vi.fn()}
                setMcVersion={vi.fn()}
                setDimension={vi.fn()}
                structuresToShow={structuresToShow}
                setStructuresToShow={setStructuresToShow}
                availableStructures={availableStructures}
                showStructureCoords
                setShowStructureCoords={vi.fn()}
                showChunkGrid={showChunkGrid}
                setShowChunkGrid={setShowChunkGrid}
                showLegend={false}
                setShowLegend={vi.fn()}
                colors={null}
                mapApi={{ current: null }}
                shareUrl="https://mcseeder.com/seed/?seed=8091867987493326313&version=26.3"
                finderUrl="/finder/?version=26.3&dim=0"
            />
        </DashboardProvider>
    );
}
const renderControls = ({ world = WORLD, showSection = vi.fn() } = {}) => ({
    ...render(<Harness world={world} showSection={showSection} />),
    showSection,
});

beforeEach(() => { window.localStorage.clear(); });

describe('ControlsBlock: chunk grid lines', () => {
    it('sits right after "Show structure coords", says it starts at zoom 3, and toggles the page\'s state', () => {
        const setShowChunkGrid = vi.fn();
        render(<Harness world={WORLD} showSection={vi.fn()} showChunkGrid setShowChunkGrid={setShowChunkGrid} />);
        const coords = screen.getByRole('checkbox', { name: 'Show structure coords' }).closest('label');
        const grid = screen.getByRole('checkbox', { name: 'Show chunk grid lines' });
        expect(coords.nextElementSibling).toContainElement(grid);
        expect(grid).toBeChecked();
        expect(grid).toHaveAccessibleDescription('from zoom 3');
        fireEvent.click(grid);
        expect(setShowChunkGrid).toHaveBeenCalledTimes(1);
        const toggle = setShowChunkGrid.mock.calls[0][0];
        expect(toggle(true)).toBe(false);
        expect(toggle(false)).toBe(true);
    });
});

describe('ControlsBlock: Save world', () => {
    it('comes right after the share row', () => {
        renderControls();
        const shareRow = screen.getByLabelText('Share URL').parentElement;
        expect(shareRow.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Save this world' }));
    });

    it('asks for a name, defaulting to "Seed <seed>", and saves the world with its version label', async () => {
        const user = userEvent.setup();
        renderControls();
        await user.click(screen.getByRole('button', { name: 'Save this world' }));
        const name = screen.getByLabelText('World name');
        expect(name).toHaveValue('Seed 8091867987493326313');
        expect(name).toHaveFocus();
        expect(window.localStorage.getItem(WORLDS_KEY)).toBeNull();          // nothing yet

        await user.click(screen.getByRole('button', { name: 'Save' }));
        const [saved] = JSON.parse(window.localStorage.getItem(WORLDS_KEY));
        expect(saved).toMatchObject({ name: 'Seed 8091867987493326313', seed: '8091867987493326313', version: '26.3', dimension: 0 });
        expect(screen.getByText('Saved ✓')).toHaveClass('badge');
        expect(screen.queryByLabelText('World name')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Save this world' })).toBeNull();
    });

    it('saves under the name typed, with Enter', async () => {
        const user = userEvent.setup();
        renderControls({ world: { ...WORLD, seed: '-42', dimension: -1 } });
        await user.click(screen.getByRole('button', { name: 'Save this world' }));
        await user.clear(screen.getByLabelText('World name'));
        await user.type(screen.getByLabelText('World name'), 'Nether base{Enter}');
        expect(loadWorlds()).toMatchObject([{ name: 'Nether base', seed: '-42', version: '26.3', dimension: -1 }]);
    });

    it('Cancel writes nothing and goes back to the button', async () => {
        const user = userEvent.setup();
        renderControls();
        await user.click(screen.getByRole('button', { name: 'Save this world' }));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(window.localStorage.getItem(WORLDS_KEY)).toBeNull();
        expect(screen.getByRole('button', { name: 'Save this world' })).toBeInTheDocument();
    });

    it('shows the badge and a link to My worlds for a world that is already saved', () => {
        saveWorlds(addWorld([], { name: 'Home', seed: WORLD.seed, version: '26.3', dimension: 0 }));
        const { showSection } = renderControls();
        expect(screen.getByText('Saved ✓')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save this world' })).toBeNull();
        const link = screen.getByRole('link', { name: 'My worlds' });
        expect(link).toHaveAttribute('href', '#worlds');
        const click = createEvent.click(link);
        fireEvent(link, click);
        expect(click.defaultPrevented).toBe(true);
        expect(showSection).toHaveBeenCalledWith('worlds');
    });

    it('the same seed on another version or dimension is a different world', () => {
        saveWorlds(addWorld([], { seed: WORLD.seed, version: '1.18', dimension: 0 }));
        renderControls();
        expect(screen.getByRole('button', { name: 'Save this world' })).toBeInTheDocument();
    });
});

describe('ControlsBlock: structures to show', () => {
    const T = Object.fromEntries(STRUCTURES_OPTIONS.map((o) => [o.pureText, o.value]));
    const NETHER = [T['Ruined Portal'], T.Fortress, T.Bastion];
    const openMenu = () => fireEvent.keyDown(screen.getByLabelText('Structures to show'), { key: 'ArrowDown', code: 'ArrowDown' });

    it('offers every type while the version support is unknown', () => {
        render(<Harness world={WORLD} showSection={vi.fn()} />);
        openMenu();
        expect(screen.getAllByRole('option')).toHaveLength(STRUCTURES_OPTIONS.length);
    });

    it('offers only the available types and shows only the picks among them', () => {
        render(<Harness world={{ ...WORLD, dimension: -1 }} showSection={vi.fn()} structuresToShow={[T.Village, T.Fortress]} availableStructures={NETHER} />);
        expect(screen.getByText('Fortress')).toBeInTheDocument();
        expect(screen.queryByText('Village')).toBeNull();
        openMenu();
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ruined Portal', 'Bastion']);
    });

    it('a change keeps the picks hidden here', () => {
        const setStructuresToShow = vi.fn();
        render(<Harness world={{ ...WORLD, dimension: -1 }} showSection={vi.fn()} structuresToShow={[T.Village, T.Fortress]}
            setStructuresToShow={setStructuresToShow} availableStructures={NETHER} />);
        openMenu();
        fireEvent.click(screen.getByText('Bastion'));
        expect(setStructuresToShow).toHaveBeenLastCalledWith([T.Village, T.Fortress, T.Bastion]);
        fireEvent.keyDown(screen.getByLabelText('Structures to show'), { key: 'Backspace', code: 'Backspace' });
        expect(setStructuresToShow).toHaveBeenLastCalledWith([T.Village]);
    });
});
