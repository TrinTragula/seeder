importScripts('api.js');
importScripts('seeder.js');

Module['onRuntimeInitialized'] = loadDone;

function loadDone() {
    self.seeder = new Seeder(Module);
    self.addEventListener('message', listener);
    self.postMessage({
        kind: "DONE_LOADING"
    });
}

function listener(e) {
    if (e.data.kind == "GET_AREA") {
        var { mcVersion, seed, startX, startY, widthX, widthY } = e.data.data;
        self.postMessage({
            kind: "DONE_GET_AREA",
            data: {
                seed, startX, startY, widthX, widthY,
                colors: self.seeder.getAreaColors(mcVersion, seed, startX, startY, widthX, widthY)
            }
        });
    // }
    // else if (e.data.kind == "GET_BIOMES") {
    //     var { mcVersion, biomes, x, z, widthX, widthZ, startingSeed } = e.data.data;
    //     self.postMessage({
    //         kind: "DONE_GET_BIOMES",
    //         data: {
    //             seed: self.seeder.findBiomes(mcVersion, biomes, x, z, widthX, widthZ, startingSeed)
    //         }
    //     });
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
    // else if (e.data.kind == "FIND_STRUCTURES") {
    //     var { mcVersion, structType, x, z, range, startingSeed } = e.data.data;
    //     const seed = self.seeder.findStructures(mcVersion, structType, x, z, range, startingSeed);
    //     self.postMessage({
    //         kind: "DONE_FIND_STRUCTURES",
    //         data: { seed }
    //     });
    // } else if (e.data.kind == "GET_BIOMES_WITH_STRUCTURES") {
    //     var { mcVersion, structType, biomes, x, z, range, startingSeed } = e.data.data;
    //     self.postMessage({
    //         kind: "DONE_GET_BIOMES_WITH_STRUCTURES",
    //         data: {
    //             seed: self.seeder.findBiomesWithStructures(mcVersion, structType, biomes, x, z, range, startingSeed)
    //         }
    //     });
    // } else if (e.data.kind == "GET_STRUCTURES_IN_REGIONS"){
    //     var { mcVersion, structType, seed, regionsRange } = e.data.data;
    //     const coords = self.seeder.getStructuresInRegions(mcVersion, structType, seed, regionsRange);
    //     self.postMessage({
    //         kind: "DONE_GET_STRUCTURES_IN_REGIONS",
    //         data: { coords }
    //     });
    // }
    else if (e.data.kind == "GET_COLORS"){
        self.postMessage({
            kind: "DONE_GET_COLORS",
            data: { colors: self.seeder.COLORS }
        });
    }
}