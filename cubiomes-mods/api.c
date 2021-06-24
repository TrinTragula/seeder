// check the biome at a block position
#include "emscripten.h"
#include "../cubiomes/finders.h"
#include "../cubiomes/generator.h"
#include "../cubiomes/util.h"
#include <stdio.h>

LayerStack g;
int *biomeIds;
int *area;

int main()
{
}

EMSCRIPTEN_KEEPALIVE
int generate_from_seed(int mcVersion, int64_t seed, int x, int z)
{
    setupGenerator(&g, mcVersion);
    Pos pos = {x, z};
    applySeed(&g, seed);
    int biomeID = getBiomeAtPos(&g, pos);
    return biomeID;
}

EMSCRIPTEN_KEEPALIVE
int *generate_area(int mcVersion, int64_t seed, int areaX, int areaZ, int areaWidth, int areaHeight)
{
    setupGenerator(&g, mcVersion);
    Layer *layer;
    if (mcVersion >= MC_1_13)
    {
        layer = &g.layers[L_OCEAN_MIX_4];
    }
    else
    {
        layer = &g.layers[L_RIVER_MIX_4];
    }
    biomeIds = allocCache(layer, areaWidth, areaHeight);
    setLayerSeed(layer, seed);
    genArea(layer, biomeIds, areaX, areaZ, areaWidth, areaHeight);
    return biomeIds;
}

EMSCRIPTEN_KEEPALIVE
void free_memory()
{
    free(biomeIds);
}

EMSCRIPTEN_KEEPALIVE
unsigned char *get_colors()
{
    unsigned char biomeColors[256][3];
    initBiomeColors(biomeColors);
    return &(biomeColors[0][0]);
}

EM_JS(void, call_seed_update, (), {self.postMessage({kind : "SEED_UPDATE"})});

EMSCRIPTEN_KEEPALIVE
int64_t find_biomes(int mcVersion, int wanted[], int count, int x, int z, int w, int h, int starting_seed)
{
    setupGenerator(&g, mcVersion);
    BiomeFilter filter;
    filter = setupBiomeFilter(wanted, count);

    int entry;
    if (mcVersion >= MC_1_13)
    {
        entry = L_OCEAN_MIX_4;
    }
    else
    {
        entry = L_RIVER_MIX_4;
    }
    area = allocCache(&g.layers[entry], w, h);

    int64_t seed;
    for (seed = starting_seed;; seed++)
    {
        if (seed % 10000 == 0)
        {
            call_seed_update();
        }
        if (checkForBiomes(&g, entry, area, seed, x, z, w, h, filter, 1) > 0)
            break;
    }

    return seed;
}

EMSCRIPTEN_KEEPALIVE
void free_area()
{
    free(area);
}

EMSCRIPTEN_KEEPALIVE
Pos *find_spawn(int mcVersion, int64_t seed)
{
    setupGenerator(&g, mcVersion);
    applySeed(&g, seed);
    Pos pos = getSpawn(mcVersion, &g, NULL, seed);
    return &pos;
}

EMSCRIPTEN_KEEPALIVE
Pos *find_strongholds(int mcVersion, int64_t seed, int howMany)
{
    StrongholdIter sh;
    Pos pos = initFirstStronghold(&sh, mcVersion, seed);
    LayerStack g;
    setupGenerator(&g, mcVersion);
    applySeed(&g, seed);

    int i, N = howMany;
    Pos coords[howMany];
    for (i = 0; i < N; i++)
    {
        if (nextStronghold(&sh, &g, NULL) <= 0)
        {
            for (i = i; i < N; i++)
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

EMSCRIPTEN_KEEPALIVE
int64_t find_structures(int mcVersion, int structType, int x, int z, int range, int starting_seed)
{
    LayerStack g;
    setupGenerator(&g, mcVersion);

    int64_t lower48;
    int64_t tot = 0;
    for (lower48 = starting_seed;; lower48++)
    {
        if (tot % 10000 == 0)
        {
            call_seed_update();
        }
        tot++;

        Pos p;
        if (!getStructurePos(structType, mcVersion, lower48, 0, 0, &p))
            continue;

        if ((p.x > (x + range)) || (p.z > (z + range)) || (p.x < (x - range)) || (p.z < (z - range)))
            continue;

        int64_t upper16;
        for (upper16 = 0; upper16 < 0x10000; upper16++)
        {
            if (tot % 10000 == 0)
            {
                call_seed_update();
            }
            tot++;
            int64_t seed = lower48 | (upper16 << 48);
            if (isViableStructurePos(structType, mcVersion, &g, seed, p.x, p.z))
            {
                return seed;
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
int64_t find_biomes_with_structure(int mcVersion, int structType, int wanted[], int count, int x, int z, int range, int starting_seed)
{
    setupGenerator(&g, mcVersion);
    BiomeFilter filter;
    filter = setupBiomeFilter(wanted, count);

    int entry;
    if (mcVersion >= MC_1_13)
    {
        entry = L_OCEAN_MIX_4;
    }
    else
    {
        entry = L_RIVER_MIX_4;
    }
    area = allocCache(&g.layers[entry], range / 2, range / 2);

    int64_t seed;
    int64_t lower48;
    int range_fourth = range / 4;
    int64_t tot = 0;
    for (lower48 = starting_seed;; lower48++)
    {
        if (tot % 10000 == 0)
        {
            call_seed_update();
        }
        tot++;

        Pos p;
        if (!getStructurePos(structType, mcVersion, lower48, 0, 0, &p))
            continue;

        if ((p.x > (x + range)) || (p.z > (z + range)) || (p.x < (x - range)) || (p.z < (z - range)))
            continue;

        int64_t upper16;
        for (upper16 = 0; upper16 < 0x10000; upper16++)
        {
            if (tot % 10000 == 0)
            {
                call_seed_update();
            }
            tot++;
            int64_t seed = lower48 | (upper16 << 48);
            if (isViableStructurePos(structType, mcVersion, &g, seed, p.x, p.z))
            {
                if (checkForBiomes(&g, entry, area, seed, x - range_fourth, z - range_fourth, range_fourth * 2, range_fourth * 2, filter, 1) > 0)
                {
                    return seed;
                }
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
Pos *get_structure_in_regions(int mcVersion, int structType, int64_t seed, int range)
{
    LayerStack g;
    setupGenerator(&g, mcVersion);

    int regionX;
    int regionY;
    int i;
    Pos coords[4 * range * range];
    for (regionX = -range; regionX < range; regionX++)
    {
        for (regionY = -range; regionY < range; regionY++)
        {
            Pos p;
            getStructurePos(structType, mcVersion, seed, regionX, regionY, &p);

            if (!isViableStructurePos(structType, mcVersion, &g, seed, p.x, p.z))
            {
                p.x = -1;
                p.z = -1;
            }
            coords[i] = p;
            i++;
        }
    }
    return coords;
}