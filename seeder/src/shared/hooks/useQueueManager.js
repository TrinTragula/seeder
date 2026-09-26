import { getQueueManager } from '../engine';

// The document's worker pool, from any component. No effect and no state: the pool
// is a singleton (see engine.js), so reading it during render is already stable.
export function useQueueManager(options) {
    return getQueueManager(options);
}

export default useQueueManager;
