// Cache-bust the whole worker chain from the ?v= this worker was loaded with:
// a query on api.js alone would not propagate to the loader's api.wasm fetch.
const CACHE_BUST = new URLSearchParams(self.location.search).get('v');
const withV = (path) => CACHE_BUST ? path + '?v=' + CACHE_BUST : path;

// Boot is deferred until the pool sends an INIT message. INIT may carry a
// precompiled WebAssembly.Module shared across the whole pool, so the ~800KB
// module is compiled ONCE (on the main thread) instead of once per worker —
// a big cold-start win. If no module is supplied, we fall back to letting
// Emscripten fetch + compile api.wasm itself (via locateFile).
self.addEventListener('message', bootListener);

function bootListener(e) {
    if (!e.data || e.data.kind !== 'INIT') return;
    self.removeEventListener('message', bootListener);
    self.Module = { locateFile: withV };
    if (e.data.module) {
        self.Module.instantiateWasm = (imports, receiveInstance) => {
            WebAssembly.instantiate(e.data.module, imports).then((instance) => receiveInstance(instance));
            return {}; // async path: exports delivered via the callback
        };
    }
    importScripts(withV('api.js'));
    importScripts(withV('seeder.js'));
    Module['onRuntimeInitialized'] = loadDone;
}

function loadDone() {
    self.seeder = new Seeder(Module);
    self.addEventListener('message', listener);
    self.postMessage({
        kind: "DONE_LOADING"
    });
}

function listener(e) {
    if (e.data.kind == "GET_AREA") {
        var { mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight } = e.data.data;
        const { rgba, ids } = self.seeder.getArea(mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight);
        self.postMessage({
            kind: "DONE_GET_AREA",
            data: {
                mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight,
                rgba, ids
            }
        }, [rgba.buffer, ids.buffer]);
    }
    else if (e.data.kind == "GET_BIOMES") {
        var { mcVersion, biomes, x, z, widthX, widthZ, startingSeed, dimension, yHeight } = e.data.data;
        self.postMessage({
            kind: "DONE_GET_BIOMES",
            data: {
                seed: self.seeder.findBiomes(mcVersion, biomes, x, z, widthX, widthZ, startingSeed, dimension, yHeight)
            }
        });
    }
    else if (e.data.kind == "GET_SPAWN") {
        var { mcVersion, seed } = e.data.data;
        const [x, z] = self.seeder.findSpawn(mcVersion, seed);
        self.postMessage({
            kind: "DONE_GET_SPAWN",
            data: { x, z }
        });
    }
    else if (e.data.kind == "GET_STRONGHOLDS") {
        var { mcVersion, seed, howMany } = e.data.data;
        const coords = self.seeder.findStrongholds(mcVersion, seed, howMany);
        self.postMessage({
            kind: "DONE_GET_STRONGHOLDS",
            data: { coords }
        });
    }
    else if (e.data.kind == "FIND_STRUCTURES") {
        var { mcVersion, structType, x, z, range, startingSeed, dimension } = e.data.data;
        const seed = self.seeder.findStructures(mcVersion, structType, x, z, range, startingSeed, dimension);
        self.postMessage({
            kind: "DONE_FIND_STRUCTURES",
            data: { seed }
        });
    }
    else if (e.data.kind == "GET_BIOMES_WITH_STRUCTURES") {
        var { mcVersion, structType, biomes, x, z, range, startingSeed, dimension, yHeight } = e.data.data;
        self.postMessage({
            kind: "DONE_GET_BIOMES_WITH_STRUCTURES",
            data: {
                seed: self.seeder.findBiomesWithStructures(mcVersion, structType, biomes, x, z, range, startingSeed, dimension, yHeight)
            }
        });
    }
    else if (e.data.kind == "GET_STRUCTURES_IN_REGIONS") {
        var { mcVersion, structType, seed, regionsRange, dimension } = e.data.data;
        const coords = self.seeder.getStructuresInRegions(mcVersion, structType, seed, regionsRange, dimension);
        self.postMessage({
            kind: "DONE_GET_STRUCTURES_IN_REGIONS",
            data: { coords }
        });
    }
    else if (e.data.kind == "GET_COLORS") {
        self.postMessage({
            kind: "DONE_GET_COLORS",
            data: { colors: self.seeder.COLORS }
        });
    }
}