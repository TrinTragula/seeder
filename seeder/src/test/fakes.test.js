// The request doubles on FakeQueueManager: dashboard tests drive their
// sections through them, so they must behave like QueueManager.request/cancelToken.
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeQueueManager } from './fakes';

let qm;
beforeEach(() => {
    FakeQueueManager.reset();
    qm = new FakeQueueManager('/workers/worker.js', 2);
});

describe('FakeQueueManager request doubles', () => {
    it('request records the call and resolveRequest settles it with error: null merged in', async () => {
        const p = qm.request('SEED_SUMMARY', { mcVersion: 35, seed: '1' }, { priority: 'high', token: 't' });
        expect(qm.request).toHaveBeenCalledWith('SEED_SUMMARY', { mcVersion: 35, seed: '1' }, { priority: 'high', token: 't' });
        expect(qm.requests).toEqual([expect.objectContaining({ id: 1, kind: 'SEED_SUMMARY', data: { mcVersion: 35, seed: '1' }, opts: { priority: 'high', token: 't' }, settled: false })]);
        qm.resolveRequest('SEED_SUMMARY', { spawnX: -32, spawnZ: 80 });
        await expect(p).resolves.toEqual({ spawnX: -32, spawnZ: 80, error: null });
        expect(qm.requests[0].settled).toBe(true);
    });

    it('resolveRequest passes an engine error through and picks the last pending entry unless given an index', async () => {
        const first = qm.request('BIOME_CENTERS', { radiusBlocks: 1000 });
        const second = qm.request('BIOME_CENTERS', { radiusBlocks: 2000 });
        const error = { code: -8, message: 'heap' };
        expect(qm.resolveRequest('BIOME_CENTERS', { error }).data).toEqual({ radiusBlocks: 2000 });
        await expect(second).resolves.toEqual({ error });
        qm.resolveRequest('BIOME_CENTERS', { centers: [] }, 0);
        await expect(first).resolves.toEqual({ centers: [], error: null });
        expect(() => qm.resolveRequest('BIOME_CENTERS')).toThrow(/no pending BIOME_CENTERS/);
    });

    it('cancelToken rejects the matching pending requests only and records the token', async () => {
        const token = Symbol('seed 1');
        const mine = qm.request('SEED_SUMMARY', {}, { token });
        const other = qm.request('SEED_SUMMARY', {}, { token: 'seed 2' });
        qm.cancelToken(token);
        await expect(mine).rejects.toEqual({ cancelled: true, reason: 'cancelled' });
        expect(qm.cancelledTokens).toEqual([token]);
        expect(qm.pendingOf('SEED_SUMMARY')).toHaveLength(1);
        qm.resolveRequest('SEED_SUMMARY', { spawnX: 0 });
        await expect(other).resolves.toEqual({ spawnX: 0, error: null });
    });

    it('pendingOf shrinks as requests settle', async () => {
        const a = qm.request('BIOME_AT', { x: 0 });
        const b = qm.request('BIOME_AT', { x: 1 });
        qm.request('SLIME_CHUNKS', {});
        expect(qm.pendingOf('BIOME_AT')).toHaveLength(2);
        qm.resolveRequest('BIOME_AT', { biome: 1 });
        expect(qm.pendingOf('BIOME_AT').map((r) => r.data)).toEqual([{ x: 0 }]);
        qm.resolveRequest('BIOME_AT', { biome: 2 });
        expect(qm.pendingOf('BIOME_AT')).toEqual([]);
        expect(qm.pendingOf('SLIME_CHUNKS')).toHaveLength(1);
        await expect(Promise.all([a, b])).resolves.toEqual([{ biome: 2, error: null }, { biome: 1, error: null }]);
        qm.rejectAllRequests('cancelled');
        expect(qm.pendingOf('SLIME_CHUNKS')).toEqual([]);
        await expect(qm.request.mock.results[2].value).rejects.toEqual({ cancelled: true, reason: 'cancelled' });
    });

    it('killAll and restartAll reject every pending request with reason killed', async () => {
        const a = qm.request('SEED_SUMMARY', {});
        qm.killAll();
        await expect(a).rejects.toEqual({ cancelled: true, reason: 'killed' });
        const b = qm.request('SEED_SUMMARY', {});
        qm.restartAll();
        await expect(b).rejects.toEqual({ cancelled: true, reason: 'killed' });
        expect(qm.pendingRequests()).toEqual([]);
    });
});
