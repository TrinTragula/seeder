// tally() and useAreaTally over the recording FakeQueueManager: the test answers GET_AREA itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { tally, useAreaTally, clearAreaTallyCache, areaTallyCacheSize, AREA_TALLY_CACHE_MAX } from './biomeStats';
import { FakeQueueManager } from '../../../test/fakes';
import { resetQueueManagerForTests } from '../../../shared/engine';

vi.mock('../../../library/queue', async () => ({ QueueManager: (await import('../../../test/fakes')).FakeQueueManager }));

const qm = () => FakeQueueManager.latest();
const areas = () => qm().requests.filter((r) => r.kind === 'GET_AREA');
const PARAMS = { mcVersion: 35, seed: '8091867987493326313', startX: -258, startY: -230, widthX: 500, widthY: 500, dimension: 0, yHeight: 256 };
const IDS = new Int32Array([1, 1, 1, 4, 4, 7, 1, 4]);
const answer = (ids = IDS, index = -1) => act(async () => { qm().resolveRequest('GET_AREA', { ...PARAMS, ids, rgba: new Uint8ClampedArray(ids.length * 4) }, index); });

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearAreaTallyCache();
});

describe('tally', () => {
    it('counts each biome, most common first, with its share of every cell in percent', () => {
        expect(tally(IDS)).toEqual([
            { id: 1, count: 4, pct: 50 },
            { id: 4, count: 3, pct: 37.5 },
            { id: 7, count: 1, pct: 12.5 },
        ]);
    });

    it('breaks ties by id and the shares sum to 100', () => {
        const rows = tally(new Int32Array([9, 3, 9, 3, 5, 2]));
        expect(rows.map((r) => r.id)).toEqual([3, 9, 2, 5]);
        expect(rows.reduce((sum, r) => sum + r.pct, 0)).toBeCloseTo(100, 10);
        expect(typeof rows[0].pct).toBe('number');
    });

    it('works on plain arrays and gives [] for an empty area', () => {
        expect(tally([2, 2, 0])).toEqual([{ id: 2, count: 2, pct: (2 / 3) * 100 }, { id: 0, count: 1, pct: (1 / 3) * 100 }]);
        expect(tally(new Int32Array(0))).toEqual([]);
    });
});

describe('useAreaTally', () => {
    it('is loading, asks requestArea once with its own token, then gives the tally', async () => {
        const { result } = renderHook(() => useAreaTally(PARAMS));
        expect(result.current).toEqual({ tally: null, loading: true, error: null });
        expect(qm().requestArea).toHaveBeenCalledTimes(1);
        const [req] = areas();
        expect(req.data).toEqual(PARAMS);
        expect(req.opts.priority).toBe('low');
        expect(typeof req.opts.token).toBe('symbol');
        await answer();
        expect(result.current).toEqual({ tally: tally(IDS), loading: false, error: null });
    });

    it('a cached tally renders at once and posts nothing', async () => {
        const first = renderHook(() => useAreaTally(PARAMS));
        await answer();
        first.unmount();
        const { result } = renderHook(() => useAreaTally(PARAMS));
        expect(result.current).toEqual({ tally: tally(IDS), loading: false, error: null });
        expect(areas()).toHaveLength(1);
    });

    it('a param change cancels the previous request and ignores its late answer', async () => {
        const { result, rerender } = renderHook(({ params }) => useAreaTally(params), { initialProps: { params: PARAMS } });
        const token = areas()[0].opts.token;
        rerender({ params: { ...PARAMS, yHeight: 0 } });
        expect(qm().cancelToken).toHaveBeenCalledWith(token);
        expect(areas()).toHaveLength(2);
        expect(areas()[0].settled).toBe(true);                         // rejected as cancelled
        expect(result.current.loading).toBe(true);
        await answer(new Int32Array([174, 174, 1]));
        expect(result.current.tally.map((r) => r.id)).toEqual([174, 1]);
        // A reply that still comes for the first request (a real worker cannot stop mid-call) changes nothing.
        await act(async () => { areas()[0].resolve({ ...PARAMS, ids: IDS, error: null }); });
        expect(result.current.tally.map((r) => r.id)).toEqual([174, 1]);
        expect(result.current.error).toBeNull();
    });

    it('unmounting cancels the request in flight', () => {
        const { unmount } = renderHook(() => useAreaTally(PARAMS));
        const token = areas()[0].opts.token;
        unmount();
        expect(qm().cancelToken).toHaveBeenCalledWith(token);
        expect(areas()[0].settled).toBe(true);
    });

    it('enabled: false posts nothing and is not loading', () => {
        const { result } = renderHook(() => useAreaTally(PARAMS, { enabled: false }));
        expect(result.current).toEqual({ tally: null, loading: false, error: null });
        expect(qm().request).not.toHaveBeenCalled();
    });

    it('an unexpected rejection is an error of code "failed"; a killed pool is not', async () => {
        const { result } = renderHook(() => useAreaTally(PARAMS));
        await act(async () => { areas()[0].reject(new Error('worker crashed')); });
        expect(result.current).toEqual({ tally: null, loading: false, error: { code: 'failed', message: 'worker crashed' } });

        const other = renderHook(() => useAreaTally({ ...PARAMS, seed: '2' }));
        await act(async () => { qm().rejectAllRequests('killed'); });
        expect(other.result.current).toEqual({ tally: null, loading: true, error: null });
    });

    it('a reply carrying an engine error (a crashed worker) is an error, and is not cached', async () => {
        const first = renderHook(() => useAreaTally(PARAMS));
        await act(async () => { areas()[0].resolve({ ...PARAMS, error: { code: 'WORKER_CRASH', message: 'The engine stopped.' } }); });
        expect(first.result.current).toEqual({ tally: null, loading: false, error: { code: 'failed', message: 'The engine stopped.' } });
        first.unmount();
        renderHook(() => useAreaTally(PARAMS));
        expect(areas()).toHaveLength(2);
    });

    it('keeps at most 20 tallies, the oldest leaving first', async () => {
        expect(AREA_TALLY_CACHE_MAX).toBe(20);
        for (let i = 0; i < 22; i++) {
            const { unmount } = renderHook(() => useAreaTally({ ...PARAMS, seed: String(i) }));
            await answer();
            unmount();
        }
        expect(areaTallyCacheSize()).toBe(20);
        // seed '0' was evicted: asking again posts; seed '21' is still there.
        renderHook(() => useAreaTally({ ...PARAMS, seed: '21' }));
        expect(areas()).toHaveLength(22);
        renderHook(() => useAreaTally({ ...PARAMS, seed: '0' }));
        expect(areas()).toHaveLength(23);
    });
});
