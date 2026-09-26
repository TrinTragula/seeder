// Cache-bust the whole worker chain from the ?v= this worker was loaded with:
// a query on api.js alone would not propagate to the loader's api.wasm fetch.
const CACHE_BUST = new URLSearchParams(self.location.search).get('v');
const withV = (path) => CACHE_BUST ? path + '?v=' + CACHE_BUST : path;

// Boot is deferred until the pool sends an INIT message. INIT may carry a
// precompiled WebAssembly.Module shared across the whole pool, so the ~800KB
// module is compiled ONCE (on the main thread) instead of once per worker -
// a big cold-start win. If no module is supplied, we fall back to letting
// Emscripten fetch + compile api.wasm itself (via locateFile).
self.addEventListener('message', bootListener);

function bootListener(e) {
    if (!e.data || e.data.kind !== 'INIT') return;
    self.removeEventListener('message', bootListener);
    self.Module = { locateFile: withV, onAbort: bootFailed };
    if (e.data.module) {
        self.Module.instantiateWasm = (imports, receiveInstance) => {
            WebAssembly.instantiate(e.data.module, imports).then((instance) => receiveInstance(instance)).catch(bootFailed);
            return {}; // async path: exports delivered via the callback
        };
    }
    importScripts(withV('api.js'));
    importScripts(withV('seeder.js'));
    Module['onRuntimeInitialized'] = loadDone;
}

// A boot that fails inside a promise (instantiating the shared module, or the loader's own
// fetch + compile when INIT carried none, which ends in abort()) is only an unhandled
// rejection, and the pool never hears of it: the worker would stay booting forever.
// Rethrown from a task it is an uncaught error, so the Worker's 'error' event fires and the
// pool counts a boot crash. Once loaded, an abort is a trap thrown by the call (see reply()).
function bootFailed(reason) {
    if (self.seeder) return;
    setTimeout(() => { throw reason instanceof Error ? reason : new Error(`The engine failed to load: ${reason}`); });
}

function loadDone() {
    self.seeder = new Seeder(Module);
    self.addEventListener('message', listener);
    self.postMessage({
        kind: "DONE_LOADING"
    });
}

// Dashboard requests (seed page): message kind -> Seeder method. Each reply is
// DONE_<kind> { requestId, ...result, error } with requestId echoed verbatim so the pool
// can match replies to requests; error is null or { code, message }, and a request the
// engine cannot even parse (e.g. a malformed seed) still gets its reply. A trap gets none
// (see reply()).
const DASHBOARD_REQUESTS = {
    SEED_SUMMARY: 'seedSummary',
    STRONGHOLDS_LIST: 'strongholdsList',
    STRONGHOLD_ANALYSE: 'strongholdAnalyse',
    NEAREST_STRUCTURES: 'nearestStructures',
    STRUCTURE_VARIANT: 'structureVariant',
    BIOME_AT: 'biomeAt',
    APPROX_HEIGHT: 'approxHeight',
    SLIME_CHUNKS: 'slimeChunks',
    BIOME_CENTERS: 'biomeCenters',
    QUAD_HUTS: 'quadHuts',
    FORTRESS_SPAWNERS: 'fortressSpawners',
};

function dashboardRequest(kind, data) {
    let result;
    try {
        result = { error: null, ...self.seeder[DASHBOARD_REQUESTS[kind]](data) };
    } catch (err) {
        if (err instanceof WebAssembly.RuntimeError) throw err;
        result = { error: { code: -7, message: `Invalid ${kind} request: ${err && err.message ? err.message : err}` } };
    }
    const transfer = result.cells ? [result.cells.buffer] : [];
    self.postMessage({ kind: 'DONE_' + kind, data: { requestId: data.requestId, ...result } }, transfer);
}

// The map and search requests. `run` returns [data, transfer?]; when it throws, the reply
// is DONE_<kind> { ...echo, error: { code, message } } instead, so the pool is never left
// waiting. A trap inside the WASM (WebAssembly.RuntimeError: abort, out-of-bounds access)
// may leave the instance unusable, so it gets no reply: it escapes the listener, the
// Worker's 'error' event fires, and the pool replaces the worker and deals the job again
// (QueueManager._onWorkerCrash). A reply first would free the worker, and the crash would
// then be blamed on whatever job the pool handed it next.
function reply(kind, echo, run) {
    let data, transfer;
    try {
        [data, transfer = []] = run();
    } catch (err) {
        if (err instanceof WebAssembly.RuntimeError) throw err;
        self.postMessage({
            kind: 'DONE_' + kind,
            data: { ...echo, error: { code: -7, message: `${kind} failed: ${err && err.message ? err.message : err}` } }
        });
        return;
    }
    self.postMessage({ kind: 'DONE_' + kind, data }, transfer);
}

function listener(e) {
    const kind = e.data.kind;
    const data = e.data.data || {};
    if (Object.prototype.hasOwnProperty.call(DASHBOARD_REQUESTS, kind)) {
        dashboardRequest(kind, data);
    }
    else if (kind == "GET_AREA") {
        const { mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight } = data;
        const echo = { mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight };
        reply(kind, echo, () => {
            const { rgba, ids } = self.seeder.getArea(mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight);
            return [{ ...echo, rgba, ids }, [rgba.buffer, ids.buffer]];
        });
    }
    else if (kind == "GET_SPAWN") {
        const { mcVersion, seed } = data;
        reply(kind, {}, () => {
            const [x, z] = self.seeder.findSpawn(mcVersion, seed);
            return [{ x, z }];
        });
    }
    else if (kind == "GET_STRONGHOLDS") {
        const { mcVersion, seed, howMany } = data;
        reply(kind, {}, () => [{ coords: self.seeder.findStrongholds(mcVersion, seed, howMany) }]);
    }
    else if (kind == "FIND_SEEDS") {
        // One search shard. SEED_UPDATE / SEED_FOUND messages are posted straight
        // from the C loop (see api.c) while findSeeds runs; this is the terminal reply.
        const { shardId, ...criteria } = data;
        reply(kind, { shardId, examined: 0, tested: 0, hits: 0 }, () => [{ shardId, ...self.seeder.findSeeds(criteria) }]);
    }
    else if (kind == "GET_VERSION_SUPPORT") {
        const { mcVersion, biomeIds, structTypes } = data;
        reply(kind, { mcVersion }, () => [self.seeder.getVersionSupport(mcVersion, biomeIds, structTypes)]);
    }
    else if (kind == "GET_STRUCTURES_IN_REGIONS") {
        const { mcVersion, structType, seed, regionsRange, dimension } = data;
        reply(kind, {}, () => [{ coords: self.seeder.getStructuresInRegions(mcVersion, structType, seed, regionsRange, dimension) }]);
    }
    else if (kind == "GET_COLORS") {
        reply(kind, {}, () => [{ colors: self.seeder.COLORS }]);
    }
}
