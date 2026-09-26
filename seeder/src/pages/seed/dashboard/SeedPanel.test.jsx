import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import SeedPanel from './SeedPanel';
import { SECTIONS } from './sections';
import { useDashboard } from './DashboardContext';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';
import { clearSeedQueryCache } from '../../../shared/hooks/useSeedQuery';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const WORLD = { seed: '8091867987493326313', mcVersion: 35, dimension: -1, yHeight: 62, versionLabel: '26.3', largeBiomes: false };

// Stands in for ControlsBlock, and proves the context reaches what the panel renders.
let seen = null;
function Probe() {
    seen = useDashboard();
    return <div data-testid="controls">controls</div>;
}
function renderPanel(props = {}) {
    const mapApi = { current: null };
    const sheetApi = { current: null };
    const setStructuresToShow = vi.fn();
    const setSlimeOverlay = vi.fn();
    const setDimension = vi.fn();
    const utils = render(
        <SeedPanel
            world={WORLD}
            mapApi={mapApi}
            sheetApi={sheetApi}
            structuresToShow={[5, 9]}
            setStructuresToShow={setStructuresToShow}
            slimeOverlay={false}
            setSlimeOverlay={setSlimeOverlay}
            setDimension={setDimension}
            controls={<Probe />}
            {...props}
        />,
    );
    return { ...utils, mapApi, sheetApi, setStructuresToShow, setSlimeOverlay, setDimension };
}
// The panel's top-level blocks, in order, as short tokens.
const blocks = (container) => [...container.children].map((el) => {
    if (el.classList.contains('dashboard-tabs__anchor')) return 'anchor';
    if (el.getAttribute('role') === 'tablist') return 'tabs';
    if (el.getAttribute('role') === 'tabpanel') return `panel:${el.id.replace('dashboard-panel-', '')}`;
    if (el.tagName === 'FOOTER') return 'footer';
    return el.tagName;
});
// What one tab panel holds, as short tokens.
const contents = (panel) => [...panel.children].map((el) => {
    if (el.dataset.testid === 'controls') return 'controls';
    if (el.classList.contains('ad')) return 'ad';
    if (el.tagName === 'SECTION') return `#${el.id}`;
    return el.tagName;
});
const tab = (name) => screen.getByRole('tab', { name });
const panelOf = (name) => document.getElementById(tab(name).getAttribute('aria-controls'));
const open = (name) => act(() => { fireEvent.click(tab(name)); });
const kinds = () => FakeQueueManager.latest()?.requests.map((r) => r.kind) ?? [];

// The sections with a body of their own (all of them).
const BUILT = ['spawn', 'strongholds', 'structures', 'biomes', 'where', 'locator', 'farms', 'worlds'];

beforeEach(() => {
    seen = null;
    window.localStorage.clear();
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
});

describe('SeedPanel', () => {
    it('is a tab bar, one panel per tab, then the footer', () => {
        const { container } = renderPanel();
        expect(blocks(container)).toEqual(['anchor', 'tabs', 'panel:map', 'panel:world', 'panel:biomes', 'panel:near', 'panel:more', 'footer']);
        // Named in full; the strip shows an icon and a short label that is part of the name.
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Map', 'Spawn & structures', 'Biomes', 'Find near me', 'More']);
        expect(tabs.map((t) => t.textContent)).toEqual(['Map', 'Structures', 'Biomes', 'Near me', 'More']);
        for (const t of tabs) {
            expect(t.getAttribute('aria-label').toLowerCase()).toContain(t.textContent.toLowerCase());
            expect(t.querySelector('img')).toHaveAttribute('alt', '');
        }
        expect(screen.getByRole('tablist', { name: 'Dashboard' })).toBeInTheDocument();
        expect(container.lastElementChild).toHaveClass('site-footer', 'site-footer--compact');
        expect(container.querySelectorAll('footer')).toHaveLength(1);
    });

    it('opens on the Map tab: the controls, then the first ad unit; nothing else is mounted', () => {
        renderPanel();
        expect(tab('Map')).toHaveAttribute('aria-selected', 'true');
        expect(tab('Map')).toHaveAttribute('tabindex', '0');
        expect(tab('Biomes')).toHaveAttribute('aria-selected', 'false');
        expect(tab('Biomes')).toHaveAttribute('tabindex', '-1');
        expect(contents(panelOf('Map'))).toEqual(['controls', 'ad']);
        expect(panelOf('Map')).not.toHaveAttribute('hidden');
        expect(panelOf('Map')).toHaveAttribute('aria-labelledby', tab('Map').id);
        for (const name of ['Spawn & structures', 'Biomes', 'Find near me', 'More']) {
            expect(panelOf(name)).toHaveAttribute('hidden');
            expect(panelOf(name)).toBeEmptyDOMElement();
        }
        expect(document.querySelectorAll('section.section')).toHaveLength(0);
        expect(kinds()).toEqual([]);
    });

    it('each tab holds its sections in order, titled by their labels; none is on its way any more', () => {
        renderPanel();
        const expected = {
            'Spawn & structures': ['#spawn', '#strongholds', '#structures', 'ad'],
            Biomes: ['#locator', '#biomes'],
            'Find near me': ['#where'],
            More: ['#farms', '#worlds'],
        };
        for (const [name, list] of Object.entries(expected)) {
            open(name);
            expect(contents(panelOf(name)), name).toEqual(list);
            expect(panelOf(name)).not.toHaveAttribute('hidden');
            expect(panelOf('Map')).toHaveAttribute('hidden');
        }
        for (const { id, label, icon } of SECTIONS) {
            const heading = within(document.getElementById(id)).getByRole('heading', { name: label, level: 3, hidden: true });
            expect(heading.querySelector('img'), id).toHaveAttribute('src', icon);
        }
        expect([...BUILT].sort()).toEqual(SECTIONS.map((s) => s.id).sort());
        expect(screen.queryAllByText('This section is on its way.')).toEqual([]);
    });

    it('holds exactly two responsive ad units, the second at the end of Spawn & structures, never a placeholder', () => {
        const { container } = renderPanel();
        expect(container.querySelectorAll('ins.adsbygoogle')).toHaveLength(1);
        for (const name of ['Biomes', 'Find near me', 'More', 'Spawn & structures']) open(name);
        const units = container.querySelectorAll('ins.adsbygoogle');
        expect(units).toHaveLength(2);
        for (const ins of units) expect(ins).toHaveAttribute('data-ad-slot', '4456541019');
        expect(container.querySelector('.ad--placeholder')).toBeNull();
        expect(panelOf('Spawn & structures').lastElementChild).toContainElement(units[1]);
    });

    it('Spawn & structures mounts when opened, and its sections ask the engine then', () => {
        renderPanel();
        expect(kinds()).toEqual([]);
        open('Spawn & structures');
        // The world is in the Nether: no spawn for Structures to wait for, only the version's structures.
        expect(kinds()).toEqual(['SEED_SUMMARY', 'SEED_SUMMARY', 'STRONGHOLDS_LIST', 'GET_VERSION_SUPPORT']);
        expect(FakeQueueManager.latest().requests[2].data).toEqual({ mcVersion: WORLD.mcVersion, seed: WORLD.seed, howMany: 8 });
        expect(within(document.getElementById('spawn')).getByRole('status')).toBeInTheDocument();
    });

    it('Biomes mounts the breakdown and the locator when opened', () => {
        renderPanel();
        expect(screen.queryByText('The biome locator works in the Overworld.')).toBeNull();
        open('Biomes');
        // The world is in the Nether: the area around the origin, no spawn to wait for.
        expect(kinds()).toEqual(['GET_AREA']);
        expect(FakeQueueManager.latest().requests[0].data).toMatchObject({ startX: -250, startY: -250, widthX: 500, widthY: 500, dimension: -1, yHeight: 62 });
        expect(within(document.getElementById('locator')).getByText('The biome locator works in the Overworld.')).toBeInTheDocument();
    });

    it('Find near me shows its form when opened and asks the engine nothing before Locate', () => {
        renderPanel();
        expect(screen.queryByLabelText('X coordinate')).toBeNull();
        open('Find near me');
        const where = within(document.getElementById('where'));
        expect(where.getByLabelText('X coordinate')).toBeInTheDocument();
        expect(where.getByRole('button', { name: 'Locate' })).toBeInTheDocument();
        expect(kinds()).toEqual([]);
    });

    it('More mounts Farms and My worlds when opened; in the Nether Farms asks only for the version', () => {
        renderPanel();
        expect(document.getElementById('farms')).toBeNull();
        open('More');
        const farms = within(document.getElementById('farms'));
        expect(farms.getByRole('heading', { name: 'Farms', level: 3 })).toBeInTheDocument();
        // The world is in the Nether: no quad witch farm, no slime chunks; the fortresses wait for the version.
        expect(farms.getByText('Witch huts are in the Overworld.')).toBeInTheDocument();
        expect(farms.queryByRole('button', { name: 'Switch to the Nether' })).toBeNull();
        expect(kinds()).toEqual(['GET_VERSION_SUPPORT']);
        expect(within(document.getElementById('worlds')).getByText(/No saved worlds yet/)).toBeInTheDocument();
        expect(contents(panelOf('More'))).toEqual(['#farms', '#worlds']);
    });

    it('a tab opened once stays mounted while hidden: its state survives a look at another tab', () => {
        renderPanel();
        open('Find near me');
        fireEvent.change(screen.getByLabelText('X coordinate'), { target: { value: '123' } });
        open('More');
        expect(screen.getByText(/No saved worlds yet/)).toBeInTheDocument();
        expect(panelOf('Find near me')).toHaveAttribute('hidden');
        open('Find near me');
        expect(screen.getByLabelText('X coordinate')).toHaveValue(123);
    });

    it('arrow keys, Home and End move between tabs and open them', () => {
        renderPanel();
        tab('Map').focus();
        fireEvent.keyDown(tab('Map'), { key: 'ArrowRight' });
        expect(tab('Spawn & structures')).toHaveAttribute('aria-selected', 'true');
        expect(tab('Spawn & structures')).toHaveFocus();
        fireEvent.keyDown(tab('Spawn & structures'), { key: 'End' });
        expect(tab('More')).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(tab('More'), { key: 'ArrowRight' });
        expect(tab('Map')).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(tab('Map'), { key: 'ArrowLeft' });
        expect(tab('More')).toHaveFocus();
        fireEvent.keyDown(tab('More'), { key: 'Home' });
        expect(tab('Map')).toHaveAttribute('aria-selected', 'true');
    });

    it('gives the sections the world, the map and sheet handles and the structures on show', () => {
        const { mapApi, sheetApi, setStructuresToShow, setSlimeOverlay, setDimension } = renderPanel();
        expect(seen.world).toEqual(WORLD);
        expect(typeof seen.world.seed).toBe('string');
        expect(seen.mapApi).toBe(mapApi);
        expect(seen.sheetApi).toBe(sheetApi);
        expect(seen.structuresToShow).toEqual([5, 9]);
        expect(seen.setStructuresToShow).toBe(setStructuresToShow);
        expect(seen.slimeOverlay).toBe(false);
        expect(seen.setSlimeOverlay).toBe(setSlimeOverlay);
        expect(seen.setDimension).toBe(setDimension);
        expect(Array.isArray(seen.worlds.worlds)).toBe(true);
        expect(typeof seen.showSection).toBe('function');
    });

    it('on a phone the strip is portalled into the sheet header; a tab tapped while collapsed opens the sheet halfway', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        let snap = 'collapsed';
        const sheetApi = { current: { open: vi.fn((s) => { snap = s; }), close: vi.fn(), getSnap: () => snap } };
        const { container } = renderPanel({ sheetApi, tabsHost: host });
        expect(host.querySelector('[role=tablist]')).toHaveClass('dashboard-tabs--header');
        expect(container.querySelector('[role=tablist]')).toBeNull();
        open('Biomes');
        expect(sheetApi.current.open).toHaveBeenCalledWith('half');
        expect(panelOf('Biomes')).not.toHaveAttribute('hidden');
        open('More');                                                     // already open: the snap is left alone
        expect(sheetApi.current.open).toHaveBeenCalledTimes(1);
        host.remove();
    });

    it('showSection opens the section\'s tab (and the sheet fully on a phone)', () => {
        const sheetApi = { current: { open: vi.fn(), close: vi.fn(), getSnap: () => 'collapsed' } };
        renderPanel({ sheetApi });
        act(() => { seen.showSection('worlds'); });
        expect(sheetApi.current.open).toHaveBeenCalledWith('full');
        expect(tab('More')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText(/No saved worlds yet/)).toBeInTheDocument();
        act(() => { seen.showSection('nowhere'); });                   // not a section: nothing moves
        expect(tab('More')).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps the context stable across a re-render with the same world', () => {
        const { rerender, mapApi, sheetApi, setStructuresToShow, setSlimeOverlay, setDimension } = renderPanel();
        const first = seen;
        const again = (slimeOverlay) => rerender(
            <SeedPanel world={{ ...WORLD }} mapApi={mapApi} sheetApi={sheetApi} structuresToShow={first.structuresToShow}
                setStructuresToShow={setStructuresToShow} slimeOverlay={slimeOverlay} setSlimeOverlay={setSlimeOverlay}
                setDimension={setDimension} controls={<Probe />} />,
        );
        again(false);
        expect(seen).toBe(first);
        // The slime toggle is part of the value: sections see it change.
        again(true);
        expect(seen).not.toBe(first);
        expect(seen.slimeOverlay).toBe(true);
    });
});
