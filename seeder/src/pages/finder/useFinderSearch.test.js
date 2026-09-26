import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PROGRESS_THROTTLE_MS, useFinderSearch } from './useFinderSearch';
import { DEFAULT_CRITERIA, maxSeedsToScanFor } from './criteria';
import { FakeQueueManager } from '../../test/fakes';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';

const VILLAGE = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Village').value;
const criteria = {
    ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE], rangeBlocks: 300, count: 10,
    startingSeed: 9007199254740993n,
};

let queue;
let renders;
function setup() {
    renders = 0;
    return renderHook(() => { renders += 1; return useFinderSearch(queue); });
}

beforeEach(() => {
    vi.useFakeTimers();
    FakeQueueManager.reset();
    queue = new FakeQueueManager('/workers/worker.js', 4);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('useFinderSearch', () => {
    it('starts idle, with nothing to show', () => {
        const { result } = setup();
        expect(result.current).toMatchObject({ status: 'idle', hits: [], progress: null, result: null, criteria: null });
        expect(queue.findSeeds).not.toHaveBeenCalled();
    });

    it('start hands the coordinator a BigInt start, the count and the scan cap', () => {
        const { result } = setup();
        act(() => result.current.start({ ...criteria, startingSeed: 9007199254740993n }));
        const [sent] = queue.findSeeds.mock.calls[0];
        expect(sent).toEqual({
            mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 256, biomes: [], anyBiomes: [], excludeBiomes: [], structures: [VILLAGE], rangeBlocks: 300,
            startingSeed: 9007199254740993n, count: 10, maxSeedsToScan: maxSeedsToScanFor(criteria),
        });
        expect(typeof sent.startingSeed).toBe('bigint');
        expect(result.current.status).toBe('searching');
        expect(result.current.criteria).toEqual(criteria);
    });

    it('accepts a decimal string start and still sends a BigInt', () => {
        const { result } = setup();
        act(() => result.current.start({ ...criteria, startingSeed: '-42' }));
        expect(queue.findSeeds.mock.calls[0][0].startingSeed).toBe(-42n);
    });

    it('idle -> searching -> done, hits accumulating in order as views', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => { queue.emitHit({ seed: 123n, spawnX: 8, spawnZ: -24, structures: [{ type: VILLAGE, x: 96, z: -80 }] }); });
        act(() => { queue.emitHit({ seed: -7n, structures: [{ type: VILLAGE, x: 0, z: 16 }] }); });
        expect(result.current.hits.map((h) => h.seed)).toEqual(['123', '-7']);
        expect(result.current.hits[0]).toMatchObject({ spawn: { x: 8, z: -24 }, index: 0, structures: [{ name: 'Village', x: 96, z: -80, distance: 125 }] });
        expect(result.current.hits[1].index).toBe(1);
        act(() => { queue.finish('target', 250_000n, { examined: 2n, tested: 131_072, elapsedMs: 40 }); });
        expect(result.current.status).toBe('done');
        expect(result.current.result).toEqual({
            reason: 'target', examined: 2n, tested: 131_072, resumeSeed: 250_000n, elapsedMs: 40, error: null, target: 10,
        });
        expect(result.current.hits).toHaveLength(2);
    });

    it('throttles progress to one update per 250 ms, showing the latest values', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        const before = renders;
        act(() => {
            for (let i = 1; i <= 40; i++) {
                queue.emitProgress({ examined: BigInt(i * 1000), tested: i * 100, elapsedMs: i * 6 });
                vi.advanceTimersByTime(6);
            }
        });
        // 40 ticks over 240 ms: nothing shown yet, then one update with the 40th.
        expect(result.current.progress).toBeNull();
        expect(renders).toBe(before);
        act(() => { vi.advanceTimersByTime(PROGRESS_THROTTLE_MS - 240); });
        expect(renders).toBe(before + 1);
        expect(result.current.progress).toEqual({ examined: 40_000n, tested: 4_000, hits: 0, elapsedMs: 240 });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(renders).toBe(before + 1);
    });

    it('done flushes the last progress at once, with the final hit count', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => {
            queue.emitProgress({ examined: 5n, tested: 500, elapsedMs: 10 });
            vi.advanceTimersByTime(PROGRESS_THROTTLE_MS);
            queue.emitHit({ seed: 1n });
            queue.emitProgress({ examined: 9n, tested: 900, elapsedMs: 20 });
            queue.finish('target', 9n, { examined: 9n, tested: 900, elapsedMs: 20 });
        });
        expect(result.current.progress).toEqual({ examined: 9n, tested: 900, hits: 1, elapsedMs: 20 });
        // The pending timer was cleared with it.
        const shown = renders;
        act(() => { vi.advanceTimersByTime(1000); });
        expect(renders).toBe(shown);
    });

    it('stop calls stopSearch and ends the run as stopped, keeping the hits', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => { queue.emitHit({ seed: 11n }); });
        act(() => result.current.stop());
        expect(queue.stopSearch).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe('done');
        expect(result.current.result.reason).toBe('stopped');
        expect(result.current.hits.map((h) => h.seed)).toEqual(['11']);
        // Nothing is running any more: stop is a no-op.
        act(() => result.current.stop());
        expect(queue.stopSearch).toHaveBeenCalledTimes(1);
    });

    it('a second start while searching is ignored', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => result.current.start({ ...criteria, count: 50 }));
        expect(queue.findSeeds).toHaveBeenCalledTimes(1);
        expect(result.current.criteria.count).toBe(10);
    });

    it('a new start after done resets hits, progress and result', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => { queue.emitHit({ seed: 1n }); queue.finish('target'); });
        act(() => result.current.start({ ...criteria, count: 25 }));
        expect(queue.findSeeds).toHaveBeenCalledTimes(2);
        expect(result.current).toMatchObject({ status: 'searching', hits: [], progress: null, result: null });
        expect(result.current.criteria.count).toBe(25);
    });

    it('carries an engine error in the result', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        const error = { code: -3, message: 'Village does not generate in this version.' };
        act(() => { queue.finish('error', 0n, { error }); });
        expect(result.current.result).toMatchObject({ reason: 'error', error });
    });

    it('reset stops a running search and goes back to idle; its late hits are ignored', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => { queue.emitHit({ seed: 11n }); queue.emitProgress({ examined: 5n, tested: 10, hits: 1, elapsedMs: 5 }); });
        const stale = queue.lastSearch();
        act(() => result.current.reset());
        expect(stale.active).toBe(false);
        expect(result.current).toMatchObject({ status: 'idle', hits: [], progress: null, result: null, criteria: null });
        // The stopped run's leftovers change nothing.
        act(() => { stale.cbs.onHit?.({ seed: 12n }); vi.advanceTimersByTime(1000); });
        expect(result.current).toMatchObject({ status: 'idle', hits: [], progress: null });
        // A new start works as usual.
        act(() => result.current.start(criteria));
        expect(queue.findSeeds).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe('searching');
    });

    it('reset after done clears what was found', () => {
        const { result } = setup();
        act(() => result.current.start(criteria));
        act(() => { queue.emitHit({ seed: 1n }); queue.finish('target'); });
        act(() => result.current.reset());
        expect(result.current).toMatchObject({ status: 'idle', hits: [], progress: null, result: null, criteria: null });
    });

    it('unmounting stops a running search', () => {
        const { result, unmount } = setup();
        act(() => result.current.start(criteria));
        unmount();
        expect(queue.searching).toBe(false);
        expect(queue.lastSearch().active).toBe(false);
    });
});
