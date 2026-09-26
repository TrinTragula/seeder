import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyWorldsSection from './MyWorldsSection';
import { DashboardProvider } from './DashboardContext';
import { useWorlds, loadWorlds, saveWorlds } from '../../../shared/worlds';

// The world on screen: 26.3 Overworld.
const WORLD = { seed: '8091867987493326313', mcVersion: 35, dimension: 0, yHeight: 256, versionLabel: '26.3' };
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const stored = (over) => ({ id: over.name, createdAt: iso(0), lastOpenedAt: iso(0), dimension: 0, version: '26.3', ...over });
// MRU first, as the store keeps them.
const SAVED = [
    stored({ name: 'Home', seed: WORLD.seed, lastOpenedAt: iso(30_000) }),
    stored({ name: 'Fortress', seed: '-77', version: '1.16.5', dimension: -1, lastOpenedAt: iso(5 * 60_000) }),
    stored({ name: 'Outer islands', seed: '12', version: '1.12', dimension: 1, lastOpenedAt: iso(2 * 86_400_000) }),
];

function Harness() {
    const worlds = useWorlds();
    const value = { world: WORLD, mapApi: { current: null }, sheetApi: { current: null }, structuresToShow: [], setStructuresToShow: () => { }, worlds, showSection: vi.fn() };
    return <DashboardProvider value={value}><MyWorldsSection /></DashboardProvider>;
}
const rows = () => screen.getAllByRole('row').slice(1);            // minus the header row
const rowOf = (name) => rows().find((row) => within(row).queryByText(name));

const realLocation = window.location;
let assign;
beforeEach(() => {
    window.localStorage.clear();
    assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('MyWorldsSection', () => {
    it('has an empty state that offers to save the world on screen', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        expect(screen.getByText('No saved worlds yet. Save the seed you are playing to find it here.')).toBeInTheDocument();
        expect(screen.queryByRole('table')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Save this world' }));
        expect(screen.getByLabelText('World name')).toHaveValue(`Seed ${WORLD.seed}`);
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(rows()).toHaveLength(1);
        expect(loadWorlds()).toMatchObject([{ seed: WORLD.seed, version: '26.3', dimension: 0 }]);
    });

    it('lists the worlds most recently opened first, with seed, version, dimension and when', () => {
        saveWorlds(SAVED);
        render(<Harness />);
        expect(rows().map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Home', 'Fortress', 'Outer islands']);
        const fortress = within(rowOf('Fortress'));
        expect(fortress.getByText('-77').tagName).toBe('CODE');
        expect(fortress.getByText('1.16.5')).toBeInTheDocument();
        expect(fortress.getByText('Nether')).toBeInTheDocument();
        expect(fortress.getByText('5 min ago')).toBeInTheDocument();
        expect(within(rowOf('Outer islands')).getByText('End')).toBeInTheDocument();
        expect(within(rowOf('Outer islands')).getByText('2 days ago')).toBeInTheDocument();
        expect(within(rowOf('Home')).getByText('Overworld')).toBeInTheDocument();
        expect(within(rowOf('Home')).getByText('just now')).toBeInTheDocument();
        // Cells reprint their column on phones.
        expect(within(rowOf('Home')).getAllByRole('cell').map((c) => c.dataset.label))
            .toEqual(['Name', 'Seed', 'Version', 'Dimension', 'Last opened', 'Actions']);
    });

    it('marks the world on screen "Current", without an Open button', () => {
        saveWorlds(SAVED);
        render(<Harness />);
        const home = within(rowOf('Home'));
        expect(home.getByText('Current')).toBeInTheDocument();
        expect(home.queryByRole('button', { name: 'Open' })).toBeNull();
        expect(within(rowOf('Fortress')).queryByText('Current')).toBeNull();
        expect(screen.getAllByText('Current')).toHaveLength(1);
    });

    it('Open moves the world to the front and loads its canonical URL', async () => {
        const user = userEvent.setup();
        saveWorlds(SAVED);
        render(<Harness />);
        await user.click(within(rowOf('Fortress')).getByRole('button', { name: 'Open' }));
        expect(loadWorlds()[0].name).toBe('Fortress');                     // touch(): MRU first
        expect(Date.parse(loadWorlds()[0].lastOpenedAt)).toBeGreaterThanOrEqual(NOW);
        expect(assign).toHaveBeenCalledWith('/seed/?seed=-77&version=1.16.5&dim=-1');
    });

    it('Open falls back to the default version for a label this build does not know', async () => {
        const user = userEvent.setup();
        saveWorlds([stored({ name: 'Future', seed: '5', version: '99.1' })]);
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Open' }));
        expect(assign).toHaveBeenCalledWith('/seed/?seed=5&version=26.3');
    });

    it('renames inline, and the new name is stored', async () => {
        const user = userEvent.setup();
        saveWorlds(SAVED);
        render(<Harness />);
        await user.click(within(rowOf('Fortress')).getByRole('button', { name: 'Rename' }));
        const input = screen.getByLabelText('World name');
        expect(input).toHaveValue('Fortress');
        await user.clear(input);
        await user.type(input, 'Blaze farm');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(rowOf('Blaze farm')).toBeDefined();
        expect(screen.queryByLabelText('World name')).toBeNull();
        expect(loadWorlds().find((w) => w.id === 'Fortress').name).toBe('Blaze farm');
    });

    it('Cancel leaves the name as it was', async () => {
        const user = userEvent.setup();
        saveWorlds(SAVED);
        render(<Harness />);
        await user.click(within(rowOf('Home')).getByRole('button', { name: 'Rename' }));
        await user.type(screen.getByLabelText('World name'), ' extra');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(rowOf('Home')).toBeDefined();
        expect(loadWorlds()[0].name).toBe('Home');
    });

    it('Delete asks for a second click, and Cancel keeps the world', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm');
        saveWorlds(SAVED);
        render(<Harness />);
        await user.click(within(rowOf('Fortress')).getByRole('button', { name: 'Delete' }));
        expect(loadWorlds()).toHaveLength(3);
        await user.click(within(rowOf('Fortress')).getByRole('button', { name: 'Cancel' }));
        expect(rows()).toHaveLength(3);
        expect(within(rowOf('Fortress')).getByRole('button', { name: 'Delete' })).toBeInTheDocument();

        await user.click(within(rowOf('Fortress')).getByRole('button', { name: 'Delete' }));
        await user.click(within(rowOf('Fortress')).getByRole('button', { name: 'Delete for good' }));
        expect(rows()).toHaveLength(2);
        expect(rowOf('Fortress')).toBeUndefined();
        expect(loadWorlds().map((w) => w.name)).toEqual(['Home', 'Outer islands']);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('deleting the last world brings the empty state back', async () => {
        const user = userEvent.setup();
        saveWorlds([SAVED[1]]);
        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        await user.click(screen.getByRole('button', { name: 'Delete for good' }));
        expect(screen.getByText(/No saved worlds yet/)).toBeInTheDocument();
    });
});
