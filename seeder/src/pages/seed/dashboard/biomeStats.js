import { useEffect, useRef, useState } from 'react';
import { useQueueManager } from '../../../shared/hooks/useQueueManager';

/*
 * How much of an area each biome covers: [{ id, count, pct }], most common first (ties by
 * id), pct = share of ALL the cells in percent, so the shares sum to 100 over the whole
 * list. `ids` is GET_AREA's row-major Int32Array (the same ids the map paints, hence the
 * same colours as the legend). An empty area has no biomes: [].
 */
export function tally(ids) {
    const total = ids.length;
    if (total === 0) return [];
    const counts = new Map();
    for (let i = 0; i < total; i++) counts.set(ids[i], (counts.get(ids[i]) ?? 0) + 1);
    return [...counts]
        .map(([id, count]) => ({ id, count, pct: (count / total) * 100 }))
        .sort((a, b) => b.count - a.count || a.id - b.id);
}

/*
 * Tallies, never the arrays: a 500×500 area is 2 MB of typed arrays (ids + rgba), while
 * its tally is a few dozen rows. Keyed by JSON.stringify(params), insertion-ordered, the
 * oldest entry leaves first.
 */
export const AREA_TALLY_CACHE_MAX = 20;
const cache = new Map();

function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > AREA_TALLY_CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Tests share one module graph: start every case from an empty cache.
export function clearAreaTallyCache() {
    cache.clear();
}

// For tests: how many tallies are kept.
export function areaTallyCacheSize() {
    return cache.size;
}

const IDLE = { tally: null, error: null, loading: false };
const LOADING = { tally: null, error: null, loading: true };
const cached = (key) => ({ tally: cache.get(key), error: null, loading: false });

/*
 * The biome tally of one GET_AREA, for the Biomes section. Not
 * useSeedQuery: that cache keeps whole replies (200 of them), and a reply here is 2 MB.
 *
 * `params` = GET_AREA's { mcVersion, seed (decimal string), startX, startY, widthX,
 * widthY, dimension, yHeight }, asked through queue.requestArea (low priority, behind the
 * map's tiles). Returns { tally, loading, error }:
 *   - resolved                      -> tally = tally(ids); the arrays are dropped at once;
 *   - rejected with `{ cancelled }` -> ignored (stale params, unmount, pool torn down);
 *   - any other rejection           -> error = { code: 'failed', message }.
 * One Symbol token per hook instance: a param change or an unmount cancels this hook's
 * request, and a `live` flag drops a late answer. `enabled: false` asks nothing and is not
 * loading (a cached tally is still returned).
 */
export function useAreaTally(params, { enabled = true } = {}) {
    const queue = useQueueManager();
    const key = JSON.stringify(params);
    const [token] = useState(() => Symbol('useAreaTally'));
    const latest = useRef(params);
    latest.current = params;
    const [state, setState] = useState(() => ({ key, ...(cache.has(key) ? cached(key) : LOADING) }));

    useEffect(() => {
        if (!enabled) return undefined;
        if (cache.has(key)) {
            setState({ key, ...cached(key) });
            return undefined;
        }
        let live = true;
        setState({ key, ...LOADING });
        queue.requestArea(latest.current, { token }).then(({ ids, error }) => {
            if (error || !ids) {
                if (live) setState({ key, tally: null, error: { code: 'failed', message: error?.message ?? 'No biome data.' }, loading: false });
                return;
            }
            const result = tally(ids);
            remember(key, result);
            if (live) setState({ key, tally: result, error: null, loading: false });
        }, (reason) => {
            if (reason?.cancelled || !live) return;
            const message = reason?.message ?? String(reason);
            setState({ key, tally: null, error: { code: 'failed', message }, loading: false });
        });
        return () => {
            live = false;
            queue.cancelToken(token);
        };
    }, [queue, key, enabled, token]);

    let view;
    if (!enabled) view = cache.has(key) ? cached(key) : IDLE;
    else if (state.key === key) view = state;
    else view = cache.has(key) ? cached(key) : LOADING;
    return { tally: view.tally, error: view.error, loading: view.loading };
}
