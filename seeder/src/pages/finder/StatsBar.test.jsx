import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatsBar from './StatsBar';
import { DEFAULT_CRITERIA, maxSeedsToScanFor } from './criteria';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { HELP } from '../../shared/help';

const VILLAGE = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Village').value;
const PLAINS = BIOMES.find((b) => b.label === 'Plains').value;
const structures = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE], rangeBlocks: 300 };
const biomes = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['1.17'], biomes: [PLAINS], rangeBlocks: 100 };

const searching = (over = {}) => ({
    status: 'searching', target: 10, result: null, criteria: structures, onStop: vi.fn(),
    progress: { examined: 12_500_000n, tested: 21_000, hits: 3, elapsedMs: 65_000 },
    ...over,
});
const done = (reason, extra = {}, over = {}) => ({
    status: 'done', target: 10, criteria: structures, onStop: vi.fn(),
    progress: { examined: 40n, tested: 2_621_440, hits: 4, elapsedMs: 1_200 },
    result: { reason, examined: 40n, tested: 2_621_440, resumeSeed: 40n, elapsedMs: 1_200, error: null, target: 10, ...extra },
    ...over,
});

describe('StatsBar', () => {
    it('renders nothing while idle', () => {
        const { container } = render(<StatsBar status="idle" progress={null} target={10} result={null} criteria={null} onStop={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows seeds checked, seeds/s and the elapsed time in a status line', () => {
        render(<StatsBar {...searching()} />);
        expect(screen.getByRole('status')).toHaveTextContent('Searching… 21,000 seeds checked · 323 seeds/s · 1m 5s');
    });

    it('says how many of the wanted results were found', () => {
        render(<StatsBar {...searching()} />);
        expect(screen.getByRole('status')).toHaveTextContent('found 3 of 10');
    });

    it('shows zeros before the first progress arrives', () => {
        render(<StatsBar {...searching({ progress: null })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Searching… 0 seeds checked · 0 seeds/s · 0s');
        expect(screen.getByRole('status')).toHaveTextContent('found 0 of 10');
        expect(screen.getByRole('progressbar', { name: 'Search progress' })).toHaveAttribute('value', '0');
    });

    it('the progress bar is examined over the scan cap', () => {
        render(<StatsBar {...searching()} />);
        const bar = screen.getByRole('progressbar', { name: 'Search progress' });
        expect(maxSeedsToScanFor(structures)).toBe(50_000_000n);
        expect(bar).toHaveAttribute('max', '1');
        expect(bar).toHaveAttribute('value', '0.25');
    });

    it('counts layouts with structures and seeds without', () => {
        const { unmount } = render(<StatsBar {...searching()} />);
        expect(screen.getByText('12,500,000 of 50,000,000 layouts scanned')).toBeInTheDocument();
        unmount();
        render(<StatsBar {...searching({ criteria: biomes, progress: { examined: 1_250_000n, tested: 1_250_000, hits: 1, elapsedMs: 1000 } })} />);
        expect(screen.getByText('1,250,000 of 5,000,000 seeds scanned')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.25');
    });

    it('explains the scanned unit with a "?" outside the status', () => {
        const { unmount } = render(<StatsBar {...searching()} />);
        const status = screen.getByRole('status');
        fireEvent.click(screen.getByRole('button', { name: HELP.layouts.label }));
        expect(screen.getByRole('dialog', { name: HELP.layouts.label })).toHaveTextContent(HELP.layouts.text);
        expect(status).not.toContainElement(screen.getByRole('button', { name: HELP.layouts.label }));
        expect(screen.getAllByRole('status')).toHaveLength(1);
        unmount();
        render(<StatsBar {...searching({ criteria: biomes })} />);
        expect(screen.getByRole('button', { name: HELP.seedsScanned.label })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: HELP.layouts.label })).toBeNull();
    });

    it('keeps the "?" after an exhausted run, and only then', () => {
        const { unmount } = render(<StatsBar {...done('exhausted')} />);
        expect(screen.getByRole('button', { name: HELP.layouts.label })).toBeInTheDocument();
        expect(screen.getByRole('status')).not.toContainElement(screen.getByRole('button', { name: HELP.layouts.label }));
        unmount();
        render(<StatsBar {...done('target')} />);
        expect(screen.queryByRole('button', { name: HELP.layouts.label })).toBeNull();
    });

    it('keeps 64-bit counters exact', () => {
        render(<StatsBar {...searching({ progress: { examined: 9007199254740993n, tested: 0, hits: 0, elapsedMs: 0 } })} />);
        expect(screen.getByText(/^9,007,199,254,740,993 of/)).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
    });

    it('STOP calls onStop', () => {
        const props = searching();
        render(<StatsBar {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'STOP' }));
        expect(props.onStop).toHaveBeenCalledTimes(1);
    });

    it('target: one sentence, no STOP, no progress bar', () => {
        render(<StatsBar {...done('target')} />);
        expect(screen.getByRole('status')).toHaveTextContent('Found all 10 seeds after 2,621,440 seeds checked in 1s.');
        expect(screen.queryByRole('button', { name: 'STOP' })).toBeNull();
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('a sub-second run ends "in under 1s"', () => {
        render(<StatsBar {...done('target', { elapsedMs: 104 })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Found all 10 seeds after 2,621,440 seeds checked in under 1s.');
    });

    it('exhausted: found X of Y after scanning N, with advice', () => {
        render(<StatsBar {...done('exhausted', { examined: 5_000_000n }, { criteria: biomes })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Found 4 of 10 after scanning 5,000,000 seeds: try a wider range or fewer criteria.');
    });

    it('stopped: seeds checked and results kept', () => {
        render(<StatsBar {...done('stopped')} />);
        expect(screen.getByRole('status')).toHaveTextContent('Stopped after 2,621,440 seeds checked; 4 results kept.');
    });

    it('stopped with one result says "1 result"', () => {
        render(<StatsBar {...done('stopped', {}, { progress: { examined: 1n, tested: 5, hits: 1, elapsedMs: 3 } })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Stopped after 2,621,440 seeds checked; 1 result kept.');
    });

    it('error: the engine message as an alert', () => {
        const error = { code: -3, message: 'Ancient City does not generate in 1.12.' };
        render(<StatsBar {...done('error', { error })} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Ancient City does not generate in 1.12.');
        expect(screen.queryByRole('status')).toBeNull();
    });
});
