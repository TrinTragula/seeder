// The per-document worker pool singleton. The real QueueManager is replaced by the
// recording fake so no worker is spawned.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getQueueManager, resetQueueManagerForTests } from './engine';
import { FakeQueueManager } from '../test/fakes';
import { WORKER_PATH } from '../util/site';

vi.mock('../library/queue', async () => ({ QueueManager: (await import('../test/fakes')).FakeQueueManager }));

beforeEach(() => {
    resetQueueManagerForTests();
    FakeQueueManager.reset();
});

describe('getQueueManager', () => {
    it('spawns one pool from the versioned worker path and hands the same one back every time', () => {
        const first = getQueueManager();
        const second = getQueueManager();
        expect(second).toBe(first);
        expect(FakeQueueManager.instances).toHaveLength(1);
        expect(first.path).toBe(WORKER_PATH);
        expect(first.path).toMatch(/^\/workers\/worker\.js\?v=\d+\.\d+\.\d+$/);
    });

    it('honours the workers option only for the call that creates the pool', () => {
        expect(getQueueManager({ workers: 2 }).numberOfWorkers).toBe(2);
        expect(getQueueManager({ workers: 7 }).numberOfWorkers).toBe(2);
        expect(getQueueManager().numberOfWorkers).toBe(2);
        expect(FakeQueueManager.instances).toHaveLength(1);
    });
});

describe('resetQueueManagerForTests', () => {
    it('kills the pool and lets the next call start a fresh one', () => {
        const first = getQueueManager();
        resetQueueManagerForTests();
        expect(first.killAll).toHaveBeenCalledTimes(1);
        const second = getQueueManager();
        expect(second).not.toBe(first);
        expect(FakeQueueManager.instances).toHaveLength(2);
    });

    it('is harmless when no pool exists yet', () => {
        expect(() => resetQueueManagerForTests()).not.toThrow();
        expect(FakeQueueManager.instances).toHaveLength(0);
    });
});
