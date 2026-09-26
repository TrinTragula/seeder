import { QueueManager } from '../library/queue';
import { WORKER_PATH } from '../util/site';

/*
 * One worker pool per document. A module-level singleton, not a useState
 * initializer: StrictMode runs initializers twice in development (two pools,
 * twice the WASM). Each page is its own document, so "per module" is "per document".
 *
 * `workers` is honoured only by the call that creates the pool; the finder and the
 * seed page never share a document, so they never disagree about it.
 */
let instance = null;

export function getQueueManager({ workers } = {}) {
    if (!instance) instance = new QueueManager(WORKER_PATH, workers);
    return instance;
}

// Tests mount many pages in one module graph: kill the pool and start over.
export function resetQueueManagerForTests() {
    instance?.killAll();
    instance = null;
}
