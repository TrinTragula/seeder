import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { nearestRadiusFor, seedWarning, useSeedsMode } from './useSeedsMode';
import { DEFAULT_CRITERIA } from './criteria';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { FakeQueueManager } from '../../test/fakes';

const structure = (pureText) => STRUCTURES_OPTIONS.find((s) => s.pureText === pureText).value;
const VILLAGE = structure('Village');
const MANSION = structure('Mansion');
const BIG = '8091867987493326313';

const criteria = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE, MANSION], rangeBlocks: 300, yHeight: 64 };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

let qm;
beforeEach(() => {
    FakeQueueManager.reset();
    qm = new FakeQueueManager('/workers/worker.js', 4);
});

const mount = (props) => renderHook((p) => useSeedsMode(qm, p), { initialProps: props });
const answer = async (kind, result) => { await act(async () => { qm.resolveRequest(kind, result); }); await flush(); };
const summary = (spawnX = -32, spawnZ = 80) => ({ spawnX, spawnZ, spawnBiome: 1, approxHeight: 70 });

describe('useSeedsMode', () => {
    it('is idle and asks nothing without seeds', () => {
        for (const seeds of [null, []]) {
            const { result } = mount({ seeds, criteria });
            expect(result.current).toEqual({ status: 'idle', views: [], progress: { done: 0, total: 0, failed: 0 } });
        }
        expect(qm.requests).toHaveLength(0);
    });

    it('describes the seeds one at a time: the next SEED_SUMMARY only after the previous seed\'s answers', async () => {
        const { result } = mount({ seeds: [BIG, '-5'], criteria });
        await flush();
        expect(result.current.status).toBe('loading');
        expect(result.current.progress).toEqual({ done: 0, total: 2, failed: 0 });
        expect(qm.requests.map((r) => r.kind)).toEqual(['SEED_SUMMARY']);
        const [first] = qm.requests;
        // The Overworld spawn, whatever the criteria's dimension; low priority, a token.
        expect(first.data).toEqual({ mcVersion: VERSIONS['26.3'], seed: BIG, dimension: 0, yHeight: 64 });
        expect(first.opts.priority).toBe('low');
        expect(typeof first.opts.token).toBe('symbol');

        await answer('SEED_SUMMARY', summary());
        expect(qm.requests.map((r) => r.kind)).toEqual(['SEED_SUMMARY', 'NEAREST_STRUCTURES']);
        await answer('NEAREST_STRUCTURES', { results: [{ type: VILLAGE, found: 1, x: 96, z: -80 }, { type: MANSION, found: 1, x: 250, z: -290 }] });
        expect(result.current.views).toHaveLength(1);
        expect(result.current.progress).toEqual({ done: 1, total: 2, failed: 0 });
        expect(qm.requests.map((r) => r.data.seed)).toEqual([BIG, BIG, '-5']);

        await answer('SEED_SUMMARY', summary(8, -8));
        await answer('NEAREST_STRUCTURES', { results: [{ type: VILLAGE, found: 1, x: 16, z: 16 }, { type: MANSION, found: 0, x: 0, z: 0 }] });
        expect(result.current.status).toBe('done');
        expect(result.current.progress).toEqual({ done: 2, total: 2, failed: 0 });
        expect(result.current.views.map((v) => v.seed)).toEqual([BIG, '-5']);
        expect(result.current.views[0]).toMatchObject({ spawn: { x: -32, z: 80 }, mcVersion: VERSIONS['26.3'], dimension: 0, yHeight: 64, index: 0 });
    });

    it('asks NEAREST_STRUCTURES around the origin with the criteria\'s dimension, types and a radius covering the box', async () => {
        mount({ seeds: ['1'], criteria: { ...criteria, dimension: -1, structures: [structure('Fortress')], rangeBlocks: 500 } });
        await flush();
        expect(qm.requests[0].data.dimension).toBe(0);
        await answer('SEED_SUMMARY', summary());
        const [near] = qm.pendingOf('NEAREST_STRUCTURES');
        expect(near.data).toEqual({
            mcVersion: VERSIONS['26.3'], seed: '1', dimension: -1, x: 0, z: 0, types: [structure('Fortress')], maxRadiusBlocks: 708,
        });
        expect(nearestRadiusFor(300)).toBe(425);
        expect(near.opts.priority).toBe('low');
    });

    it('found 0, found −1 and a structure outside the box become unverified rows; a corner of the box counts', async () => {
        const { result } = mount({ seeds: ['1'], criteria: { ...criteria, structures: [VILLAGE, MANSION, structure('Igloo'), structure('Monument')] } });
        await flush();
        await answer('SEED_SUMMARY', summary());
        await answer('NEAREST_STRUCTURES', {
            results: [
                { type: VILLAGE, found: 1, x: 290, z: -295 },            // in a corner: 413 blocks away, inside the box
                { type: MANSION, found: 0, x: 0, z: 0 },
                { type: structure('Igloo'), found: -1, x: 0, z: 0 },
                { type: structure('Monument'), found: 1, x: 20, z: 320 }, // inside the circle, outside the box
            ],
        });
        const rows = result.current.views[0].structures;
        expect(rows.map((s) => [s.type, s.x, s.z, s.verified])).toEqual([
            [VILLAGE, 290, -295, true],
            [MANSION, null, null, false],
            [structure('Igloo'), null, null, false],
            [structure('Monument'), null, null, false],
        ]);
    });

    it('a biome-only share asks SEED_SUMMARY alone', async () => {
        const { result } = mount({ seeds: ['1', '2'], criteria: { ...criteria, structures: [], biomes: [1] } });
        await flush();
        await answer('SEED_SUMMARY', summary());
        await answer('SEED_SUMMARY', summary(4, 4));
        expect(qm.requests.map((r) => r.kind)).toEqual(['SEED_SUMMARY', 'SEED_SUMMARY']);
        expect(result.current.status).toBe('done');
        expect(result.current.views.map((v) => v.structures)).toEqual([[], []]);
    });

    it('an engine error gives a view at (0, 0) with a warning, counted as failed, and moves on', async () => {
        const { result } = mount({ seeds: ['1', '2'], criteria });
        await flush();
        await answer('SEED_SUMMARY', { error: { code: -1, message: 'version' } });
        expect(qm.pendingOf('NEAREST_STRUCTURES')).toHaveLength(0);
        expect(result.current.views[0]).toMatchObject({ seed: '1', spawn: { x: 0, z: 0 }, structures: [], warning: seedWarning(VERSIONS['26.3']) });
        expect(seedWarning(VERSIONS['26.3'])).toBe('The engine could not describe this seed on 26.3.');
        expect(result.current.progress.failed).toBe(1);
        // A NEAREST_STRUCTURES error keeps the spawn, warns, and is not a summary failure.
        await answer('SEED_SUMMARY', summary(8, 8));
        await answer('NEAREST_STRUCTURES', { error: { code: -7, message: 'arguments' } });
        expect(result.current.views[1]).toMatchObject({ spawn: { x: 8, z: 8 }, warning: seedWarning(VERSIONS['26.3']) });
        expect(result.current.progress).toEqual({ done: 2, total: 2, failed: 1 });
        expect(result.current.status).toBe('done');
    });

    it('a change of seeds cancels the token in flight and starts over', async () => {
        const { result, rerender } = mount({ seeds: ['1', '2'], criteria });
        await flush();
        const oldToken = qm.requests[0].opts.token;
        rerender({ seeds: ['7'], criteria });
        await flush();
        expect(qm.cancelledTokens).toContain(oldToken);
        expect(qm.requests[0].settled).toBe(true);
        const [fresh] = qm.pendingOf('SEED_SUMMARY');
        expect(fresh.data.seed).toBe('7');
        expect(fresh.opts.token).not.toBe(oldToken);
        expect(result.current.progress).toEqual({ done: 0, total: 1, failed: 0 });
        await answer('SEED_SUMMARY', summary());
        await answer('NEAREST_STRUCTURES', { results: [] });
        expect(result.current.views.map((v) => v.seed)).toEqual(['7']);
        // No request for the old list ever came after the cancel.
        expect(qm.requests.filter((r) => r.data.seed === '2')).toHaveLength(0);
        // Back to no seeds: idle again.
        rerender({ seeds: null, criteria });
        await flush();
        expect(result.current.status).toBe('idle');
    });

    it('unmounting cancels, and a late answer changes nothing', async () => {
        const { result, unmount } = mount({ seeds: ['1'], criteria });
        await flush();
        const [entry] = qm.requests;
        unmount();
        expect(qm.cancelledTokens).toEqual([entry.opts.token]);
        expect(entry.settled).toBe(true);
        expect(result.current.views).toEqual([]);
        expect(qm.requests).toHaveLength(1);
    });
});
