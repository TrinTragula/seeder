import { useEffect, useRef, useState } from 'react';
import { versionLabelOf } from '../../shared/seedUrl';
import { toHitView } from './hitModel';

/*
 * Seeds mode: a "Share these results" URL lists seeds that a search already
 * found. They are described again without searching, one seed at a time, low priority:
 *   SEED_SUMMARY { mcVersion, seed, dimension: 0, yHeight }: the Overworld spawn, which
 *     is the spawn the search coordinator reports in every dimension;
 *   NEAREST_STRUCTURES around the origin, only with structure criteria.
 *
 * useSeedsMode(queue, { seeds, criteria }) -> {
 *   status:   'idle' | 'loading' | 'done',
 *   views:    HitView[], appended one by one as they land,
 *   progress: { done, total, failed }   failed = seeds whose SEED_SUMMARY errored,
 * }
 * With no seeds it is idle and asks nothing. A change of seeds (or of the criteria)
 * cancels the requests in flight (one token per run) and starts over; so does
 * unmounting. An engine error on a seed gives a view at (0, 0) with a `warning`.
 */

// The engine's radius is a circle (api.c nearestOf) and the search box a square
// [-range, range]²: ask the circle around the square, then keep only what is inside
// the box, so a structure in a corner of the box counts.
export const nearestRadiusFor = (rangeBlocks) => Math.ceil(rangeBlocks * Math.SQRT2);
const inBox = (x, z, range) => Math.abs(x) <= range && Math.abs(z) <= range;

export const seedWarning = (mcVersion) => `The engine could not describe this seed on ${versionLabelOf(mcVersion)}.`;

const IDLE = { status: 'idle', views: [], progress: { done: 0, total: 0, failed: 0 } };

export function useSeedsMode(queue, { seeds, criteria }) {
    const [state, setState] = useState(IDLE);
    const key = seeds?.length ? seeds.join(',') : '';
    const { mcVersion, dimension, yHeight, rangeBlocks } = criteria;
    const structuresKey = criteria.structures.join(',');
    // The effect keys on the values; the lists themselves are read from here.
    const latest = useRef({ seeds, criteria });
    latest.current = { seeds, criteria };

    useEffect(() => {
        if (!key) {
            setState(IDLE);
            return undefined;
        }
        const list = latest.current.seeds;
        const { structures } = latest.current.criteria;
        const world = { mcVersion, dimension, yHeight, structures, rangeBlocks };
        const token = Symbol('seeds-mode');
        let live = true;
        const opts = { priority: 'low', token };
        setState({ status: 'loading', views: [], progress: { done: 0, total: list.length, failed: 0 } });

        const describe = async (seed, index) => {
            const summary = await queue.request('SEED_SUMMARY', { mcVersion, seed, dimension: 0, yHeight }, opts);
            if (summary.error) {
                return { failed: true, view: { ...toHitView({ seed, spawnX: 0, spawnZ: 0, structures: [], index }, world), warning: seedWarning(mcVersion) } };
            }
            const hit = { seed, spawnX: summary.spawnX, spawnZ: summary.spawnZ, structures: [], index };
            if (structures.length > 0) {
                const near = await queue.request('NEAREST_STRUCTURES', {
                    mcVersion, seed, dimension, x: 0, z: 0, types: structures, maxRadiusBlocks: nearestRadiusFor(rangeBlocks),
                }, opts);
                if (near.error) return { failed: false, view: { ...toHitView(hit, world), warning: seedWarning(mcVersion) } };
                hit.structures = structures.map((type) => {
                    const r = near.results?.find((res) => res.type === type);
                    return r?.found === 1 && inBox(r.x, r.z, rangeBlocks)
                        ? { type, x: r.x, z: r.z }
                        : { type, x: null, z: null, verified: false };
                });
            }
            return { failed: false, view: toHitView(hit, world) };
        };

        (async () => {
            for (const [index, seed] of list.entries()) {
                let result;
                try {
                    result = await describe(seed, index);
                } catch (_) {
                    // Cancelled (this run is over) or the pool was torn down.
                    if (!live) return;
                    result = { failed: true, view: { ...toHitView({ seed, spawnX: 0, spawnZ: 0, structures: [], index }, world), warning: seedWarning(mcVersion) } };
                }
                if (!live) return;
                setState((s) => ({
                    ...s,
                    views: [...s.views, result.view],
                    progress: { ...s.progress, done: s.progress.done + 1, failed: s.progress.failed + (result.failed ? 1 : 0) },
                }));
            }
            if (live) setState((s) => ({ ...s, status: 'done' }));
        })();

        return () => {
            live = false;
            queue.cancelToken(token);
        };
    }, [queue, key, mcVersion, dimension, yHeight, rangeBlocks, structuresKey]);

    return state;
}

export default useSeedsMode;
