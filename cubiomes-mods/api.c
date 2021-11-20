// check the biome at a block position
#include "emscripten.h"
#include "../cubiomes/finders.h"
#include "../cubiomes/generator.h"
#include "../cubiomes/util.h"
#include <stdio.h>

int *biomeIds;
int *area;

int main()
{
}

// TODO: ADD SCALE AND DIMENSION
EMSCRIPTEN_KEEPALIVE
int *generate_area(int mcVersion, int64_t seed, int areaX, int areaZ, int areaWidth, int areaHeight, int dimension, int yHeight)
{
    Generator g;
    setupGenerator(&g, mcVersion, 0);
    Range r = {4, areaX, areaZ, areaWidth, areaHeight, yHeight / 4, 1};
    biomeIds = allocCache(&g, r);
    applySeed(&g, dimension, seed); // 0 = overworld, 1 = end, 2 = nether
    genBiomes(&g, biomeIds, r);
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
int64_t find_biomes(int mcVersion, int wanted[], int count, int x, int z, int w, int h, int starting_seed, int dimension, int yHeight)
{
    Generator g;
    setupGenerator(&g, mcVersion, 0);
    BiomeFilter filter;
    int *excluded;
    filter = setupBiomeFilter(wanted, count, excluded, 0);
    Range r = {4, x, z, w, h, yHeight / 4, 1};
    biomeIds = allocCache(&g, r);

    int64_t seed;
    for (seed = starting_seed;; seed++)
    {
        if (seed % 100 == 0)
        {
            call_seed_update();
        }
        if (checkForBiomes(&g, biomeIds, r, dimension, seed, filter, 1, NULL))
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
    Generator g;
    setupGenerator(&g, mcVersion, 0);
    applySeed(&g, 0, seed); // 0 = overworld
    Pos pos = getSpawn(&g);
    return &pos;
}

EMSCRIPTEN_KEEPALIVE
Pos *find_strongholds(int mcVersion, int64_t seed, int howMany)
{
    Generator g;
    StrongholdIter sh;
    Pos pos = initFirstStronghold(&sh, mcVersion, seed);
    setupGenerator(&g, mcVersion, 0);
    applySeed(&g, 0, seed);

    int i, N = howMany;
    Pos coords[howMany];
    for (i = 0; i < N; i++)
    {
        if (nextStronghold(&sh, &g) <= 0)
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
int64_t find_structures(int mcVersion, int structType, int x, int z, int range, int starting_seed, int dimension)
{
    Generator g;
    setupGenerator(&g, mcVersion, 0);

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
            applySeed(&g, dimension, seed);
            if (isViableStructurePos(structType, &g, p.x, p.z))
            {
                return seed;
            }
        }
    }
}

// EMSCRIPTEN_KEEPALIVE
// int64_t find_biomes_with_structure(int mcVersion, int structType, int wanted[], int count, int x, int z, int range, int starting_seed)
// {
//     setupGenerator(&g, mcVersion);
//     BiomeFilter filter;
//     filter = setupBiomeFilter(wanted, count);

//     int entry;
//     if (mcVersion >= MC_1_13)
//     {
//         entry = L_OCEAN_MIX_4;
//     }
//     else
//     {
//         entry = L_RIVER_MIX_4;
//     }
//     area = allocCache(&g.layers[entry], range / 2, range / 2);

//     int64_t seed;
//     int64_t lower48;
//     int range_fourth = range / 4;
//     int64_t tot = 0;
//     for (lower48 = starting_seed;; lower48++)
//     {
//         if (tot % 10000 == 0)
//         {
//             call_seed_update();
//         }
//         tot++;

//         Pos p;
//         if (!getStructurePos(structType, mcVersion, lower48, 0, 0, &p))
//             continue;

//         if ((p.x > (x + range)) || (p.z > (z + range)) || (p.x < (x - range)) || (p.z < (z - range)))
//             continue;

//         int64_t upper16;
//         for (upper16 = 0; upper16 < 0x10000; upper16++)
//         {
//             if (tot % 10000 == 0)
//             {
//                 call_seed_update();
//             }
//             tot++;
//             int64_t seed = lower48 | (upper16 << 48);
//             if (isViableStructurePos(structType, mcVersion, &g, seed, p.x, p.z))
//             {
//                 if (checkForBiomes(&g, entry, area, seed, x - range_fourth, z - range_fourth, range_fourth * 2, range_fourth * 2, filter, 1) > 0)
//                 {
//                     return seed;
//                 }
//             }
//         }
//     }
// }

EMSCRIPTEN_KEEPALIVE
Pos *get_structure_in_regions(int mcVersion, int structType, int64_t seed, int range, int dimension)
{
    Generator g;
    setupGenerator(&g, mcVersion, 0);
    applySeed(&g, dimension, seed);

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
            if (!isViableStructurePos(structType, &g, p.x, p.z))
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