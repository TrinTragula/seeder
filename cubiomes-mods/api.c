// Seeder's C API on top of cubiomes, compiled to WebAssembly (see ../GUIDE.MD §4).
// Every export is called from seeder/public/workers/seeder.js through cwrap. Results
// travel back as return values or through static buffers the JS reads from HEAP32;
// the streaming search posts messages straight from C via the EM_JS callbacks.
#include "emscripten.h"
#include <emscripten/heap.h>
#include "../cubiomes/finders.h"
#include "../cubiomes/generator.h"
#include "../cubiomes/quadbase.h"
#include "../cubiomes/util.h"
#include "../cubiomes/features/end_city.h"
#include "../cubiomes/features/fortress.h"
#include "../cubiomes/features/stronghold.h"
#include <limits.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Emscripten's dlmalloc exports mallinfo() but the sysroot ships musl's malloc.h,
// which does not declare it. This mirrors system/include/compat/malloc.h, whose
// comment pins the layout to system/lib/dlmalloc.c. Only keepcost is read here.
struct mallinfo
{
    size_t arena, ordblks, smblks, hblks, hblkhd, usmblks, fsmblks, uordblks, fordblks, keepcost;
};
extern struct mallinfo mallinfo(void);

#define MAX_STRUCTS 8
#define MAX_BIOMES 32
#define MAX_ATTEMPTS 256          // regions per type intersecting the box (range<=2048, regionSize>=20 -> <=196)
#define MAX_RANGE_BLOCKS 2048     // biome cache (2*512 cells)^2 ints = 4 MB; do not raise without ALLOW_MEMORY_GROWTH
#define PROGRESS_INTERVAL_MS 100  // SEED_UPDATE at most ~10/s per worker, however cheap the path
#define PROGRESS_CLOCK_EVERY 16   // candidates between clock reads on the cheap paths (a layered check is microseconds)
#define UPPER16_MAX 65536
#define UPPER16_MAX_WITH_BIOMES 256
// checkForBiomes() on the noise generators (1.18+ Overworld, Nether, End) mallocs one
// 16-byte sample tuple per cell on top of the biome cache we hand it.
#define NOISE_TUPLE_BYTES 16
// Headroom left for cubiomes' own small allocations while a search runs.
#define HEAP_SLACK (256 * 1024)

// Dashboard exports (seed page). Every result lives in a static buffer: the wasm stack is
// 1 MB and a failed malloc aborts the worker, so nothing here is sized on the fly.
#define PIECE_BUF 512              // stronghold (~400 pieces), fortress (~400), End city (END_CITY_PIECES_MAX 421)
#define MAX_STRONGHOLDS 128
#define MAX_NEAREST_TYPES 32
#define MAX_NEAREST_RADIUS 8192    // blocks
#define CHUNK_SCALE_RADIUS 1024    // 64 chunks: the reach for chunk-scale features (Treasure, Geode, End Gateway...)
#define VARIANT_INTS 19
#define SLIME_MAX 64
#define MAX_CENTERS 64
#define MAX_CENTER_RADIUS 2048     // blocks
#define CENTER_TOLERANCE 4         // cells of another biome a patch may bridge (getBiomeCenters' tol)
// getBiomeCenters mallocs one int per cell for the ids and, per patch, a flood-fill queue
// of one {i, j, d} entry per cell - 16 bytes per cell of the box on top of any cache.
#define CENTER_BYTES_PER_CELL (sizeof(int) + 3 * sizeof(int))
#define MAX_QUADS 64
#define QUAD_HUT_RADIUS 16         // regions around the origin quad_huts scans
#define MAX_SPAWNERS 64

enum { ERR_VERSION = -1, ERR_DIMENSION = -2, ERR_STRUCT_UNSUPPORTED = -3, ERR_STRUCT_DIMENSION = -4, ERR_TOO_MANY_REGIONS = -5,
       ERR_BIOME_UNSUPPORTED = -6, ERR_ARGS = -7, ERR_NOMEM = -8, ERR_MIN_DISTANCE = -9 };

// One requested structure type, resolved against the version and the search box.
typedef struct
{
    int uiType, type;        // type as the UI names it / as cubiomes computes it (Ruined_Portal -> Ruined_Portal_N in the Nether)
    StructureConfig sc;
    int r0, r1;              // region index range intersecting the box, on both axes
    int n;                   // attempts of the current lower-48 family that fall inside the box
    Pos at[MAX_ATTEMPTS];
    int order[MAX_ATTEMPTS]; // indices into at[], closest to the origin first
    int chosen;              // index into order[] of the viable attempt reported for the hit
} StructPlan;

int *biomeIds;

// single-threaded worker: shared Generator kept off the wasm stack
// (sizeof(Generator) ~27KB, default emscripten stack is only 64KB)
Generator g;

// Search state. Globals, not locals: StructPlan[8] alone is ~24 KB and the wasm stack is 1 MB.
static StructPlan plans[MAX_STRUCTS];
static int hitBuf[3 * MAX_STRUCTS];
static double g_lastTested, g_lastHits;
static double g_lastProgress; // emscripten_get_now() of the last SEED_UPDATE

// The world the dashboard exports last applied to g (see useWorld). Every other export
// that touches g calls forgetWorld() first.
static int g_worldValid, g_worldMc, g_worldDim;
static uint64_t g_worldSeed;

int main()
{
}

static void forgetWorld(void)
{
    g_worldValid = 0;
}

// Generate a scale-4 (1:4 cells) biome area in `dimension` (-1 Nether, 0 Overworld, 1 End)
// at height yHeight; the result is row-major, freed by free_memory().
EMSCRIPTEN_KEEPALIVE
int *generate_area(int mcVersion, int64_t seed, int areaX, int areaZ, int areaWidth, int areaHeight, int dimension, int yHeight)
{
    forgetWorld();
    setupGenerator(&g, mcVersion, 0);
    Range r = {4, areaX, areaZ, areaWidth, areaHeight, yHeight / 4, 1};
    // applySeed first: allocCache sizes the buffer from g->dim, and setupGenerator leaves
    // it DIM_UNDEF - the layer-stack generators (up to 1.17) then got a cache 6-13x too
    // small and genBiomes wrote past it.
    applySeed(&g, dimension, seed); // -1 Nether, 0 Overworld, 1 End
    free(biomeIds);
    biomeIds = allocCache(&g, r);
    genBiomes(&g, biomeIds, r);
    return biomeIds;
}

EMSCRIPTEN_KEEPALIVE
void free_memory()
{
    free(biomeIds);
    biomeIds = NULL;
}

EMSCRIPTEN_KEEPALIVE
unsigned char *get_colors()
{
    static unsigned char biomeColors[256][3];
    initBiomeColors(biomeColors);
    return &(biomeColors[0][0]);
}

// ---------------------------------------------------------------------------
// Streaming search callbacks. The glue is not MODULARIZE'd, so HEAP32 is the
// script-scope view of the wasm memory. EM_JS bodies are stringified, so they
// must not contain line comments.
// ---------------------------------------------------------------------------

EM_JS(void, call_seed_update, (double examined, double tested), {
    self.postMessage({ kind: "SEED_UPDATE", data: { examined: examined, tested: tested } });
});

EM_JS(void, call_seed_found, (int64_t seed, int spawnX, int spawnZ, int *structs, int nStructs, double examined, double tested), {
    /* Copy the ints out: posting a HEAP32 subarray would structured-clone the whole heap. */
    var o = structs >> 2, raw = HEAP32.subarray(o, o + nStructs * 3), structures = [];
    for (var i = 0; i < nStructs; i++) structures.push({ type: raw[i * 3], x: raw[i * 3 + 1], z: raw[i * 3 + 2] });
    self.postMessage({ kind: "SEED_FOUND", data: { seed: seed, spawnX: spawnX, spawnZ: spawnZ, structures: structures, examined: examined, tested: tested } });
});

// ---------------------------------------------------------------------------
// Version-gating probes for the finder UI
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int mc_newest(void)
{
    return MC_NEWEST;
}

EMSCRIPTEN_KEEPALIVE
int biome_exists(int mc, int id)
{
    if (id < 0 || id >= 256)
        return 0;
    return biomeExists(mc, id);
}

EMSCRIPTEN_KEEPALIVE
int biome_dimension(int id)
{
    if (id < 0 || id >= 256)
        return DIM_UNDEF;
    return getDimension(id);
}

// StructureConfig.dim for the type on this version, or -100 when the version has no
// such structure (also for Feature, Stronghold and out-of-range ints).
EMSCRIPTEN_KEEPALIVE
int structure_info(int mc, int type)
{
    StructureConfig sc;
    if (type <= Feature || type >= FEATURE_NUM || !getStructureConfig(type, mc, &sc))
        return -100;
    return sc.dim;
}

// Region size in blocks (regionSize * 16); < 64 marks a chunk-scale decorator feature
// that find_seeds refuses. 0 when unsupported.
EMSCRIPTEN_KEEPALIVE
int structure_region_blocks(int mc, int type)
{
    StructureConfig sc;
    if (type <= Feature || type >= FEATURE_NUM || !getStructureConfig(type, mc, &sc))
        return 0;
    return sc.regionSize * 16;
}

// Minimum distance from the origin at which the type can generate: End cities never
// spawn inside radius 1008 (getStructurePos rejects those attempts).
EMSCRIPTEN_KEEPALIVE
int structure_min_distance(int mc, int type)
{
    (void)mc;
    return type == End_City ? 1008 : 0;
}

// ---------------------------------------------------------------------------
// find_seeds helpers
// ---------------------------------------------------------------------------

// Progress is paced by wall time, not by counts: a 26.3 biome check costs 7-300 ms
// while a 1.17 one can reject in microseconds, and a per-16-checks rule would post
// thousands of messages a second on the fast paths.
static void maybeProgress(double examined, double tested)
{
    double now = emscripten_get_now();
    if (now - g_lastProgress >= PROGRESS_INTERVAL_MS)
    {
        call_seed_update(examined, tested);
        g_lastProgress = now;
    }
}

// Contiguous bytes one more malloc can take without growing the heap. This build has
// a fixed heap and a failed growth abort()s the whole runtime (the worker dies), so big
// buffers are budgeted before they are allocated. dlmalloc never gives memory back to
// the break (MORECORE_CANNOT_TRIM), so freed buffers end up in the top chunk, which
// sits right below the break: keepcost + the unbroken heap is the usable run.
static size_t heapRoom(void)
{
    size_t heap = emscripten_get_heap_size();
    size_t brk = (size_t)(*emscripten_get_sbrk_ptr());
    struct mallinfo mi = mallinfo();
    return (heap > brk ? heap - brk : 0) + mi.keepcost;
}

// The structure gate every export shares: maps the UI's type to the one cubiomes
// computes in `dim` and loads its config. Returns 0, ERR_STRUCT_UNSUPPORTED or
// ERR_STRUCT_DIMENSION. Every getStructurePos/isViableStructurePos/getVariant call sits
// behind it, because cubiomes exit()s on a type it does not know and exit() kills the worker.
static int resolveStructure(int uiType, int mc, int dim, int *type, StructureConfig *sc)
{
    *type = uiType;
    if (uiType <= Feature || uiType >= FEATURE_NUM)
        return ERR_STRUCT_UNSUPPORTED;
    // The UI has one "Ruined Portal"; cubiomes keeps a separate config for the Nether.
    if (uiType == Ruined_Portal && dim == DIM_NETHER)
        *type = Ruined_Portal_N;
    if (!getStructureConfig(*type, mc, sc))
        return ERR_STRUCT_UNSUPPORTED;
    if (sc->dim != dim)
        return ERR_STRUCT_DIMENSION;
    return 0;
}

// Resolve one requested type for find_seeds. Returns 0 or an ERR_* code.
static int planStructure(StructPlan *p, int uiType, int mc, int dim, int range)
{
    memset(p, 0, sizeof(*p));
    p->uiType = uiType;
    int err = resolveStructure(uiType, mc, dim, &p->type, &p->sc);
    if (err)
        return err;
    // Chunk-scale decorator features (Treasure, Mineshaft, Desert Well, Geode, Nether
    // Fossil, End Gateway, End Island): thousands of "regions" per box, not searchable.
    if (p->sc.regionSize < 4)
        return ERR_TOO_MANY_REGIONS;
    if (p->type == End_City && range < 1008)
        return ERR_MIN_DISTANCE;
    int rb = p->sc.regionSize * 16;
    p->r0 = floordiv(-range, rb);
    p->r1 = floordiv(range, rb);
    int span = p->r1 - p->r0 + 1;
    if (span * span > MAX_ATTEMPTS)
        return ERR_TOO_MANY_REGIONS;
    return 0;
}

// Stage 1 (RNG only, no biomes): every generation attempt of this type, in every region
// touching the box, whose position lies inside the box - sorted by distance to the
// origin so the closest viable one is reported.
static void collectAttempts(StructPlan *p, int mc, uint64_t s48, int range)
{
    int rx, rz, n = 0;
    for (rz = p->r0; rz <= p->r1; rz++)
    {
        for (rx = p->r0; rx <= p->r1; rx++)
        {
            Pos a;
            if (!getStructurePos(p->type, mc, s48, rx, rz, &a))
                continue;
            if (a.x < -range || a.x > range || a.z < -range || a.z > range)
                continue;
            int64_t d = (int64_t)a.x * a.x + (int64_t)a.z * a.z;
            int i = n;
            while (i > 0)
            {
                Pos b = p->at[p->order[i - 1]];
                if ((int64_t)b.x * b.x + (int64_t)b.z * b.z <= d)
                    break;
                p->order[i] = p->order[i - 1];
                i--;
            }
            p->at[n] = a;
            p->order[i] = n;
            n++;
        }
    }
    p->n = n;
}

// Post a hit: the chosen attempt per type plus the Overworld spawn (what the seed page
// shows, whatever dimension was searched), then restore the search dimension.
static void reportHit(uint64_t seed, int dim, int nStructs, double examined, double tested)
{
    int i;
    for (i = 0; i < nStructs; i++)
    {
        Pos a = plans[i].at[plans[i].order[plans[i].chosen]];
        hitBuf[3 * i] = plans[i].uiType;
        hitBuf[3 * i + 1] = a.x;
        hitBuf[3 * i + 2] = a.z;
    }
    // The Overworld state (layer stack up to 1.17, biome noise from 1.18) shares a union
    // with the Nether and End noise, so a dimension switch must rebuild it: applySeed on
    // its own would follow clobbered layer pointers.
    if (dim != DIM_OVERWORLD)
        setupGenerator(&g, g.mc, 0);
    applySeed(&g, DIM_OVERWORLD, seed);
    Pos sp = getSpawn(&g);
    call_seed_found((int64_t)seed, sp.x, sp.z, hitBuf, nStructs, examined, tested);
    if (dim != DIM_OVERWORLD)
        setupGenerator(&g, g.mc, 0);
    applySeed(&g, dim, seed);
}

// ---------------------------------------------------------------------------
// find_seeds
// ---------------------------------------------------------------------------

// Bounded, streaming search for seeds that have ALL of `biomes` (at yHeight) and ALL of
// `structs` inside [-rangeBlocks, +rangeBlocks]^2 around the origin, in `dim`.
//
// Candidates are consumed from startingSeed: one 64-bit seed each when only biomes are
// requested, one lower-48 family (65 536 seeds sharing the structure layout) when
// structures are. The return value is the number of candidates examined, so a caller
// resuming at startingSeed + examined tiles the candidate space exactly; a negative
// value is an ERR_* code. Hits are posted as SEED_FOUND while the call runs, progress
// as SEED_UPDATE; search_last_tested()/search_last_hits() complete the summary.
EMSCRIPTEN_KEEPALIVE
double find_seeds(int mc, int dim, int yHeight,
                  int biomes[], int nBiomes,
                  int structs[], int nStructs,
                  int rangeBlocks,
                  int64_t startingSeed, double maxSeedsToScan, int maxResults)
{
    int i, j;
    g_lastTested = 0;
    g_lastHits = 0;
    forgetWorld();

    if (mc < MC_B1_7 || mc > MC_NEWEST)
        return ERR_VERSION;
    if (dim != DIM_OVERWORLD && dim != DIM_NETHER && dim != DIM_END)
        return ERR_DIMENSION;
    if (rangeBlocks < 1 || rangeBlocks > MAX_RANGE_BLOCKS)
        return ERR_ARGS;
    if (nBiomes < 0 || nBiomes > MAX_BIOMES || nStructs < 0 || nStructs > MAX_STRUCTS || nBiomes + nStructs == 0)
        return ERR_ARGS;
    if (maxResults < 1 || !(maxSeedsToScan >= 1)) // also rejects NaN
        return ERR_ARGS;
    for (i = 0; i < nBiomes; i++)
    {
        int id = biomes[i];
        // setupBiomeFilter exit()s on ids outside [0,64) u [128,192); the_void (127) is one.
        if (id < 0 || id >= 256 || (id & ~0xbf))
            return ERR_BIOME_UNSUPPORTED;
        if (!biomeExists(mc, id) || getDimension(id) != dim)
            return ERR_BIOME_UNSUPPORTED;
    }
    for (i = 0; i < nStructs; i++)
    {
        int err = planStructure(&plans[i], structs[i], mc, dim, rangeBlocks);
        if (err)
            return err;
    }

    setupGenerator(&g, mc, 0);
    applySeed(&g, dim, (uint64_t)startingSeed);

    BiomeFilter filter;
    Range r = {0, 0, 0, 0, 0, 0, 0};
    int *cache = NULL;
    if (nBiomes)
    {
        setupBiomeFilter(&filter, mc, 0, biomes, nBiomes, NULL, 0, NULL, 0);
        int cells = (rangeBlocks + 3) >> 2;
        r = (Range){4, -cells, -cells, 2 * cells, 2 * cells, yHeight / 4, 1};
        // allocCache needs g->dim, hence after applySeed.
        size_t cacheBytes = getMinCacheSize(&g, r.scale, r.sx, r.sy, r.sz) * sizeof(int);
        int layered = mc <= MC_1_17 && dim == DIM_OVERWORLD; // beta and layer stacks: cache only
        size_t need = cacheBytes + (layered ? 0 : (size_t)r.sx * r.sz * NOISE_TUPLE_BYTES) + HEAP_SLACK;
        if (cacheBytes == 0 || need > heapRoom())
            return ERR_NOMEM;
        cache = allocCache(&g, r);
        if (!cache)
            return ERR_NOMEM;
    }

    double examined = 0, tested = 0;
    int hits = 0;
    long checks = 0;
    // A biome check on the 1.x layer stacks costs microseconds, on every other generator
    // milliseconds: read the clock every check only where the check itself is expensive.
    int cheapCheck = mc >= MC_B1_8 && mc <= MC_1_17 && dim == DIM_OVERWORLD;
    int clockEvery = cheapCheck ? PROGRESS_CLOCK_EVERY : 1;
    g_lastProgress = emscripten_get_now();

    if (nStructs == 0)
    {
        // Biome-only: every 64-bit seed is its own candidate.
        for (i = 0; (double)i < maxSeedsToScan && hits < maxResults; i++)
        {
            uint64_t seed = (uint64_t)startingSeed + (uint64_t)i;
            tested += 1;
            checks++;
            int ok = checkForBiomes(&g, cache, r, dim, seed, &filter, NULL) > 0;
            examined = (double)i + 1;
            if (ok)
            {
                hits++;
                reportHit(seed, dim, 0, examined, tested);
            }
            if (checks % clockEvery == 0)
                maybeProgress(examined, tested);
        }
    }
    else
    {
        // Structures (+ biomes): the candidate is a lower-48 family. Structure positions
        // depend on the lower 48 bits only, so stage 1 filters whole families with RNG
        // alone; stage 2 tries upper-16 values for biome viability; stage 3 (biomes) is
        // the expensive one and runs last. One hit per family: all 65 536 seeds share
        // the layout, continuing would only yield near-duplicates.
        int upMax = nBiomes ? UPPER16_MAX_WITH_BIOMES : UPPER16_MAX;
        for (i = 0; (double)i < maxSeedsToScan && hits < maxResults; i++)
        {
            uint64_t s48 = ((uint64_t)startingSeed + (uint64_t)i) & MASK48;
            int candidate = 1;
            for (j = 0; j < nStructs; j++)
            {
                collectAttempts(&plans[j], mc, s48, rangeBlocks);
                if (plans[j].n == 0)
                {
                    candidate = 0;
                    break;
                }
            }
            if (candidate)
            {
                int up;
                for (up = 0; up < upMax; up++)
                {
                    uint64_t seed = s48 | ((uint64_t)up << 48);
                    applySeed(&g, dim, seed);
                    tested += 1;
                    for (j = 0; j < nStructs; j++)
                    {
                        StructPlan *p = &plans[j];
                        int k;
                        p->chosen = -1;
                        for (k = 0; k < p->n; k++)
                        {
                            Pos a = p->at[p->order[k]];
                            if (!isViableStructurePos(p->type, &g, a.x, a.z, 0))
                                continue;
                            // 1.18+ surface heuristic (desert/jungle temples, mansions): drops false positives.
                            if (dim == DIM_OVERWORLD && !isViableStructureTerrain(p->type, &g, a.x, a.z))
                                continue;
                            p->chosen = k;
                            break;
                        }
                        if (p->chosen < 0)
                            break;
                    }
                    if (j < nStructs)
                        continue;
                    if (nBiomes)
                    {
                        checks++;
                        int ok = checkForBiomes(&g, cache, r, dim, seed, &filter, NULL) > 0;
                        if (checks % clockEvery == 0)
                            maybeProgress((double)i, tested); // families fully consumed so far
                        if (!ok)
                            continue; // the next applySeed re-initialises g
                    }
                    hits++;
                    reportHit(seed, dim, nStructs, (double)i + 1, tested);
                    break;
                }
            }
            examined = (double)i + 1;
            if ((i + 1) % PROGRESS_CLOCK_EVERY == 0)
                maybeProgress(examined, tested);
        }
    }

    free(cache);
    g_lastTested = tested;
    g_lastHits = hits;
    return examined;
}

EMSCRIPTEN_KEEPALIVE
double search_last_tested(void)
{
    return g_lastTested;
}

EMSCRIPTEN_KEEPALIVE
double search_last_hits(void)
{
    return g_lastHits;
}

EMSCRIPTEN_KEEPALIVE
Pos *find_spawn(int mcVersion, int64_t seed)
{
    forgetWorld();
    setupGenerator(&g, mcVersion, 0);
    applySeed(&g, DIM_OVERWORLD, seed);
    static Pos pos;
    pos = getSpawn(&g);
    return &pos;
}

EMSCRIPTEN_KEEPALIVE
Pos *find_strongholds(int mcVersion, int64_t seed, int howMany)
{
    forgetWorld();
    StrongholdIter sh;
    initFirstStronghold(&sh, mcVersion, seed);
    setupGenerator(&g, mcVersion, 0);
    applySeed(&g, 0, seed);

    int i, N = howMany;
    static Pos *coords = NULL;
    free(coords);
    coords = malloc(sizeof(Pos) * howMany);
    for (i = 0; i < N; i++)
    {
        if (nextStronghold(&sh, &g) <= 0)
        {
            for (; i < N; i++)
            {
                Pos p;
                p.x = -1;
                p.z = -1;
                coords[i] = p;
            }
            break;
        }
        else
        {
            Pos p;
            p.x = sh.pos.x;
            p.z = sh.pos.z;
            coords[i] = p;
        }
    }
    return coords;
}

// Viable positions of one type in the regions [-range, range) on both axes; non-viable
// or missing attempts are (-1, -1). Empty when the version has no such structure: the
// getStructureConfig gate keeps getStructurePos's exit() unreachable.
EMSCRIPTEN_KEEPALIVE
Pos *get_structure_in_regions(int mcVersion, int structType, int64_t seed, int range, int dimension)
{
    forgetWorld();
    // The UI's one Ruined Portal (11) is Ruined_Portal_N in the Nether, whose regions are
    // 25 chunks up to 1.17 (40 in the Overworld); before this the Nether map placed
    // portals with the Overworld config.
    if (structType == Ruined_Portal && dimension == DIM_NETHER)
        structType = Ruined_Portal_N;
    StructureConfig sc;
    int supported = structType > Feature && structType < FEATURE_NUM && getStructureConfig(structType, mcVersion, &sc);
    if (supported)
    {
        setupGenerator(&g, mcVersion, 0);
        applySeed(&g, dimension, seed);
    }

    int regionX;
    int regionY;
    int i = 0;
    static Pos *coords = NULL;
    free(coords);
    coords = malloc(sizeof(Pos) * 4 * range * range);
    for (regionX = -range; regionX < range; regionX++)
    {
        for (regionY = -range; regionY < range; regionY++)
        {
            Pos p = {-1, -1};
            if (supported)
            {
                Pos a;
                if (getStructurePos(structType, mcVersion, seed, regionX, regionY, &a) && isViableStructurePos(structType, &g, a.x, a.z, 0))
                    p = a;
            }
            coords[i] = p;
            i++;
        }
    }
    return coords;
}

// ---------------------------------------------------------------------------
// Dashboard exports (seed page). Each returns a pointer to a static int buffer
// (or a plain int) that seeder.js copies out of HEAP32 at once; counts are explicit.
// ---------------------------------------------------------------------------

static Piece pieceBuf[PIECE_BUF]; // shared by stronghold, fortress and End city pieces: one call at a time
static int summaryBuf[4];
static int strongholdBuf[1 + 4 * MAX_STRONGHOLDS];
static int analyseBuf[5];
static int nearestBuf[4 * MAX_NEAREST_TYPES];
static int variantBuf[VARIANT_INTS];
static unsigned char slimeBuf[SLIME_MAX * SLIME_MAX];
static int centersBuf[1 + 3 * MAX_CENTERS];
static Pos centerPos[MAX_CENTERS];
static int centerSize[MAX_CENTERS];
static int quadBuf[1 + 2 * MAX_QUADS];
static Pos quadRegions[MAX_QUADS];
static int fortressBuf[2 + 3 * MAX_SPAWNERS];

static int validVersion(int mc)
{
    return mc >= MC_B1_7 && mc <= MC_NEWEST;
}

static int validDimension(int dim)
{
    return dim == DIM_OVERWORLD || dim == DIM_NETHER || dim == DIM_END;
}

// Point g at (mc, seed, dim), skipping the work when it already is. Always a full
// setupGenerator + applySeed otherwise: the Overworld state shares a union with the
// Nether/End noise, so applySeed alone after a dimension switch would follow clobbered
// layer pointers (see reportHit).
static void useWorld(int mc, uint64_t seed, int dim)
{
    if (g_worldValid && g_worldMc == mc && g_worldSeed == seed && g_worldDim == dim)
        return;
    setupGenerator(&g, mc, 0);
    applySeed(&g, dim, seed);
    g_worldValid = 1;
    g_worldMc = mc;
    g_worldSeed = seed;
    g_worldDim = dim;
}

// The same viability find_seeds reports: the biome check, plus in the Overworld the 1.18+
// surface heuristic that drops temples and mansions cubiomes would otherwise accept.
static int isViableAt(int type, int dim, int x, int z)
{
    if (!isViableStructurePos(type, &g, x, z, 0))
        return 0;
    return dim != DIM_OVERWORLD || isViableStructureTerrain(type, &g, x, z);
}

// Surface height at a block, g already on (mc, seed, dim) for the Overworld case.
// INT_MIN when cubiomes cannot tell (Overworld before 1.18, the Nether).
static int surfaceHeight(int mc, uint64_t seed, int dim, int x, int z)
{
    if (dim == DIM_END)
        return getEndSurfaceHeight(mc, seed, x, z);
    if (dim == DIM_OVERWORLD && mc >= MC_1_18)
    {
        float y;
        if (mapApproxHeight(&y, NULL, &g, NULL, x >> 2, z >> 2, 1, 1) == 0)
            return (int)floorf(y + 0.5f);
    }
    return INT_MIN;
}

// [spawnX, spawnZ, spawnBiome, approxHeight]. The spawn is the Overworld's (what the map
// shows); the Nether and the End have none, so the dashboard centres on the origin there.
// The biome is sampled like generate_area samples the map: scale 4 at yHeight / 4.
EMSCRIPTEN_KEEPALIVE
int *seed_summary(int mc, int64_t seed, int dim, int yHeight)
{
    summaryBuf[0] = summaryBuf[1] = 0;
    summaryBuf[2] = -1;
    summaryBuf[3] = INT_MIN;
    if (!validVersion(mc) || !validDimension(dim))
        return summaryBuf;
    Pos sp = {0, 0};
    if (dim == DIM_OVERWORLD)
    {
        useWorld(mc, (uint64_t)seed, DIM_OVERWORLD);
        sp = getSpawn(&g);
    }
    useWorld(mc, (uint64_t)seed, dim);
    summaryBuf[0] = sp.x;
    summaryBuf[1] = sp.z;
    summaryBuf[2] = getBiomeAt(&g, 4, sp.x >> 2, yHeight / 4, sp.z >> 2);
    summaryBuf[3] = surfaceHeight(mc, (uint64_t)seed, dim, sp.x, sp.z);
    return summaryBuf;
}

// count, then [x, z, ring, index] per stronghold in generation order. `approx` skips the
// biome snapping from 1.19.3 on, where cubiomes can iterate without a generator: faster,
// positions within ~112 blocks. Before 1.9 a world has 3 strongholds, from 1.9 on 128.
EMSCRIPTEN_KEEPALIVE
int *strongholds_list(int mc, int64_t seed, int howMany, int approx)
{
    strongholdBuf[0] = 0;
    if (!validVersion(mc) || mc < MC_B1_8)
        return strongholdBuf;
    int limit = mc >= MC_1_9 ? MAX_STRONGHOLDS : 3;
    if (howMany < 1)
        howMany = 1;
    if (howMany > limit)
        howMany = limit;
    useWorld(mc, (uint64_t)seed, DIM_OVERWORLD);
    StrongholdIter sh;
    initFirstStronghold(&sh, mc, (uint64_t)seed);
    const Generator *gen = approx && mc > MC_1_19_2 ? NULL : &g;
    int n = 0;
    while (n < howMany)
    {
        // nextStronghold advances ring and index past the stronghold it returns.
        int ring = sh.ringnum, index = sh.index;
        if (nextStronghold(&sh, gen) <= 0)
            break;
        int *out = strongholdBuf + 1 + 4 * n;
        out[0] = sh.pos.x;
        out[1] = sh.pos.z;
        out[2] = ring;
        out[3] = index;
        n++;
    }
    strongholdBuf[0] = n;
    return strongholdBuf;
}

// [eyes, libraries, portalX, portalZ, pieces] for the stronghold at block (x, z) as listed
// by strongholds_list. eyes = filled End portal frames (popcount of the portal room's
// 12-bit mask); -1 when unknown: cubiomes has the loot salt only from 1.13, and no pieces
// before 1.8. The portal room position is the centre of its bounding box.
EMSCRIPTEN_KEEPALIVE
int *stronghold_analyse(int mc, int64_t seed, int x, int z)
{
    analyseBuf[0] = analyseBuf[1] = -1;
    analyseBuf[2] = analyseBuf[3] = analyseBuf[4] = 0;
    if (!validVersion(mc) || mc < MC_1_8)
        return analyseBuf;
    StructureSaltConfig ss;
    int loot = getStructureSaltConfig(Stronghold, mc, -1, &ss);
    int n = loot ? getStrongholdLoot(pieceBuf, PIECE_BUF, ss, mc, (uint64_t)seed, x >> 4, z >> 4)
                 : getStrongholdPieces(pieceBuf, PIECE_BUF, mc, (uint64_t)seed, x >> 4, z >> 4);
    int i, libraries = 0;
    for (i = 0; i < n; i++)
    {
        Piece *p = &pieceBuf[i];
        if (p->type == SH_LIBRARY)
            libraries++;
        else if (p->type == SH_PORTAL_ROOM)
        {
            analyseBuf[0] = loot ? __builtin_popcount(p->additionalData & 0xfff) : -1;
            analyseBuf[2] = (p->bb0.x + p->bb1.x) / 2;
            analyseBuf[3] = (p->bb0.z + p->bb1.z) / 2;
        }
    }
    analyseBuf[1] = libraries;
    analyseBuf[4] = n;
    return analyseBuf;
}

// Closest viable attempt of one type to (cx, cz) within `radius`, scanning region rings
// outwards from the centre region. A hit in ring k can be farther than one in ring k+1,
// so rings continue until their nearest edge is beyond the best distance found.
static int nearestOf(int type, int mc, uint64_t seed, int dim, StructureConfig sc, int cx, int cz, int radius, Pos *best)
{
    int rb = sc.regionSize * 16;
    int rx0 = floordiv(cx, rb), rz0 = floordiv(cz, rb);
    int rings = radius / rb + 1;
    int64_t r2 = (int64_t)radius * radius, bestD = -1;
    int k;
    for (k = 0; k <= rings; k++)
    {
        if (bestD >= 0 && k > 1)
        {
            int64_t edge = (int64_t)(k - 1) * rb;
            if (edge * edge > bestD)
                break;
        }
        int dx, dz;
        for (dz = -k; dz <= k; dz++)
        {
            // the ring's perimeter: whole first and last rows, only the two ends in between
            int step = (dz == -k || dz == k) ? 1 : 2 * k;
            for (dx = -k; dx <= k; dx += step)
            {
                Pos a;
                if (!getStructurePos(type, mc, seed, rx0 + dx, rz0 + dz, &a))
                    continue;
                int64_t ddx = (int64_t)a.x - cx, ddz = (int64_t)a.z - cz;
                int64_t d = ddx * ddx + ddz * ddz;
                if (d > r2 || (bestD >= 0 && d >= bestD))
                    continue;
                if (!isViableAt(type, dim, a.x, a.z))
                    continue;
                *best = a;
                bestD = d;
            }
        }
    }
    return bestD >= 0;
}

// [type, found, x, z] per requested type: found 1 with the closest viable instance to
// (cx, cz) within maxRadiusBlocks (<= 8192), 0 when there is none in reach, -1 when the
// type does not exist on this version or not in this dimension (so the UI can hide it).
// Chunk-scale features (regionSize < 4: Treasure, Geode, End Gateway...) reach 64 chunks.
EMSCRIPTEN_KEEPALIVE
int *nearest_structures(int mc, int64_t seed, int dim, int cx, int cz, int types[], int n, int maxRadiusBlocks)
{
    int i;
    if (n < 0)
        n = 0;
    if (n > MAX_NEAREST_TYPES)
        n = MAX_NEAREST_TYPES;
    if (maxRadiusBlocks < 0)
        maxRadiusBlocks = 0;
    if (maxRadiusBlocks > MAX_NEAREST_RADIUS)
        maxRadiusBlocks = MAX_NEAREST_RADIUS;
    int ok = validVersion(mc) && validDimension(dim);
    if (ok)
        useWorld(mc, (uint64_t)seed, dim);
    for (i = 0; i < n; i++)
    {
        int *out = nearestBuf + 4 * i;
        out[0] = types[i];
        out[1] = -1;
        out[2] = out[3] = 0;
        int type;
        StructureConfig sc;
        if (!ok || resolveStructure(types[i], mc, dim, &type, &sc))
            continue;
        int radius = maxRadiusBlocks;
        if (sc.regionSize < 4 && radius > CHUNK_SCALE_RADIUS)
            radius = CHUNK_SCALE_RADIUS;
        Pos p;
        out[1] = nearestOf(type, mc, (uint64_t)seed, dim, sc, cx, cz, radius, &p);
        if (out[1])
        {
            out[2] = p.x;
            out[3] = p.z;
        }
    }
    return nearestBuf;
}

// The biome getVariant should see at an attempt: the one the game (and cubiomes'
// isViableStructurePos) validates that structure with - village types, ruined portal
// looks and beached shipwrecks depend on it. g is on (mc, seed, dim).
static int variantBiome(int type, int mc, int dim, uint64_t seed, int x, int z)
{
    int cx = x >> 4, cz = z >> 4;
    StructureVariant sv;
    switch (type)
    {
    case Village:
        // isViableStructurePos returns the village biome itself (1.18+: the variant whose
        // start piece stands in its biome; meadow counts as plains).
        if (mc >= MC_1_10)
        {
            int v = isViableStructurePos(Village, &g, x, z, 0);
            if (v > 0)
                return v;
        }
        break;
    case Bastion:
        return -1; // bastion types do not depend on the biome (cubiomes passes -1 itself)
    case Ancient_City:
    case Trial_Chambers:
    case Abandoned_Camp:
        // jigsaw structures: sampled at the start piece's centre and depth
        getVariant(&sv, type, mc, seed, x, z, -1);
        return getBiomeAt(&g, 4, (cx * 32 + 2 * sv.x + sv.sx - 1) / 2 >> 2, sv.y >> 2, (cz * 32 + 2 * sv.z + sv.sz - 1) / 2 >> 2);
    }
    // features: chunk-centre sample, as isViableStructurePos does per version and dimension
    if (dim == DIM_END)
        return getBiomeAt(&g, 16, cx, 0, cz);
    if (dim == DIM_NETHER)
        return getBiomeAt(&g, 4, cx * 4 + 2, 0, cz * 4 + 2);
    if (mc <= MC_1_15)
    {
        int o = 8 + (mc > MC_1_8_9);
        return getBiomeAt(&g, 1, cx * 16 + o, 0, cz * 16 + o);
    }
    return getBiomeAt(&g, 4, cx * 4 + 2, 319 >> 2, cz * 4 + 2);
}

// [supported, abandoned, giant, underground, airpocket, basement, cracked, size, start,
//  biome, rotation, mirror, bx, by, bz, sx, sy, sz, endShip] for the instance at block
// (x, z). supported = 0 when getVariant has nothing for this type/version (or the type
// fails the structure gate). biome = the biome the variant was computed with (-1 when it
// plays no role); start = -1 when the type has no start piece; endShip for End cities.
EMSCRIPTEN_KEEPALIVE
int *structure_variant(int mc, int64_t seed, int dim, int uiType, int x, int z)
{
    memset(variantBuf, 0, sizeof(variantBuf));
    variantBuf[8] = variantBuf[9] = -1;
    int type;
    StructureConfig sc;
    if (!validVersion(mc) || !validDimension(dim) || resolveStructure(uiType, mc, dim, &type, &sc))
        return variantBuf;
    useWorld(mc, (uint64_t)seed, dim);
    int biome = variantBiome(type, mc, dim, (uint64_t)seed, x, z);
    StructureVariant sv;
    int supported = getVariant(&sv, type, mc, (uint64_t)seed, x, z, biome) ? 1 : 0;
    int *o = variantBuf;
    o[0] = supported;
    if (supported)
    {
        o[1] = sv.abandoned;
        o[2] = sv.giant;
        o[3] = sv.underground;
        o[4] = sv.airpocket;
        o[5] = sv.basement;
        o[6] = sv.cracked;
        o[7] = sv.size;
        o[8] = sv.start == 0xff ? -1 : sv.start;
        o[9] = sv.biome != -1 ? sv.biome : biome;
        o[10] = sv.rotation;
        o[11] = sv.mirror;
        o[12] = sv.x;
        o[13] = sv.y;
        o[14] = sv.z;
        o[15] = sv.sx;
        o[16] = sv.sy;
        o[17] = sv.sz;
    }
    if (type == End_City)
    {
        int i, n = getEndCityPieces(pieceBuf, (uint64_t)seed, x >> 4, z >> 4);
        for (i = 0; i < n; i++)
            if (pieceBuf[i].type == END_SHIP)
                o[18] = 1;
    }
    return variantBuf;
}

// Biome id at a block, sampled like the map (scale 4, y / 4); -1 on bad arguments.
EMSCRIPTEN_KEEPALIVE
int biome_at(int mc, int64_t seed, int dim, int x, int y, int z)
{
    if (!validVersion(mc) || !validDimension(dim))
        return -1;
    useWorld(mc, (uint64_t)seed, dim);
    return getBiomeAt(&g, 4, x >> 2, y / 4, z >> 2);
}

// Estimated surface Y at a block: 1.18+ Overworld and the End; INT_MIN elsewhere.
EMSCRIPTEN_KEEPALIVE
int approx_height(int mc, int64_t seed, int dim, int x, int z)
{
    if (!validVersion(mc) || !validDimension(dim))
        return INT_MIN;
    if (dim == DIM_OVERWORLD)
        useWorld(mc, (uint64_t)seed, dim);
    return surfaceHeight(mc, (uint64_t)seed, dim, x, z);
}

// isSlimeChunk (finders.h) with the same Java int arithmetic spelt out unsigned: the
// header's signed multiplications overflow for |chunk| > 358, which is undefined behaviour
// in this translation unit (cubiomes itself is built with -fwrapv, api.c is not).
static int slimeAt(uint64_t seed, int cx, int cz)
{
    uint32_t ux = (uint32_t)cx, uz = (uint32_t)cz;
    uint64_t rnd = seed;
    rnd += (uint64_t)(int64_t)(int32_t)(ux * 0x5ac0dbu);
    rnd += (uint64_t)(int64_t)(int32_t)(ux * ux * 0x4c1906u);
    rnd += (uint64_t)(int64_t)(int32_t)(uz * 0x5f24fu);
    rnd += (uint64_t)(int64_t)(int32_t)(uz * uz) * 0x4307a7ULL;
    rnd ^= 0x3ad8025fULL;
    setSeed(&rnd, rnd);
    return nextInt(&rnd, 10) == 0;
}

// w*h bytes, row-major ([dz * w + dx]), 1 = slime chunk at (cx0 + dx, cz0 + dz).
// All zero when w or h is outside 1..64.
EMSCRIPTEN_KEEPALIVE
unsigned char *slime_chunks(int64_t seed, int cx0, int cz0, int w, int h)
{
    int i, j;
    memset(slimeBuf, 0, sizeof(slimeBuf));
    if (w < 1 || h < 1 || w > SLIME_MAX || h > SLIME_MAX)
        return slimeBuf;
    for (j = 0; j < h; j++)
        for (i = 0; i < w; i++)
            slimeBuf[j * w + i] = (unsigned char)slimeAt((uint64_t)seed, cx0 + i, cz0 + j);
    return slimeBuf;
}

// count, then [x, z, sizeCells] per patch of `biomeId` within radiusBlocks (<= 2048) of
// (cx, cz) at yHeight; x, z are blocks (getBiomeCenters already scales its centres), in
// no particular order. count < 0 is an ERR_* code: -2 outside the Overworld (cubiomes'
// locator is Overworld-only), -6 biome not in this version, -7 arguments, -8 the box does
// not fit the heap (checked first: a failed malloc would abort the worker).
EMSCRIPTEN_KEEPALIVE
int *biome_centers(int mc, int64_t seed, int dim, int biomeId, int cx, int cz, int radiusBlocks, int yHeight, int minSizeCells, int nmax)
{
    int i;
    centersBuf[0] = 0;
    if (!validVersion(mc) || mc < MC_B1_8) // Beta 1.7 has no layer stack to run the locator on
    {
        centersBuf[0] = ERR_VERSION;
        return centersBuf;
    }
    if (dim != DIM_OVERWORLD)
    {
        centersBuf[0] = ERR_DIMENSION;
        return centersBuf;
    }
    // setupBiomeFilter exit()s outside [0,64) u [128,192); 1.18+ needs climate limits.
    if (biomeId < 0 || biomeId >= 256 || (biomeId & ~0xbf) || !biomeExists(mc, biomeId) || getDimension(biomeId) != DIM_OVERWORLD ||
        (mc >= MC_1_18 && !getBiomeParaLimits(mc, biomeId)))
    {
        centersBuf[0] = ERR_BIOME_UNSUPPORTED;
        return centersBuf;
    }
    if (radiusBlocks < 4 || nmax < 1)
    {
        centersBuf[0] = ERR_ARGS;
        return centersBuf;
    }
    if (radiusBlocks > MAX_CENTER_RADIUS)
        radiusBlocks = MAX_CENTER_RADIUS;
    if (nmax > MAX_CENTERS)
        nmax = MAX_CENTERS;
    if (minSizeCells < 1)
        minSizeCells = 1;

    useWorld(mc, (uint64_t)seed, DIM_OVERWORLD);
    int cells = radiusBlocks / 4;
    Range r = {4, (cx >> 2) - cells, (cz >> 2) - cells, 2 * cells, 2 * cells, yHeight / 4, 1};
    size_t need = (size_t)r.sx * r.sz * CENTER_BYTES_PER_CELL + HEAP_SLACK;
    if (mc <= MC_1_17) // the layered path also allocates a cache for the whole box
        need += getMinCacheSize(&g, r.scale, r.sx, r.sy, r.sz) * sizeof(int);
    if (need > heapRoom())
    {
        centersBuf[0] = ERR_NOMEM;
        return centersBuf;
    }
    int n = getBiomeCenters(centerPos, centerSize, nmax, &g, r, biomeId, minSizeCells, CENTER_TOLERANCE, NULL);
    forgetWorld(); // the layered path re-seeds g and swaps layer callbacks while it runs
    for (i = 0; i < n; i++)
    {
        centersBuf[1 + 3 * i] = centerPos[i].x;
        centersBuf[2 + 3 * i] = centerPos[i].z;
        centersBuf[3 + 3 * i] = centerSize[i];
    }
    centersBuf[0] = n;
    return centersBuf;
}

// Whether a player at `afk` reaches some block of the structure footprint at p: the
// despawn sphere getOptimalAfk works with (radius 128, less half the farm height).
static int afkReaches(Pos afk, Pos p, int ax, int ay, int az)
{
    int64_t dx = 0, dz = 0;
    if (afk.x < p.x) dx = p.x - afk.x;
    else if (afk.x > p.x + ax - 1) dx = afk.x - (p.x + ax - 1);
    if (afk.z < p.z) dz = p.z - afk.z;
    else if (afk.z > p.z + az - 1) dz = afk.z - (p.z + az - 1);
    return (double)(dx * dx + dz * dz) <= 128.0 * 128.0 - ay * ay / 4.0;
}

// count, then per farm [cx, cz]: the quad witch farms in the regions
// [-QUAD_HUT_RADIUS, QUAD_HUT_RADIUS]^2 around the origin, each the centre of its four
// huts. A farm is four huts that all generate (biome check) and that one AFK spot
// reaches. count -3: mc has no witch huts.
EMSCRIPTEN_KEEPALIVE
int *quad_huts(int mc, int64_t seed)
{
    StructureConfig sc;
    quadBuf[0] = 0;
    if (!validVersion(mc) || !getStructureConfig(Swamp_Hut, mc, &sc))
    {
        quadBuf[0] = ERR_STRUCT_UNSUPPORTED;
        return quadBuf;
    }
    uint64_t s48 = (uint64_t)seed & MASK48;
    int r = QUAD_HUT_RADIUS, i, k;
    // Only the constellations a witch farm can use: scanForQuads solves for the regions
    // whose moved base has one of these lower 20 bits instead of testing all.
    int n = scanForQuads(sc, 128, s48, low20QuadHutBarely, 20, sc.salt, -r, -r, 2 * r, 2 * r, quadRegions, MAX_QUADS);
    // The farm footprint the AFK spot is optimised for (isQuadBase's hut size).
    const int ax = 7 + 1, ay = 7 + 43 + 1, az = 9 + 1;
    if (n > 0)
        useWorld(mc, (uint64_t)seed, DIM_OVERWORLD);
    int count = 0;
    for (i = 0; i < n; i++)
    {
        Pos p[4];
        int rx = quadRegions[i].x, rz = quadRegions[i].z, ok = 1;
        int minX = INT_MAX, minZ = INT_MAX, maxX = INT_MIN, maxZ = INT_MIN;
        for (k = 0; k < 4 && ok; k++)
        {
            ok = getStructurePos(Swamp_Hut, mc, s48, rx + (k & 1), rz + (k >> 1), &p[k])
                && isViableAt(Swamp_Hut, DIM_OVERWORLD, p[k].x, p[k].z);
            if (!ok)
                break;
            if (p[k].x < minX) minX = p[k].x;
            if (p[k].x > maxX) maxX = p[k].x;
            if (p[k].z < minZ) minZ = p[k].z;
            if (p[k].z > maxZ) maxZ = p[k].z;
        }
        // getOptimalAfk callocs its bounding box; a true quad spans < 256 + footprint.
        if (!ok || maxX - minX > 256 + ax || maxZ - minZ > 256 + az)
            continue;
        if ((size_t)(maxX - minX + 1) * (maxZ - minZ + 1) * sizeof(int) + HEAP_SLACK > heapRoom())
            continue;
        int spcnt = 0;
        Pos afk = getOptimalAfk(p, ax, ay, az, &spcnt);
        // isQuadBase's enclosing-sphere test is approximate for some constellations; when no
        // AFK spot reaches all four, getOptimalAfk falls back to a meaningless point.
        for (k = 0; k < 4 && afkReaches(afk, p[k], ax, ay, az); k++)
            ;
        if (k < 4)
            continue;
        // The centre of the four huts, rounded towards negative infinity like a block.
        int64_t sx = 0, sz = 0;
        for (k = 0; k < 4; k++)
            sx += p[k].x, sz += p[k].z;
        quadBuf[1 + 2 * count] = (int)floor(sx / 4.0);
        quadBuf[2 + 2 * count] = (int)floor(sz / 4.0);
        count++;
    }
    quadBuf[0] = count;
    return quadBuf;
}

// [nSpawners, nWartRooms, (x, y, z) per blaze spawner] for the Nether fortress starting
// in chunk (chunkX, chunkZ): the centre of every BRIDGE_SPAWNER piece's bounding box and
// the number of CORRIDOR_NETHER_WART rooms. nSpawners = -3 when mc has no fortresses.
EMSCRIPTEN_KEEPALIVE
int *fortress_spawners(int mc, int64_t seed, int chunkX, int chunkZ)
{
    StructureConfig sc;
    fortressBuf[0] = fortressBuf[1] = 0;
    if (!validVersion(mc) || !getStructureConfig(Fortress, mc, &sc))
    {
        fortressBuf[0] = ERR_STRUCT_UNSUPPORTED;
        return fortressBuf;
    }
    int i, n = getFortressPieces(pieceBuf, PIECE_BUF, mc, (uint64_t)seed, chunkX, chunkZ);
    int spawners = 0, wart = 0;
    for (i = 0; i < n; i++)
    {
        Piece *p = &pieceBuf[i];
        if (p->type == BRIDGE_SPAWNER && spawners < MAX_SPAWNERS)
        {
            int *o = fortressBuf + 2 + 3 * spawners++;
            o[0] = (p->bb0.x + p->bb1.x) / 2;
            o[1] = (p->bb0.y + p->bb1.y) / 2;
            o[2] = (p->bb0.z + p->bb1.z) / 2;
        }
        else if (p->type == CORRIDOR_NETHER_WART)
            wart++;
    }
    fortressBuf[0] = spawners;
    fortressBuf[1] = wart;
    return fortressBuf;
}
