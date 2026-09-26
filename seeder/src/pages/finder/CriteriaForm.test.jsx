// The criteria form as a visitor uses it: react-select by keyboard, fields by their
// accessible names, warnings and errors by their text.
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import CriteriaForm from './CriteriaForm';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { defaultVersionSupport } from '../../test/fakes';
import { BIOME_RANGE_CAP_REASON, DEFAULT_CRITERIA } from './criteria';
import { HELP } from '../../shared/help';

const biome = (label) => BIOMES.find((b) => b.label === label).value;
const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const ALL_BIOMES = BIOMES.map((b) => b.value);
const ALL_TYPES = STRUCTURES_OPTIONS.map((s) => s.value);
const NETHER_BIOMES = ['Nether Wastes', 'Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Delta'];
const END_BIOMES = ['The End', 'Small End Islands', 'End Midlands', 'End Highlands', 'End Barrens'];

// The engine's facts for 26.3 that matter here; 1.12 lacks the newer biomes and structures.
function support(mcVersion = VERSIONS['26.3']) {
    const s = defaultVersionSupport(mcVersion, ALL_BIOMES, ALL_TYPES);
    for (const label of NETHER_BIOMES) s.biomeDimensions[biome(label)] = -1;
    for (const label of END_BIOMES) s.biomeDimensions[biome(label)] = 1;
    for (const t of ['Fortress', 'Bastion']) s.structures[structure(t)] = -1;
    for (const t of ['End City', 'End Gateway']) s.structures[structure(t)] = 1;
    s.regionBlocks[structure('End Gateway')] = 16;
    s.minDistance[structure('End City')] = 1008;
    if (mcVersion === VERSIONS['1.12']) {
        const newer = ['Cherry Grove', 'Pale Garden', 'Dappled Forest', ...NETHER_BIOMES.slice(1)].map(biome);
        s.biomes = s.biomes.filter((id) => !newer.includes(id));
        for (const t of ['Ruined Portal', 'Ancient City', 'Trial Chamber', 'Bastion', 'Trail Ruin', 'Abandoned Camp', 'Shipwreck']) {
            s.structures[structure(t)] = -100;
        }
    }
    return s;
}

// A controlled form, like FinderPage: the latest criteria are exposed to the test.
function renderForm({ initial = {}, supportFor = support, disabled = false, onSearch = vi.fn() } = {}) {
    const seen = { criteria: { ...DEFAULT_CRITERIA, ...initial } };
    function Harness() {
        const [criteria, setCriteria] = useState(seen.criteria);
        seen.criteria = criteria;
        const s = supportFor ? supportFor(criteria.mcVersion) : null;
        return <CriteriaForm criteria={criteria} onChange={setCriteria} onSearch={onSearch} support={s} disabled={disabled} />;
    }
    render(<Harness />);
    return { seen, onSearch };
}

const flush = () => act(async () => { await Promise.resolve(); });
const openMenu = (label) => fireEvent.keyDown(screen.getByLabelText(label), { key: 'ArrowDown', code: 'ArrowDown' });
const optionTexts = () => screen.queryAllByRole('option').map((o) => o.textContent);
// react-select: open the control with this accessible name and click an option by its text.
async function select(label, optionText) {
    openMenu(label);
    const option = screen.getAllByRole('option').find((o) => o.textContent === optionText || o.textContent.startsWith(optionText));
    if (!option) throw new Error(`no option "${optionText}" in ${label}: ${optionTexts().join(' | ')}`);
    fireEvent.click(option);
    await flush();
}
const warnings = () => within(screen.getByRole('status')).queryAllByRole('listitem').map((li) => li.textContent);
const errors = () => within(screen.getByRole('alert')).queryAllByRole('listitem').map((li) => li.textContent);
const searchButton = () => screen.getByRole('button', { name: 'Search' });

describe('CriteriaForm - options follow the version support and the dimension', () => {
    it('offers no chunk-scale End Gateway and no other dimension\'s structures', () => {
        renderForm({ initial: { dimension: 1 } });
        openMenu('Structures');
        expect(optionTexts()).toEqual(['End City']);
    });

    it('lists Overworld structures in the Overworld, with Ruined Portal also in the Nether', async () => {
        renderForm();
        openMenu('Structures');
        expect(optionTexts()).toContain('Village');
        expect(optionTexts()).not.toContain('Fortress');
        expect(optionTexts()).not.toContain('End Gateway');
        fireEvent.keyDown(screen.getByLabelText('Structures'), { key: 'Escape' });
        await select('Dimension', 'Nether');
        openMenu('Structures');
        expect(optionTexts()).toEqual(['Ruined Portal', 'Fortress', 'Bastion']);
    });

    it('offers Nether biomes only in the Nether', async () => {
        renderForm();
        openMenu('Biomes');
        expect(optionTexts()).toContain('Plains');
        expect(optionTexts()).not.toContain('Crimson Forest');
        fireEvent.keyDown(screen.getByLabelText('Biomes'), { key: 'Escape' });
        await select('Dimension', 'Nether');
        openMenu('Biomes');
        expect(optionTexts()).toEqual(NETHER_BIOMES);
    });

    it('offers biomes that exist on the version only', () => {
        renderForm({ initial: { mcVersion: VERSIONS['1.12'] } });
        openMenu('Biomes');
        expect(optionTexts()).toContain('Plains');
        expect(optionTexts()).not.toContain('Cherry Grove');
    });
});

describe('CriteriaForm - warnings and errors, live', () => {
    it('two structures -> the multi-structure warning', async () => {
        renderForm();
        expect(warnings()).toEqual([]);
        await select('Structures', 'Village');
        await select('Structures', 'Mansion');
        expect(warnings()).toEqual(['Each extra structure multiplies the odds: matches get much rarer and the search slower.']);
    });

    it('26.3 + a biome + 500 blocks -> the range warning with the rate', async () => {
        renderForm();
        await select('Biomes', 'Plains');
        await select('Range', '500 blocks');
        expect(warnings()).toEqual(['Biomes on 1.18+ are slow beyond 300 blocks: expect ~5 seeds/s per core.']);
    });

    it('End + End City + 300 blocks -> the error, and Search stays disabled', async () => {
        const { onSearch } = renderForm({ initial: { dimension: 1 } });
        await select('Structures', 'End City');
        expect(errors()).toEqual(['End City only generates more than 1,008 blocks from the centre: set the range to at least 1,008 blocks.']);
        expect(searchButton()).toBeDisabled();
        fireEvent.click(searchButton());
        expect(onSearch).not.toHaveBeenCalled();
        await select('Range', '2k blocks');
        expect(errors()).toEqual([]);
        expect(searchButton()).toBeEnabled();
    });

    it('a biome selected -> 2k is disabled, with its reason', async () => {
        const { seen } = renderForm();
        openMenu('Range');
        expect(screen.queryByText(BIOME_RANGE_CAP_REASON)).toBeNull();
        fireEvent.keyDown(screen.getByLabelText('Range'), { key: 'Escape' });
        await select('Biomes', 'Plains');
        // The reason under the select, and inside the menu next to the option.
        expect(screen.getByText(`2k blocks: ${BIOME_RANGE_CAP_REASON}`)).toBeInTheDocument();
        openMenu('Range');
        const twoK = screen.getAllByRole('option').find((o) => o.textContent.startsWith('2k blocks'));
        expect(twoK).toHaveTextContent(BIOME_RANGE_CAP_REASON);
        expect(twoK).toHaveTextContent('SLOW');
        fireEvent.click(twoK);
        await flush();
        expect(seen.criteria.rangeBlocks).toBe(300);
    });

    it('switching dimension drops what the new dimension cannot hold and says so', async () => {
        const { seen } = renderForm({ initial: { structures: [structure('Village'), structure('Ruined Portal')], biomes: [biome('Plains')] } });
        await select('Dimension', 'Nether');
        expect(seen.criteria.structures).toEqual([structure('Ruined Portal')]);
        expect(seen.criteria.biomes).toEqual([]);
        expect(screen.getByText('Removed Plains: it does not generate in the Nether. Removed Village: it does not generate in the Nether.')).toBeInTheDocument();
    });

    it('switching version drops what the version lacks', async () => {
        const { seen } = renderForm({ initial: { biomes: [biome('Cherry Grove'), biome('Plains')] } });
        await select('Minecraft version', '1.12');
        expect(seen.criteria.mcVersion).toBe(VERSIONS['1.12']);
        expect(seen.criteria.biomes).toEqual([biome('Plains')]);
        expect(screen.getByText('Removed Cherry Grove: it does not exist in 1.12.')).toBeInTheDocument();
    });

    it('drops nothing while the new version is still being checked', async () => {
        const { seen } = renderForm({ initial: { biomes: [biome('Cherry Grove')] }, supportFor: null });
        await select('Minecraft version', '1.12');
        expect(seen.criteria.biomes).toEqual([biome('Cherry Grove')]);
        expect(screen.getByText('Checking what this version supports…')).toBeInTheDocument();
        expect(searchButton()).toBeDisabled();
    });
});

describe('CriteriaForm - fields', () => {
    it('Biome height from 1.18 (inclusive)', async () => {
        renderForm({ initial: { mcVersion: VERSIONS['1.17'] } });
        expect(screen.queryByLabelText('Biome height')).toBeNull();
        await select('Minecraft version', '1.18');
        expect(screen.getByLabelText('Biome height')).toBeInTheDocument();
    });

    it('Range and Biome height have a "?" beside the label, not in it', async () => {
        renderForm({ initial: { mcVersion: VERSIONS['1.17'] } });
        expect(screen.getByLabelText('Range')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: HELP.range.label }));
        expect(screen.getByRole('dialog', { name: HELP.range.label })).toHaveTextContent(HELP.range.text);
        expect(screen.queryByRole('button', { name: HELP.biomeHeight.label })).toBeNull();
        await select('Minecraft version', '1.18');
        expect(screen.getByRole('button', { name: HELP.biomeHeight.label })).toBeInTheDocument();
        expect(screen.getByLabelText('Biome height')).toBeInTheDocument();
    });

    it('Advanced shows and hides its three fields', () => {
        renderForm();
        const toggle = screen.getByRole('button', { name: 'Advanced' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        for (const name of ['Start seed', 'Exact range (blocks)', 'Exact height']) expect(screen.getByLabelText(name)).not.toBeVisible();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        for (const name of ['Start seed', 'Exact range (blocks)', 'Exact height']) expect(screen.getByLabelText(name)).toBeVisible();
        fireEvent.click(toggle);
        expect(screen.getByLabelText('Start seed')).not.toBeVisible();
    });

    it('Start seed takes a 19-digit value as a BigInt; blank is 0; junk keeps the last good one', () => {
        const { seen } = renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        const input = screen.getByLabelText('Start seed');
        fireEvent.change(input, { target: { value: '8091867987493326313' } });
        expect(seen.criteria.startingSeed).toBe(8091867987493326313n);
        expect(typeof seen.criteria.startingSeed).toBe('bigint');
        fireEvent.change(input, { target: { value: '12ab' } });
        expect(seen.criteria.startingSeed).toBe(8091867987493326313n);
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveValue('12ab');
        fireEvent.change(input, { target: { value: '' } });
        expect(seen.criteria.startingSeed).toBe(0n);
    });

    it('Exact range overrides the select, and an impossible one shows the error', async () => {
        const { seen } = renderForm({ initial: { structures: [structure('Village')] } });
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        fireEvent.change(screen.getByLabelText('Exact range (blocks)'), { target: { value: '420' } });
        expect(seen.criteria.rangeBlocks).toBe(420);
        expect(screen.getByText('420 blocks (exact)')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Exact range (blocks)'), { target: { value: '3000' } });
        expect(errors()).toEqual(['The range must be between 1 and 2,048 blocks.']);
        await select('Range', '750 blocks');
        expect(seen.criteria.rangeBlocks).toBe(750);
        expect(screen.getByLabelText('Exact range (blocks)')).toHaveValue(750);
    });

    it('Exact height sets Y within -64..320', () => {
        const { seen } = renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
        fireEvent.change(screen.getByLabelText('Exact height'), { target: { value: '-12' } });
        expect(seen.criteria.yHeight).toBe(-12);
        fireEvent.change(screen.getByLabelText('Exact height'), { target: { value: '500' } });
        expect(seen.criteria.yHeight).toBe(-12);
        expect(screen.getByLabelText('Exact height')).toHaveAttribute('aria-invalid', 'true');
    });

    it('Results is a radio group of 10 / 25 / 50', () => {
        const { seen } = renderForm();
        const group = screen.getByRole('group', { name: 'Results' });
        expect(within(group).getAllByRole('radio').map((r) => r.value)).toEqual(['10', '25', '50']);
        expect(within(group).getByRole('radio', { name: '10' })).toBeChecked();
        fireEvent.click(within(group).getByRole('radio', { name: '50' }));
        expect(seen.criteria.count).toBe(50);
        expect(within(group).getByRole('radio', { name: '50' })).toBeChecked();
    });
});

describe('CriteriaForm - Search', () => {
    it('calls onSearch(criteria) only when the criteria are valid', async () => {
        const { onSearch, seen } = renderForm();
        expect(searchButton()).toBeDisabled();
        expect(screen.getByText('Pick at least one biome or structure.')).toBeInTheDocument();
        expect(errors()).toEqual([]);               // an empty form is not an error
        await select('Structures', 'Village');
        fireEvent.click(searchButton());
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onSearch).toHaveBeenCalledWith(seen.criteria);
        expect(onSearch.mock.calls[0][0].structures).toEqual([structure('Village')]);
    });

    it('disabled disables everything', () => {
        renderForm({ initial: { structures: [structure('Village')] }, disabled: true });
        for (const name of ['Biomes', 'Any of these biomes', 'Avoid these biomes', 'Structures', 'Range', 'Minecraft version', 'Dimension', 'Biome height']) {
            expect(screen.getByLabelText(name), name).toBeDisabled();
        }
        for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Advanced' })).toBeDisabled();
        expect(screen.getByLabelText('Start seed')).toBeDisabled();
        expect(screen.getByLabelText('Exact range (blocks)')).toBeDisabled();
        expect(screen.getByLabelText('Exact height')).toBeDisabled();
        expect(searchButton()).toBeDisabled();
    });
});

describe('CriteriaForm - any-of and avoid lists', () => {
    const moreToggle = () => screen.getByRole('button', { name: /More biome options/ });

    it('starts collapsed behind "More biome options", which opens and closes while both lists are empty', () => {
        renderForm();
        expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByLabelText('Avoid these biomes').closest('[hidden]')).not.toBeNull();
        fireEvent.click(moreToggle());
        expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByLabelText('Avoid these biomes').closest('[hidden]')).toBeNull();
        fireEvent.click(moreToggle());
        expect(moreToggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('stays open, and cannot be closed, while a list holds biomes (a preset, a link)', () => {
        renderForm({ initial: { excludeBiomes: [biome('Ocean')] } });
        expect(moreToggle()).toHaveAttribute('aria-expanded', 'true');
        expect(moreToggle()).toBeDisabled();
        expect(screen.getByLabelText('Avoid these biomes').closest('[hidden]')).toBeNull();
    });

    it('picks biomes in both lists by their labels, and an id taken in one list leaves the others', async () => {
        const { seen } = renderForm();
        fireEvent.click(moreToggle());
        await select('Any of these biomes', 'Snowy Plains');
        await select('Any of these biomes', 'Ice Spikes');
        await select('Avoid these biomes', 'Ocean');
        expect(seen.criteria).toMatchObject({ biomes: [], anyBiomes: [biome('Snowy Plains'), biome('Ice Spikes')], excludeBiomes: [biome('Ocean')] });
        expect(searchButton()).toBeEnabled();                 // an avoid list alone is a criterion

        openMenu('Biomes');
        expect(optionTexts()).not.toContain('Snowy Plains');
        expect(optionTexts()).not.toContain('Ocean');
        expect(optionTexts()).toContain('Plains');
        fireEvent.keyDown(screen.getByLabelText('Biomes'), { key: 'Escape' });
        openMenu('Avoid these biomes');
        expect(optionTexts()).not.toContain('Ice Spikes');
        fireEvent.keyDown(screen.getByLabelText('Avoid these biomes'), { key: 'Escape' });
        openMenu('Any of these biomes');
        expect(optionTexts()).not.toContain('Ocean');
    });

    it('says where avoided biomes are checked: at the biome height from 1.18, in the whole range before', async () => {
        renderForm();
        fireEvent.click(moreToggle());
        expect(screen.getByText('Checked at the biome height below, inside the whole range.')).toBeVisible();
        await select('Minecraft version', '1.17');
        expect(screen.getByText('Checked inside the whole range.')).toBeInTheDocument();
    });

    it('a biome both wanted and avoided (a pasted link) is an error that names it', () => {
        renderForm({ initial: { biomes: [biome('Plains')], excludeBiomes: [biome('Plains')] } });
        expect(errors()).toEqual(['Plains is both wanted and avoided.']);
        expect(searchButton()).toBeDisabled();
    });

    it('no accessible name on the finder form contains "Seed" but the start seed box', () => {
        renderForm();
        expect(screen.getAllByLabelText(/seed/i)).toEqual([screen.getByLabelText('Start seed')]);
    });
});
