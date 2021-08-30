class Seeder {
    COLORS = [];

    constructor(module) {
        this.module = module;
        this.initWASM();
        this.initColors();
    }

    initWASM() {
        this.WASMgenerateFromSeed = this.module.cwrap("generate_from_seed", "number", ["number", "number", "number", "number"]);
        this.WASMgenerateArea = this.module.cwrap("generate_area", "array", ["number", "number", "number", "number", "number", "number"]);
        this.WASMfreeMemory = this.module.cwrap("free_memory");
        this.WASMgetColors = this.module.cwrap("get_colors");
        this.WASMfindBiomes = this.module.cwrap("find_biomes", "number", ["number", "array", "number", "number", "number", "number", "number", "number"]);
        this.WASMfreeArea = this.module.cwrap("free_area");
        this.WASMfindSpawn = this.module.cwrap("find_spawn", "number", ["number", "number"]);
        this.WASMfindStrongholds = this.module.cwrap("find_strongholds", "array", ["number", "number", "number"]);
        this.WASMfindStructures = this.module.cwrap("find_structures", "number", ["number", "number", "number", "number", "number", "number"]);
        this.WASMfindBiomesWithStructures = this.module.cwrap("find_biomes_with_structure", "number", ["number", "number", "array", "number", "number", "number", "number", "number"]);
        this.WASMgetStructuresInRegions = this.module.cwrap("get_structure_in_regions", "array", ["number", "number", "number"]);
    }

    initColors() {
        const rescolors = this.WASMgetColors();
        const rawColors = this.module.HEAPU8.subarray(rescolors, rescolors + (365 * 3));
        this.COLORS = [];
        let temp = [];
        for (let i = 0; i < rawColors.length; i++) {
            if ((i % 3) === 0) {
                if (temp.length > 0) {
                    this.COLORS.push([...temp, 255]);
                }
                temp = [];
            }
            temp.push(rawColors[i]);
        }
    }

    // Get the colors array
    getAreaColors(mcVersion, seed, x, z, areaWidth, areaHeight) {
        seed = BigInt(seed);
        const res = this.WASMgenerateArea(mcVersion, seed, x, z, areaWidth, areaHeight);
        const biomes = this.module.HEAP32.subarray(res >> 2, (res >> 2) + (areaWidth * areaHeight));
        this.WASMfreeMemory();
        const colors = [];
        for (let j = 0; j < areaWidth; j++) {
            for (let i = 0; i < areaHeight; i++) {
                const biomeId = biomes[(i * areaWidth) + j];
                colors.push(this.COLORS[biomeId]);
            }
        }
        return colors;
    }

    findBiomes(mcVersion, biomes, x, z, widthX, widthZ, startingSeed) {
        const input = new Uint8Array(new Int32Array(biomes).buffer)
        const result = this.WASMfindBiomes(mcVersion, input, biomes.length, x, z, widthX, widthZ, startingSeed);
        this.WASMfreeArea();
        return result;
    }

    findSpawn(mcVersion, seed) {
        seed = BigInt(seed);
        const res = this.WASMfindSpawn(mcVersion, seed);
        return Module.HEAP32.subarray(res >> 2, (res >> 2) + 2);
    }

    findStrongholds(mcVersion, seed, howMany) {
        seed = BigInt(seed);
        const res = this.WASMfindStrongholds(mcVersion, seed, howMany);
        const rawCoords = this.module.HEAP32.subarray(res >> 2, (res >> 2) + (howMany * 2));
        const coords = rawCoords.reduce((p, c, i, a) => {
            if (i % 2 == 0) {
                const pos = a.slice(i, i + 2);
                if (pos[0] !== -1 && pos[1] !== -1) {
                    p.push(a.slice(i, i + 2))
                }
            }
            return p;
        }, []);
        return coords;
    }

    findStructures(mcVersion, structType, x, z, range, startingSeed) {
        const res = this.WASMfindStructures(mcVersion, structType, x, z, range, startingSeed);
        return res;
    }

    findBiomesWithStructures(mcVersion, structType, biomes, x, z, range, startingSeed) {
        const input = new Uint8Array(new Int32Array(biomes).buffer)
        const result = this.WASMfindBiomesWithStructures(mcVersion, structType, input, biomes.length, x, z, range, startingSeed);
        this.WASMfreeArea();
        return result;
    }

    getStructuresInRegions(mcVersion, structType, seed, regionsRange) {
        seed = BigInt(seed);
        const res = this.WASMgetStructuresInRegions(mcVersion, structType, seed, regionsRange);
        const rawCoords = this.module.HEAP32.subarray(res >> 2, (res >> 2) + (regionsRange * regionsRange * 2 * 4));
        const coords = rawCoords.reduce((p, c, i, a) => {
            if (i % 2 == 0) {
                const pos = a.slice(i, i + 2);
                if (pos[0] !== -1 && pos[1] !== -1) {
                    p.push(a.slice(i, i + 2))
                }
            }
            return p;
        }, []);
        return coords;
    }
}