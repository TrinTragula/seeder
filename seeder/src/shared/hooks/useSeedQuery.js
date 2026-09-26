import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueueManager } from './useQueueManager';

/*
 * Settled engine answers, keyed by JSON.stringify([kind, params]). Engine errors are
 * cached too: every query is deterministic for its world, so asking again would only
 * give the same error. A WORKER_CRASH reply (queue.js) is not: it says nothing about the
 * world, and the next mount asks again. Insertion-ordered, the oldest entry leaves first.
 */
export const SEED_QUERY_CACHE_MAX = 200;
const cache = new Map();

function remember(key, result) {
    cache.delete(key);
    cache.set(key, result);
    while (cache.size > SEED_QUERY_CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Tests share one module graph: start every case from an empty cache.
export function clearSeedQueryCache() {
    cache.clear();
}

const IDLE = { data: null, error: null, loading: false };
const settledState = (result) => (result?.error
    ? { data: null, error: result.error, loading: false }
    : { data: result, error: null, loading: false });
const LOADING = { data: null, error: null, loading: true };

/*
 * One engine query for a dashboard section, over QueueManager.request.
 *
 * `params` must be JSON-serialisable - seeds as decimal strings, never BigInt - since
 * the cache key is JSON.stringify([kind, params]). Returns { data, loading, error,
 * refetch }:
 *   - resolved with `error: null`      -> data = the reply (minus requestId), error null;
 *   - resolved with `error: {code, …}` -> error = the engine's { code, message }, data null
 *                                         (an answer about the world, rendered by the section);
 *   - rejected with `{ cancelled }`    -> ignored: the answer is stale or the pool is gone;
 *   - any other rejection              -> error = { code: 'failed', message }.
 * `enabled: false` requests nothing and is not loading. A param change or an unmount
 * cancels this hook's in-flight request: the token is one Symbol per hook instance,
 * never the key, because two sections may ask the same question and cancelling one
 * must not reject the other. `refetch()` drops the cached answer and asks again.
 * Long kinds (STRONGHOLDS_LIST 128, BIOME_CENTERS) must stay at the default 'low'
 * priority so the map's tiles keep a worker.
 */
export function useSeedQuery(kind, params, { enabled = true, priority = 'low' } = {}) {
    const queue = useQueueManager();
    const key = JSON.stringify([kind, params]);
    const [token] = useState(() => Symbol(`useSeedQuery ${kind}`));
    // The latest params for the effect, which is keyed on their serialised form.
    const latest = useRef(params);
    latest.current = params;
    // Bumped by refetch() to run the request effect again for the same key.
    const [attempt, setAttempt] = useState(0);
    // What this instance last learned, and for which key: a render for a new key
    // must never show the previous key's data.
    const [state, setState] = useState(() => ({ key, attempt, ...(cache.has(key) ? settledState(cache.get(key)) : LOADING) }));

    useEffect(() => {
        if (!enabled) return undefined;
        if (cache.has(key)) {
            setState({ key, attempt, ...settledState(cache.get(key)) });
            return undefined;
        }
        let live = true;
        setState({ key, attempt, ...LOADING });
        queue.request(kind, latest.current, { priority, token }).then((result) => {
            if (result?.error?.code !== 'WORKER_CRASH') remember(key, result);
            if (live) setState({ key, attempt, ...settledState(result) });
        }, (reason) => {
            if (reason?.cancelled || !live) return;
            const message = reason?.message ?? String(reason);
            setState({ key, attempt, data: null, error: { code: 'failed', message }, loading: false });
        });
        return () => {
            live = false;
            queue.cancelToken(token);
        };
    }, [queue, kind, key, enabled, priority, token, attempt]);

    const refetch = useCallback(() => {
        cache.delete(key);
        setAttempt((n) => n + 1);
    }, [key]);

    let view;
    if (!enabled) view = cache.has(key) ? settledState(cache.get(key)) : IDLE;
    else if (state.key === key && state.attempt === attempt) view = state;
    else view = cache.has(key) ? settledState(cache.get(key)) : LOADING;
    return { data: view.data, error: view.error, loading: view.loading, refetch };
}

export default useSeedQuery;
