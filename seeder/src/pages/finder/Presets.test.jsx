// The preset chips as a visitor sees them: grouped with the newest version's group
// first, each chip named by its catchy name and described by its contents, greyed out
// with a reason where the version cannot run them, and none with a share link.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
// Explicit extensions: presets.js and Presets.jsx differ only in case, and on a
// case-insensitive disk './Presets' resolves to presets.js first.
import Presets from './Presets.jsx';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { FakeMatchMedia, defaultVersionSupport } from '../../test/fakes';
import { NEWEST_MC, PINNED_GROUP, PRESETS, PRESET_GROUPS, presetBadge, presetCaption, presetsOf } from './presets.js';

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const ALL_BIOMES = BIOMES.map((b) => b.value);
const ALL_TYPES = STRUCTURES_OPTIONS.map((s) => s.value);
const NEWEST = Object.keys(VERSIONS).find((k) => VERSIONS[k] === NEWEST_MC);
const bySlug = (slug) => PRESETS.find((p) => p.slug === slug);

function support(mcVersion) {
    const s = defaultVersionSupport(mcVersion, ALL_BIOMES, ALL_TYPES);
    for (const t of ['Fortress', 'Bastion']) s.structures[structure(t)] = -1;
    s.structures[structure('End City')] = 1;
    for (const b of ['Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Delta']) s.biomeDimensions[biome(b)] = -1;
    if (mcVersion === VERSIONS['1.12']) {
        const newer = ['Cherry Grove', 'Pale Garden', 'Dappled Forest', 'Sulfur Caves', 'Lush Caves', 'Meadow', 'Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Delta', 'Bamboo Jungle'];
        s.biomes = s.biomes.filter((id) => !newer.map(biome).includes(id));
        for (const t of ['Ruined Portal', 'Ancient City', 'Trial Chamber', 'Trail Ruin', 'Abandoned Camp', 'Bastion', 'Shipwreck', 'Outpost']) s.structures[structure(t)] = -100;
    }
    return s;
}
// The badge of a pinned preset from an earlier drop is part of its name.
const nameOf = (p) => (presetBadge(p) ? `${p.label} ${presetBadge(p)}` : p.label);
const chip = (name) => screen.getByRole('button', { name, exact: true });

describe('Presets', () => {
    it('renders the seven groups, the newest version\'s first, each with its chips', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
        expect(screen.getByRole('heading', { name: 'Presets', level: 2 })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(PRESET_GROUPS.map((g) => g.title));
        expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent(`New in ${NEWEST}`);
        for (const p of PRESETS) expect(chip(nameOf(p))).toBeEnabled();
        for (const g of PRESET_GROUPS) {
            const group = screen.getByRole('heading', { name: g.title }).parentElement;
            expect(within(group).getAllByRole('listitem'), g.title).toHaveLength(presetsOf(g.id).length);
        }
    });

    it('names each chip by its catchy name and describes it by what it searches', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
        expect(chip('Villagers & Pillagers')).toHaveAccessibleDescription('Village + Outpost, 300 blocks');
        expect(within(chip('Villagers & Pillagers')).getByText('Village + Outpost, 300 blocks')).toBeVisible();
        expect(chip('Happy ghast start')).toHaveAccessibleDescription('Soul Sand Valley + Fortress, 150 blocks, Nether');
        for (const p of PRESETS) expect(chip(nameOf(p))).toHaveAccessibleDescription(presetCaption(p));
    });

    it('marks a pinned preset from an earlier drop with its version, and no preset as SLOW', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
        const sulfur = chip('Sulfur village 26.2');
        expect(within(sulfur).getByText('26.2')).toBeVisible();
        expect(within(chip('Camp at spawn')).queryByText(NEWEST)).toBeNull();
        expect(screen.queryByText('SLOW')).toBeNull();
    });

    it('greys out what the version cannot run, with the reason as title and description', () => {
        render(<Presets mcVersion={VERSIONS['1.12']} support={support(VERSIONS['1.12'])} onApply={vi.fn()} />);
        const cherry = chip('Cherry Grove at spawn');
        expect(cherry).toBeDisabled();
        expect(cherry).toHaveAttribute('title', 'Cherry Grove does not exist in 1.12.');
        expect(cherry).toHaveAccessibleDescription('Cherry Grove does not exist in 1.12. Cherry Grove, 100 blocks');
        // Printed under both Cherry Grove presets (Alpine meadow names Meadow first).
        const printed = screen.getAllByText('Cherry Grove does not exist in 1.12.', { selector: 'p' });
        expect(printed).toHaveLength(2);
        for (const p of printed) expect(p).toBeVisible();
        expect(chip('Loot run')).toHaveAccessibleDescription('Ancient City does not generate in 1.12. Ancient City + Trial Chamber, 150 blocks');
        expect(chip('Village at spawn')).toBeEnabled();
        expect(chip('Village at spawn')).not.toHaveAttribute('title');
    });

    it('keeps the pinned group enabled on an older version: each chip says it switches to the newest', () => {
        render(<Presets mcVersion={VERSIONS['1.12']} support={support(VERSIONS['1.12'])} onApply={vi.fn()} />);
        const switching = PRESETS.filter((p) => p.since != null);
        expect(switching.map((p) => p.slug)).toEqual(expect.arrayContaining([...presetsOf(PINNED_GROUP).map((p) => p.slug), 'survival-island']));
        for (const p of switching) {
            const button = chip(nameOf(p));
            expect(button, p.slug).toBeEnabled();
            expect(button).toHaveAccessibleDescription(`Switches to ${NEWEST}. ${presetCaption(p)}`);
        }
        expect(screen.getAllByText(`Switches to ${NEWEST}.`, { selector: 'p' })).toHaveLength(switching.length);
    });

    it('says nothing about switching on the newest version', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
        expect(screen.queryByText(/^Switches to/)).toBeNull();
    });

    it('waits quietly while the version is being checked', () => {
        render(<Presets mcVersion={NEWEST_MC} support={null} onApply={vi.fn()} />);
        for (const p of PRESETS) expect(chip(nameOf(p))).toBeDisabled();
        expect(screen.queryByText('Checking what this version supports…')).toBeNull();
    });

    it('a click fills the criteria with the current version and seed 0, and nothing else', () => {
        const onApply = vi.fn();
        render(<Presets mcVersion={VERSIONS['1.16.5']} support={support(VERSIONS['1.16.5'])} onApply={onApply} />);
        fireEvent.click(chip('Bastion + Fortress'));
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply.mock.calls[0][0]).toMatchObject({
            mcVersion: VERSIONS['1.16.5'], dimension: -1, structures: [structure('Bastion'), structure('Fortress')], biomes: [], rangeBlocks: 200, startingSeed: 0n,
        });
    });

    it('a pinned chip clicked on an older version hands over the newest version', () => {
        const onApply = vi.fn();
        render(<Presets mcVersion={VERSIONS['1.12']} support={support(VERSIONS['1.12'])} onApply={onApply} />);
        fireEvent.click(chip('Autumn camp'));
        expect(onApply.mock.calls[0][0]).toMatchObject({
            mcVersion: NEWEST_MC, biomes: [biome('Dappled Forest')], structures: [structure('Abandoned Camp')], rangeBlocks: 300, startingSeed: 0n,
        });
    });

    it('carries a cave preset\'s Y', () => {
        const onApply = vi.fn();
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={onApply} />);
        fireEvent.click(chip('Village + Lush Caves'));
        expect(onApply.mock.calls[0][0]).toMatchObject({ yHeight: 0, biomes: [biome('Lush Caves')], structures: [structure('Village')] });
    });

    it('offers no share link on any preset', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
        expect(screen.queryByText('Copy link')).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(PRESETS.length);
    });

    it('disables every chip while a search runs', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} disabled />);
        for (const p of PRESETS) expect(chip(nameOf(p))).toBeDisabled();
    });

    it('focusTitle focuses the heading, and scrolls it to the top only when it is low on the screen', () => {
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
        rect.mockReturnValue({ top: 100, bottom: 130, left: 0, right: 0, width: 0, height: 30 });
        const { unmount } = render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} focusTitle />);
        expect(screen.getByRole('heading', { name: 'Presets', level: 2 })).toHaveFocus();
        expect(scroll).not.toHaveBeenCalled();
        unmount();
        // Under a phone's form: far below a third of the screen.
        rect.mockReturnValue({ top: window.innerHeight, bottom: window.innerHeight + 30, left: 0, right: 0, width: 0, height: 30 });
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} focusTitle />);
        expect(scroll).toHaveBeenCalledWith({ block: 'start' });
        scroll.mockRestore();
        rect.mockRestore();
    });

    it('leaves the focus alone without focusTitle', () => {
        render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
        expect(screen.getByRole('heading', { name: 'Presets', level: 2 })).not.toHaveFocus();
    });

    describe('on a phone', () => {
        it('opens only the pinned group; every other group is a disclosure', () => {
            FakeMatchMedia.set('(min-width: 768px)', false);
            render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
            const [pinned, ...rest] = PRESET_GROUPS;
            expect(screen.getByRole('button', { name: pinned.title })).toHaveAttribute('aria-expanded', 'true');
            for (const p of presetsOf(pinned.id)) expect(chip(nameOf(p))).toBeVisible();
            for (const g of rest) {
                expect(screen.getByRole('button', { name: g.title }), g.title).toHaveAttribute('aria-expanded', 'false');
                for (const p of presetsOf(g.id)) expect(screen.queryByRole('button', { name: nameOf(p), exact: true }), p.slug).toBeNull();
            }

            fireEvent.click(screen.getByRole('button', { name: 'Speedrun' }));
            expect(screen.getByRole('button', { name: 'Speedrun' })).toHaveAttribute('aria-expanded', 'true');
            expect(chip('Classic fast start')).toBeVisible();
            fireEvent.click(screen.getByRole('button', { name: pinned.title }));
            expect(screen.queryByRole('button', { name: 'Camp at spawn', exact: true })).toBeNull();
            // Still a heading per group.
            expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(PRESET_GROUPS.map((g) => g.title));
        });

        it('keeps a disclosure\'s list tied to its button', () => {
            FakeMatchMedia.set('(min-width: 768px)', false);
            render(<Presets mcVersion={NEWEST_MC} support={support(NEWEST_MC)} onApply={vi.fn()} />);
            const toggle = screen.getByRole('button', { name: 'Nether & End' });
            const list = document.getElementById(toggle.getAttribute('aria-controls'));
            expect(list).toHaveAttribute('hidden');
            fireEvent.click(toggle);
            expect(list).not.toHaveAttribute('hidden');
            expect(within(list).getAllByRole('listitem')).toHaveLength(presetsOf('nether-end').length);
        });
    });
});
