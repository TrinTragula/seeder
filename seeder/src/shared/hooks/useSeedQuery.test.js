import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSeedQuery, clearSeedQueryCache, SEED_QUERY_CACHE_MAX } from './useSeedQuery';
import { FakeQueueManager } from '../../test/fakes';
import { resetQueueManagerForTests } from '../engine';

vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));

const qm = () => FakeQueueManager.latest();
const flush = () => act(async () => { await Promise.resolve(); });
const SEED = '8091867987493326313';
const params = (over = {}) => ({ mcVersion: 35, seed: SEED, dimension: 0, yHeight: 256, ...over });
const query = (kind, p, opts) => renderHook((props) => useSeedQuery(props.kind, props.params, props.opts), {
    initialProps: { kind, params: p, opts },
});

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
    clearSeedQueryCache();
});

describe('useSeedQuery', () => {
    it('is loading until the engine answers, then holds the reply', async () => {
        const { result } = query('SEED_SUMMARY', params());
        expect(result.current).toMatchObject({ data: null, error: null, loading: true });
        expect(qm().request).toHaveBeenCalledTimes(1);
        const [kind, data, opts] = qm().request.mock.calls[0];
        expect(kind).toBe('SEED_SUMMARY');
        expect(data).toEqual(params());
        expect(opts.priority).toBe('low');
        expect(typeof opts.token).toBe('symbol');

        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: -32, spawnZ: 80 }); });
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.data).toMatchObject({ spawnX: -32, spawnZ: 80, error: null });
    });

    it('passes the priority through', () => {
        query('STRONGHOLDS_LIST', params(), { priority: 'high' });
        expect(qm().request.mock.calls[0][2].priority).toBe('high');
    });

    it('an engine error is the error state, with no data', async () => {
        const { result } = query('BIOME_CENTERS', params({ dimension: -1 }));
        await act(async () => { qm().resolveRequest('BIOME_CENTERS', { error: { code: -2, message: 'Overworld only' } }); });
        expect(result.current).toMatchObject({ data: null, loading: false, error: { code: -2, message: 'Overworld only' } });
    });

    it('answers a cached query at once, without a new request (engine errors included)', async () => {
        const first = query('SEED_SUMMARY', params());
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: 1 }); });
        const errored = query('BIOME_CENTERS', params());
        await act(async () => { qm().resolveRequest('BIOME_CENTERS', { error: { code: -8, message: 'heap' } }); });
        first.unmount();
        errored.unmount();
        qm().request.mockClear();

        const again = query('SEED_SUMMARY', params());
        expect(again.result.current).toMatchObject({ loading: false, data: { spawnX: 1 } });
        const errorAgain = query('BIOME_CENTERS', params());
        expect(errorAgain.result.current).toMatchObject({ loading: false, data: null, error: { code: -8 } });
        await flush();
        expect(qm().request).not.toHaveBeenCalled();
    });

    it('a worker crash is shown but not cached: the next mount asks again', async () => {
        const first = query('SEED_SUMMARY', params());
        const crash = { error: { code: 'WORKER_CRASH', message: 'The engine worker crashed.' } };
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', crash); });
        expect(first.result.current).toMatchObject({ data: null, loading: false, error: crash.error });
        first.unmount();
        qm().request.mockClear();

        const again = query('SEED_SUMMARY', params());
        expect(again.result.current.loading).toBe(true);
        expect(qm().request).toHaveBeenCalledTimes(1);
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: 1, error: null }); });
        expect(again.result.current).toMatchObject({ loading: false, error: null, data: { spawnX: 1 } });
    });

    it('a param change cancels this instance\'s token and ignores the stale answer', async () => {
        const { result, rerender } = query('SEED_SUMMARY', params({ seed: '1' }));
        const stale = qm().pendingOf('SEED_SUMMARY')[0];
        const token = stale.opts.token;

        rerender({ kind: 'SEED_SUMMARY', params: params({ seed: '2' }) });
        expect(qm().cancelledTokens).toEqual([token]);
        expect(stale.settled).toBe(true);                     // rejected by cancelToken
        expect(result.current).toMatchObject({ loading: true, data: null });
        const fresh = qm().pendingOf('SEED_SUMMARY');
        expect(fresh).toHaveLength(1);
        expect(fresh[0].data.seed).toBe('2');
        expect(fresh[0].opts.token).toBe(token);              // one token per hook instance

        // A late reply for the old seed must not land (the real pool drops it; the guard holds anyway).
        await act(async () => { stale.resolve({ spawnX: 111, error: null }); });
        expect(result.current).toMatchObject({ loading: true, data: null });
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: 222 }); });
        expect(result.current.data).toMatchObject({ spawnX: 222 });
    });

    it('two instances asking the same question do not cancel each other', async () => {
        const a = query('SEED_SUMMARY', params());
        const b = query('SEED_SUMMARY', params());
        const [ta, tb] = qm().pendingOf('SEED_SUMMARY').map((r) => r.opts.token);
        expect(ta).not.toBe(tb);
        a.unmount();
        expect(qm().cancelledTokens).toEqual([ta]);
        expect(qm().pendingOf('SEED_SUMMARY')).toHaveLength(1);
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: 5 }); });
        expect(b.result.current.data).toMatchObject({ spawnX: 5 });
    });

    it('unmounting cancels the in-flight request', () => {
        const { unmount } = query('STRONGHOLDS_LIST', params());
        const entry = qm().pendingOf('STRONGHOLDS_LIST')[0];
        unmount();
        expect(qm().cancelledTokens).toEqual([entry.opts.token]);
        expect(entry.settled).toBe(true);
    });

    it('enabled: false requests nothing and is not loading', async () => {
        const { result, rerender } = query('SEED_SUMMARY', params(), { enabled: false });
        await flush();
        expect(qm().request).not.toHaveBeenCalled();
        expect(result.current).toMatchObject({ data: null, error: null, loading: false });
        rerender({ kind: 'SEED_SUMMARY', params: params(), opts: { enabled: true } });
        expect(qm().request).toHaveBeenCalledTimes(1);
        expect(result.current.loading).toBe(true);
    });

    it('refetch drops the cached answer and asks again', async () => {
        const { result } = query('SEED_SUMMARY', params());
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: 1 }); });
        act(() => { result.current.refetch(); });
        expect(qm().request).toHaveBeenCalledTimes(2);
        expect(result.current).toMatchObject({ loading: true, data: null });
        await act(async () => { qm().resolveRequest('SEED_SUMMARY', { spawnX: 2 }); });
        expect(result.current.data).toMatchObject({ spawnX: 2 });
    });

    it('a cancelled rejection leaves the state untouched', async () => {
        const { result } = query('SEED_SUMMARY', params());
        await act(async () => { qm().rejectAllRequests('killed'); });
        expect(result.current).toMatchObject({ loading: true, data: null, error: null });
    });

    it('an unexpected rejection is the error state "failed"', async () => {
        const { result } = query('SEED_SUMMARY', params());
        await act(async () => { qm().pendingOf('SEED_SUMMARY')[0].reject(new Error('worker crashed')); });
        expect(result.current).toMatchObject({ loading: false, data: null, error: { code: 'failed', message: 'worker crashed' } });
    });

    it('keeps at most 200 answers, evicting the oldest', async () => {
        expect(SEED_QUERY_CACHE_MAX).toBe(200);
        for (let i = 0; i <= SEED_QUERY_CACHE_MAX; i++) {
            const { unmount } = query('BIOME_AT', params({ x: i }));
            await act(async () => { qm().resolveRequest('BIOME_AT', { biome: i }); });
            unmount();
        }
        qm().request.mockClear();
        // The newest 200 are still cached…
        const newest = query('BIOME_AT', params({ x: SEED_QUERY_CACHE_MAX }));
        expect(newest.result.current).toMatchObject({ loading: false, data: { biome: SEED_QUERY_CACHE_MAX } });
        const second = query('BIOME_AT', params({ x: 1 }));
        expect(second.result.current.loading).toBe(false);
        expect(qm().request).not.toHaveBeenCalled();
        // …the very first one was evicted.
        const oldest = query('BIOME_AT', params({ x: 0 }));
        expect(oldest.result.current.loading).toBe(true);
        expect(qm().request).toHaveBeenCalledTimes(1);
    });

    it('posts seeds as the decimal strings it was given, never as numbers', () => {
        query('SEED_SUMMARY', params({ seed: '-9223372036854775808' }));
        const posted = qm().request.mock.calls[0][1];
        expect(posted.seed).toBe('-9223372036854775808');
        expect(typeof posted.seed).toBe('string');
    });
});
