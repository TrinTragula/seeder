/*
 * The "?" tips' copy (HelpTip), one place for every page: { label, text }. `label` is
 * the button's accessible name; on the seed page no label may contain "seed"
 * (getByLabel('Seed') matches names by substring), help.test.js checks the ones used there.
 */
export const HELP = {
    layouts: {
        label: 'About layouts',
        text: 'Structure positions depend only on the lower 48 bits of a seed. One layout is one such value, shared by 65,536 seeds. '
            + 'The search rules out layouts with fast maths first and tests biomes only on the ones that fit; it gives up after the number shown. '
            + '"Seeds checked" counts the full seeds actually tested.',
    },
    seedsScanned: {
        label: 'About seeds scanned',
        text: 'Each candidate is one full seed, generated and checked against your biomes. '
            + 'The search gives up after the number shown, so a run always ends.',
    },
    range: {
        label: 'About the distance',
        text: 'How far from 0,0, in blocks, the biomes and structures may be. Bigger ranges match more seeds but are slower to check.',
    },
    biomeHeight: {
        label: 'About the Y level',
        text: 'From 1.18, biomes change with height: caves underground, peaks up high. This is the Y level where biomes are checked.',
    },
    shadow: {
        label: 'About the shadow',
        text: 'Up to 1.17, every seed has a twin that generates the same biomes. Structures and terrain differ.',
    },
    approxStrongholds: {
        label: 'About approximate positions',
        text: 'From 1.19.3 the exact spot needs a biome search per stronghold. Listing all 128 skips it, '
            + 'so each one is within 112 blocks of the position shown.',
    },
    quadWitchFarm: {
        label: 'About quad witch farms',
        text: 'Four witch huts close enough that one AFK spot is within 128 blocks of all of them, so a single farm spawns witches in all four. '
            + 'Each hut sits in its own region, the 512-block grid cell a hut can spawn in.',
    },
    slimeChunks: {
        label: 'About slime chunks',
        text: 'A chunk is a 16×16-block column of the world. In a slime chunk, slimes spawn below Y 40 at any light level.',
    },
    chunkGrid: {
        label: 'About chunks',
        text: 'Draws the borders of the 16×16-block chunks the world is built from. Farms and slime chunks line up with them.',
    },
    netherCoords: {
        label: 'About Nether coordinates',
        text: 'One Nether block equals eight Overworld blocks. Build a portal at these coordinates to link it to this position.',
    },
};

// The tips the seed page shows (its labels must avoid "seed").
export const SEED_PAGE_HELP = ['biomeHeight', 'shadow', 'approxStrongholds', 'quadWitchFarm', 'slimeChunks', 'chunkGrid', 'netherCoords'];
