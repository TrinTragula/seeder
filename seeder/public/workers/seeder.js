// Error codes returned by find_seeds (cubiomes-mods/api.c), with the message the UI shows.
const FIND_SEEDS_ERRORS = {
    '-1': 'This Minecraft version is not supported by the engine.',
    '-2': 'Unknown dimension.',
    '-3': 'One of the structures does not exist in this Minecraft version.',
    '-4': 'One of the structures does not generate in this dimension.',
    '-5': 'The range covers too many regions for one of the structures, or it is a chunk-scale feature that cannot be searched.',
    '-6': 'One of the biomes does not exist in this version or dimension.',
    '-7': 'Invalid search: the range must be 1-2048 blocks, with at most 32 biomes and 8 structures, at least one criterion and at least one result.',
    '-8': 'Not enough memory for a biome box this large: reduce the range.',
    '-9': 'End cities only generate more than 1008 blocks from the centre: increase the range.',
};

// Dashboard exports: shared constants and error messages.
const INT_MIN = -2147483648; // C's INT_MIN: "no value" for heights
const VARIANT_FIELDS = ['supported', 'abandoned', 'giant', 'underground', 'airpocket', 'basement', 'cracked', 'size', 'start',
    'biome', 'rotation', 'mirror', 'bx', 'by', 'bz', 'sx', 'sy', 'sz', 'endShip'];
const BIOME_CENTERS_ERRORS = {
    '-1': 'The biome locator does not support this Minecraft version.',
    '-2': 'The biome locator only works in the Overworld.',
    '-6': 'This biome does not exist in this version or dimension.',
    '-7': 'Invalid biome search: the radius must be at least 4 blocks.',
    '-8': 'Not enough memory for a radius this large: reduce the radius.',
};
const QUAD_HUTS_ERRORS = {
    '-3': 'This Minecraft version has no witch huts.',
};
const FORTRESS_ERRORS = {
    '-3': 'This Minecraft version has no Nether fortresses.',
};
const dashboardError = (messages, code) => ({ code, message: messages[code] ?? `Engine error ${code}.` });
// 64-bit seed for an int64_t parameter: decimal string or BigInt, wrapped like Java's long.
const toSeed = (seed) => BigInt.asIntN(64, BigInt(seed));
const COLOR_COUNT = 256;
const UNKNOWN_COLOR = [0, 0, 0, 255];

class Seeder {
    COLORS = [];

    constructor(module) {
        this.module = module;
        this.initWASM();
        this.initColors();
    }

    initWASM() {
        this.WASMgenerateArea = this.module.cwrap("generate_area", "array", ["number", "number", "number", "number", "number", "number", "number", "number"]);
        this.WASMfreeMemory = this.module.cwrap("free_memory");
        this.WASMgetColors = this.module.cwrap("get_colors");
        this.WASMfindSpawn = this.module.cwrap("find_spawn", "number", ["number", "number"]);
        this.WASMfindStrongholds = this.module.cwrap("find_strongholds", "array", ["number", "number", "number"]);
        this.WASMgetStructuresInRegions = this.module.cwrap("get_structure_in_regions", "array", ["number", "number", "number", "number"]);
        // Streaming multi-criteria search: hits and progress arrive as SEED_FOUND /
        // SEED_UPDATE messages posted from C while the call runs; the return value is
        // the number of candidates examined (or a negative FIND_SEEDS_ERRORS code).
        this.WASMfindSeeds = this.module.cwrap("find_seeds", "number", ["number", "number", "number", "array", "number", "array", "number", "number", "number", "number", "number"]);
        this.WASMsearchLastTested = this.module.cwrap("search_last_tested", "number", []);
        this.WASMsearchLastHits = this.module.cwrap("search_last_hits", "number", []);
        // Version-gating probes for the finder UI.
        this.WASMmcNewest = this.module.cwrap("mc_newest", "number", []);
        this.WASMbiomeExists = this.module.cwrap("biome_exists", "number", ["number", "number"]);
        this.WASMbiomeDimension = this.module.cwrap("biome_dimension", "number", ["number"]);
        this.WASMstructureInfo = this.module.cwrap("structure_info", "number", ["number", "number"]);
        this.WASMstructureRegionBlocks = this.module.cwrap("structure_region_blocks", "number", ["number", "number"]);
        this.WASMstructureMinDistance = this.module.cwrap("structure_min_distance", "number", ["number", "number"]);
        // Dashboard exports (seed page). Each returns a static buffer the methods below copy
        // out of the heap at once, or a plain int.
        this.WASMseedSummary = this.module.cwrap("seed_summary", "number", ["number", "number", "number", "number"]);
        this.WASMstrongholdsList = this.module.cwrap("strongholds_list", "number", ["number", "number", "number", "number"]);
        this.WASMstrongholdAnalyse = this.module.cwrap("stronghold_analyse", "number", ["number", "number", "number", "number"]);
        this.WASMnearestStructures = this.module.cwrap("nearest_structures", "number", ["number", "number", "number", "number", "number", "array", "number", "number"]);
        this.WASMstructureVariant = this.module.cwrap("structure_variant", "number", ["number", "number", "number", "number", "number", "number"]);
        this.WASMbiomeAt = this.module.cwrap("biome_at", "number", ["number", "number", "number", "number", "number", "number"]);
        this.WASMapproxHeight = this.module.cwrap("approx_height", "number", ["number", "number", "number", "number", "number"]);
        this.WASMslimeChunks = this.module.cwrap("slime_chunks", "number", ["number", "number", "number", "number", "number"]);
        this.WASMbiomeCenters = this.module.cwrap("biome_centers", "number", ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"]);
        this.WASMquadHuts = this.module.cwrap("quad_huts", "number", ["number", "number"]);
        this.WASMfortressSpawners = this.module.cwrap("fortress_spawners", "number", ["number", "number", "number", "number"]);
    }

    // get_colors returns cubiomes' static biomeColors[256][3]: one RGB triple per biome id.
    initColors() {
        const ptr = this.WASMgetColors();
        const raw = this.module.HEAPU8.subarray(ptr, ptr + COLOR_COUNT * 3);
        this.COLORS = [];
        for (let i = 0; i < COLOR_COUNT; i++) {
            this.COLORS.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], 255]);
        }
    }

    // Generate an area and return transferable, row-major buffers:
    //   rgba: Uint8ClampedArray(w*h*4) ready to wrap in an ImageData
    //   ids:  Int32Array(w*h) of raw biome ids for O(1) hover lookups
    // The WASM biome buffer is already row-major ([row*width + col]), so it is
    // consumed directly (no transpose).
    getArea(mcVersion, seed, x, z, areaWidth, areaHeight, dimension, yHeight) {
        seed = BigInt(seed);
        const res = this.WASMgenerateArea(mcVersion, seed, x, z, areaWidth, areaHeight, dimension, yHeight);
        const count = areaWidth * areaHeight;
        const biomes = this.module.HEAP32.subarray(res >> 2, (res >> 2) + count);
        const rgba = new Uint8ClampedArray(count * 4);
        const ids = new Int32Array(count);
        for (let idx = 0; idx < count; idx++) {
            const biomeId = biomes[idx];
            ids[idx] = biomeId;
            const c = this.COLORS[biomeId] ?? UNKNOWN_COLOR;
            const o = idx * 4;
            rgba[o] = c[0];
            rgba[o + 1] = c[1];
            rgba[o + 2] = c[2];
            rgba[o + 3] = c[3];
        }
        this.WASMfreeMemory();
        return { rgba, ids };
    }

    findSpawn(mcVersion, seed) {
        seed = BigInt(seed);
        const res = this.WASMfindSpawn(mcVersion, seed);
        return this.module.HEAP32.subarray(res >> 2, (res >> 2) + 2);
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

    getStructuresInRegions(mcVersion, structType, seed, regionsRange, dimension) {
        seed = BigInt(seed);
        const res = this.WASMgetStructuresInRegions(mcVersion, structType, seed, regionsRange, dimension);
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

    // Run one bounded search shard. Every biome in `biomes` AND every structure in
    // `structures` must occur within [-rangeBlocks, +rangeBlocks]^2 of the origin, in
    // `dimension`. Candidates are consumed from `startingSeed` (a decimal string or
    // BigInt: seeds are 64-bit) up to `maxSeedsToScan` or `maxResults` hits, whichever
    // comes first. Hits stream out as SEED_FOUND messages while this call runs; the
    // return value summarises the shard so the caller can tile the next one exactly.
    findSeeds({ mcVersion, dimension = 0, yHeight = 256, biomes = [], structures = [], rangeBlocks, startingSeed = '0', maxSeedsToScan, maxResults }) {
        const failure = (code, message) => ({ examined: 0, tested: 0, hits: 0, error: { code, message } });
        let start;
        try {
            start = BigInt(startingSeed);
        } catch (e) {
            // Never route a seed through Number: a malformed string is an argument error.
            return failure(-7, `Invalid starting seed "${startingSeed}".`);
        }
        const biomeArgs = new Uint8Array(new Int32Array(biomes).buffer);
        const structArgs = new Uint8Array(new Int32Array(structures).buffer);
        const examined = this.WASMfindSeeds(mcVersion, dimension, yHeight, biomeArgs, biomes.length, structArgs, structures.length,
            rangeBlocks, start, Number(maxSeedsToScan), maxResults);
        if (examined < 0) {
            return failure(examined, FIND_SEEDS_ERRORS[examined] ?? `Engine error ${examined}.`);
        }
        return { examined, tested: this.WASMsearchLastTested(), hits: this.WASMsearchLastHits(), error: null };
    }

    // What the engine supports on one version, for gating the finder's criteria and
    // presets: which of `biomeIds` exist, each biome's dimension, and per structure type
    // its dimension (-100 when the version has no such structure), region size in blocks
    // (< 64 marks a chunk-scale feature find_seeds refuses) and minimum distance from
    // the origin (End cities need 1008).
    getVersionSupport(mcVersion, biomeIds = [], structTypes = []) {
        const biomes = biomeIds.filter((id) => this.WASMbiomeExists(mcVersion, id) === 1);
        const biomeDimensions = {};
        for (const id of biomeIds) biomeDimensions[id] = this.WASMbiomeDimension(id);
        const structures = {}, regionBlocks = {}, minDistance = {};
        for (const type of structTypes) {
            structures[type] = this.WASMstructureInfo(mcVersion, type);
            regionBlocks[type] = this.WASMstructureRegionBlocks(mcVersion, type);
            minDistance[type] = this.WASMstructureMinDistance(mcVersion, type);
        }
        return { mcVersion, newest: this.WASMmcNewest(), biomes, biomeDimensions, structures, regionBlocks, minDistance };
    }
    // ---- Dashboard requests -------------------------------------------------------------
    // One method per message kind; worker.js adds requestId and error. Seeds are decimal
    // strings or BigInts (never Number); each method copies its ints out of the heap before
    // returning, so a later call cannot overwrite a result that is still being posted.

    ints(ptr, count) {
        return Array.from(this.module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + count));
    }

    // Overworld spawn (the origin in the Nether/End), the biome there at yHeight as the map
    // samples it, and the estimated surface Y (null where the engine cannot tell).
    seedSummary({ mcVersion, seed, dimension = 0, yHeight = 256 }) {
        const [spawnX, spawnZ, spawnBiome, height] = this.ints(this.WASMseedSummary(mcVersion, toSeed(seed), dimension, yHeight), 4);
        return { spawnX, spawnZ, spawnBiome, approxHeight: height === INT_MIN ? null : height };
    }

    // Strongholds in generation order (ring 0 first); `approx` skips the biome snapping on
    // 1.19.3+ (positions within ~112 blocks).
    strongholdsList({ mcVersion, seed, howMany, approx = false }) {
        const ptr = this.WASMstrongholdsList(mcVersion, toSeed(seed), howMany, approx ? 1 : 0);
        const count = this.module.HEAP32[ptr >> 2];
        const raw = this.ints(ptr + 4, count * 4);
        const strongholds = [];
        for (let i = 0; i < count; i++) {
            strongholds.push({ x: raw[i * 4], z: raw[i * 4 + 1], ring: raw[i * 4 + 2], index: raw[i * 4 + 3] });
        }
        return { strongholds };
    }

    // Portal-room eyes (-1 when unknown: before 1.13), libraries, portal room centre, piece count.
    strongholdAnalyse({ mcVersion, seed, x, z }) {
        const [eyes, libraries, portalX, portalZ, pieces] = this.ints(this.WASMstrongholdAnalyse(mcVersion, toSeed(seed), x, z), 5);
        return { eyes, libraries, portalX, portalZ, pieces };
    }

    // Closest viable instance per type to (x, z): found 1 / 0 (none within the radius) /
    // -1 (the type does not exist on this version or not in this dimension).
    nearestStructures({ mcVersion, seed, dimension = 0, x, z, types, maxRadiusBlocks }) {
        const list = types.slice(0, 32);
        const ptr = this.WASMnearestStructures(mcVersion, toSeed(seed), dimension, x, z,
            new Uint8Array(new Int32Array(list).buffer), list.length, maxRadiusBlocks);
        const raw = this.ints(ptr, list.length * 4);
        const results = [];
        for (let i = 0; i < list.length; i++) {
            results.push({ type: raw[i * 4], found: raw[i * 4 + 1], x: raw[i * 4 + 2], z: raw[i * 4 + 3] });
        }
        return { results };
    }

    structureVariant({ mcVersion, seed, dimension = 0, type, x, z }) {
        const raw = this.ints(this.WASMstructureVariant(mcVersion, toSeed(seed), dimension, type, x, z), VARIANT_FIELDS.length);
        const variant = {};
        VARIANT_FIELDS.forEach((field, i) => { variant[field] = raw[i]; });
        return { variant };
    }

    biomeAt({ mcVersion, seed, dimension = 0, x, y = 256, z }) {
        return { biome: this.WASMbiomeAt(mcVersion, toSeed(seed), dimension, x, y, z) };
    }

    approxHeight({ mcVersion, seed, dimension = 0, x, z }) {
        const height = this.WASMapproxHeight(mcVersion, toSeed(seed), dimension, x, z);
        return { height: height === INT_MIN ? null : height };
    }

    // cells[dz * w + dx] = 1 for a slime chunk at (cx0 + dx, cz0 + dz); all zero when w or h
    // is outside 1..64. `cells` is a fresh Uint8Array, so it can be transferred.
    slimeChunks({ seed, cx0, cz0, w, h }) {
        const cells = new Uint8Array(Math.max(0, w * h) || 0);
        const ptr = this.WASMslimeChunks(toSeed(seed), cx0, cz0, w, h);
        if (w >= 1 && h >= 1 && w <= 64 && h <= 64) cells.set(this.module.HEAPU8.subarray(ptr, ptr + w * h));
        return { cx0, cz0, w, h, cells };
    }

    // Patches of one biome within radiusBlocks (<= 2048) of (x, z), unsorted: centre in
    // blocks and size in 1:4 cells. Overworld only.
    biomeCenters({ mcVersion, seed, dimension = 0, biomeId, x, z, radiusBlocks, yHeight = 256, minSizeCells = 1, nmax = 64 }) {
        const ptr = this.WASMbiomeCenters(mcVersion, toSeed(seed), dimension, biomeId, x, z, radiusBlocks, yHeight, minSizeCells, nmax);
        const count = this.module.HEAP32[ptr >> 2];
        if (count < 0) return { centers: [], error: dashboardError(BIOME_CENTERS_ERRORS, count) };
        const raw = this.ints(ptr + 4, count * 3);
        const centers = [];
        for (let i = 0; i < count; i++) centers.push({ x: raw[i * 3], z: raw[i * 3 + 1], size: raw[i * 3 + 2] });
        return { centers };
    }

    // The quad witch farms within 16 regions of the origin: the centre of each four huts
    // that all generate and share one AFK spot.
    quadHuts({ mcVersion, seed }) {
        const ptr = this.WASMquadHuts(mcVersion, toSeed(seed));
        const count = this.module.HEAP32[ptr >> 2];
        if (count < 0) return { farms: [], error: dashboardError(QUAD_HUTS_ERRORS, count) };
        const raw = this.ints(ptr + 4, count * 2);
        const farms = [];
        for (let i = 0; i < count; i++) farms.push({ x: raw[2 * i], z: raw[2 * i + 1] });
        return { farms };
    }

    // Blaze spawners (bounding-box centres) and nether-wart rooms of the fortress that
    // starts in chunk (chunkX, chunkZ).
    fortressSpawners({ mcVersion, seed, chunkX, chunkZ }) {
        const ptr = this.WASMfortressSpawners(mcVersion, toSeed(seed), chunkX, chunkZ);
        const count = this.module.HEAP32[ptr >> 2];
        if (count < 0) return { spawners: [], wartRooms: 0, error: dashboardError(FORTRESS_ERRORS, count) };
        const wartRooms = this.module.HEAP32[(ptr >> 2) + 1];
        const raw = this.ints(ptr + 8, count * 3);
        const spawners = [];
        for (let i = 0; i < count; i++) spawners.push({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] });
        return { spawners, wartRooms };
    }
}
