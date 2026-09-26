import { useCallback, useEffect, useRef, useState } from 'react';
import { maxSeedsToScanFor } from './criteria';
import { toHitView } from './hitModel';

// At most one progress update per this many ms: the coordinator reports up to ~10
// times a second per worker, and the stats bar only needs to look alive.
export const PROGRESS_THROTTLE_MS = 250;

/*
 * One finder search at a time over the pool's coordinator (queue.findSeeds).
 *
 * useFinderSearch(queue) -> {
 *   status:   'idle' | 'searching' | 'done',
 *   hits:     HitView[] (toHitView), in the order they were found,
 *   progress: { examined: BigInt, tested, hits, elapsedMs } | null  (throttled),
 *   result:   { reason, examined: BigInt, tested, resumeSeed: BigInt, elapsedMs, error, target } | null,
 *   criteria: the running (or last) search's criteria, as the form gave them,
 *   start(criteria), stop(), reset(),
 * }
 * `result.resumeSeed` is the coordinator's cursor: the first candidate never dealt,
 * where "Find more" continues without repeating a seed.
 *
 * start() is ignored while a search runs; it hands the coordinator the form's criteria
 * with startingSeed as a BigInt, the count and maxSeedsToScanFor(criteria). A run ends
 * at `count` hits (50 at most), so hits are appended one by one, unbatched. stop() ends
 * it as 'stopped' (instantly: the shard workers are terminated). reset() goes back to
 * 'idle' with nothing found: a running search is stopped and its late callbacks are
 * ignored. Unmounting stops a running search. The hook never touches the URL.
 */
export function useFinderSearch(queue) {
    const [status, setStatus] = useState('idle');
    const [hits, setHits] = useState([]);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [criteria, setCriteria] = useState(null);

    // The live search's handle ({ id, stop }) and which run the callbacks belong to:
    // a late callback from an older run must never touch the new one's state.
    const handle = useRef(null);
    const run = useRef(0);
    // Throttle: the newest progress not yet shown, and the timer that will show it.
    const pending = useRef(null);
    const timer = useRef(null);

    const clearTimer = () => {
        clearTimeout(timer.current);
        timer.current = null;
    };

    const start = useCallback((next) => {
        if (handle.current) return;
        const mine = ++run.current;
        const current = () => mine === run.current;
        clearTimer();
        pending.current = null;
        setCriteria(next);
        setHits([]);
        setProgress(null);
        setResult(null);
        setStatus('searching');

        const target = next.count;
        let ended = false;
        const onHit = (hit) => {
            if (current()) setHits((list) => [...list, toHitView(hit, next)]);
        };
        const onProgress = (p) => {
            if (!current()) return;
            pending.current = p;
            if (timer.current) return;
            timer.current = setTimeout(() => {
                timer.current = null;
                if (current() && pending.current) setProgress(pending.current);
                pending.current = null;
            }, PROGRESS_THROTTLE_MS);
        };
        const onDone = (found, examined, reason, resumeSeed, extra = {}) => {
            if (!current()) return;
            ended = true;
            handle.current = null;
            clearTimer();
            // Flush the newest values; the hit count is the final one.
            const last = pending.current;
            pending.current = null;
            setProgress((shown) => ({ ...(last ?? shown ?? { examined, tested: extra.tested ?? 0, elapsedMs: extra.elapsedMs ?? 0 }), hits: found.length }));
            setResult({
                reason, examined, resumeSeed, target,
                tested: extra.tested ?? 0, elapsedMs: extra.elapsedMs ?? 0, error: extra.error ?? null,
            });
            setStatus('done');
        };

        const searching = {
            mcVersion: next.mcVersion,
            dimension: next.dimension,
            yHeight: next.yHeight,
            biomes: next.biomes,
            anyBiomes: next.anyBiomes ?? [],
            excludeBiomes: next.excludeBiomes ?? [],
            structures: next.structures,
            rangeBlocks: next.rangeBlocks,
            startingSeed: BigInt(next.startingSeed ?? 0),
            count: next.count,
            maxSeedsToScan: maxSeedsToScanFor(next),
        };
        // findSeeds reports an empty space asynchronously and hits arrive from worker
        // messages, so onDone cannot have run yet; `ended` guards it all the same.
        const h = queue.findSeeds(searching, { onHit, onProgress, onDone });
        if (!ended) handle.current = h;
    }, [queue]);

    const stop = useCallback(() => {
        if (handle.current) queue.stopSearch();
    }, [queue]);

    const reset = useCallback(() => {
        run.current += 1;
        clearTimer();
        pending.current = null;
        if (handle.current) {
            const h = handle.current;
            handle.current = null;
            h.stop();
        }
        setCriteria(null);
        setHits([]);
        setProgress(null);
        setResult(null);
        setStatus('idle');
    }, []);

    // Leaving the page (or a test unmounting it) ends the run and its timer.
    useEffect(() => () => {
        run.current += 1;
        clearTimer();
        if (handle.current) {
            const h = handle.current;
            handle.current = null;
            h.stop();
        }
    }, []);

    return { status, hits, progress, result, criteria, start, stop, reset };
}

export default useFinderSearch;
