import { VERSIONS } from '../../util/constants';

/*
 * Every text block of the landing. The version range is derived from VERSIONS, so a
 * Minecraft update never leaves the landing claiming an old "newest" version.
 */

// VERSIONS maps label -> cubiomes MCVersion int; the ints grow with the releases.
const byRelease = Object.keys(VERSIONS).sort((a, b) => VERSIONS[a] - VERSIONS[b]);
export const OLDEST_VERSION_LABEL = byRelease[0];
export const NEWEST_VERSION_LABEL = byRelease.at(-1);

// The h1 is the name, with the tagline under it. The tagline is also the og-card's
// (scripts/og-card.mjs checks).
export const HERO_NAME = 'Seeder';
export const HERO_TITLE = 'Minecraft seed map, finder & explorer';
// Also the page's description, og:description and twitter:description in index.html
// (content.test.js keeps them equal).
export const HERO_LEAD = 'Search and analyze any Minecraft seed. Discover biomes and structures, find seeds with the biomes you want. All in your browser!';
export const SEED_PLACEHOLDER = 'Seed number or text';
export const OPEN_MAP = 'Open map';
export const RANDOM_SEED_LINK = 'Open a random seed';
export const OWN_SEED_LABEL = 'or explore your own seed:';
export const SEED_HINT = 'Tip: in a world you already play, type /seed in the chat to get its seed.';
// Each label is followed by its version number, which the badge sets apart.
export const VERSION_BADGE = { app: 'Seeder:', game: 'Works up to Minecraft:' };

// The card images are captured from the real pages by `npm run shots`
// (scripts/landing-shots.mjs) and are 960×600.
export const CARDS = [
    {
        id: 'map',
        title: 'Seed map',
        text: 'Open a seed on an interactive biome map. Find spawn, strongholds and structures. In the Overworld, the Nether and the End. At any height.',
        image: '/img/landing/map.webp',
        alt: 'Biome map of a seed with its spawn, strongholds and villages marked',
        link: { href: '/seed/', label: 'Open the map' },
    },
    {
        id: 'finder',
        title: 'Advanced finder',
        text: 'Describe the world you want, with biomes and structures near the world centre, and get a list of seeds that match. Open, save and share them.',
        image: '/img/landing/finder.webp',
        alt: 'Finder results: seeds with a village near the world centre, each with a biome thumbnail',
        link: { href: '/finder/', label: 'Find your seed' },
    },
];

// Under the cards, only when this browser remembers something: the last seed opened
// and the saved worlds.
export const CONTINUE_TITLE = 'Open the last seed you looked up:';
export const continueLabel = (seed) => `Open Seed ${seed}`;
export const WORLDS_LABEL = 'Worlds you saved in this browser:';

export const FAQ_TITLE = 'FAQ';

// Answers are plain strings of 2-4 sentences (content.test.js counts them). A `link`
// turns the first occurrence of its text inside the answer into an anchor.
export const FAQ = [
    {
        question: 'What is a Minecraft seed?',
        answer: 'A seed is the number Minecraft starts from when it generates a world: the same seed on the same version always gives the same terrain, biomes and structures. You can type one when you create a world, as a number or as text, which the game turns into a number (Seeder does the same). In a world you already play, the /seed command shows it.',
        link: { text: 'A seed', href: 'https://minecraft.wiki/w/World_seed' },
    },
    {
        question: 'Does Seeder work for Bedrock Edition?',
        answer: "For biomes, yes. Seeder reproduces Java Edition's world generation, and from 1.18 a seed gives the same terrain and biomes on Bedrock, so the biome map works for Bedrock worlds too. Structures, strongholds and slime chunks are placed differently on Bedrock, so those markers only hold for Java.",
    },
    {
        question: 'Where does Seeder run?',
        answer: 'In your browser. The world generation comes from cubiomes, a C library compiled to WebAssembly, and runs on every core of your device. Nothing you type is uploaded! Searches use a lot of CPU, so your device may slow down while one runs.',
    },
    {
        question: 'Which Minecraft versions are supported?',
        answer: `Java Edition from ${OLDEST_VERSION_LABEL} to ${NEWEST_VERSION_LABEL}. Pick the version your world was created with: world generation changes between versions, so the same seed can look different on another one.`,
    },
    {
        question: 'Why are biome searches slow on 1.18 and later?',
        answer: 'Since 1.18, Minecraft builds biomes from 3-D noise instead of the old 2-D layers, which makes checking a seed for a biome about a hundred times more expensive: within 300 blocks, one core checks about a dozen seeds per second. Keep the biome range small, or better, add a structure: only seeds that already have it get their biomes checked.',
    },
    {
        question: 'Can I trust Seeder? Who pays for it?',
        answer: "Nothing leaves your browser! Google Analytics counts visits and Google AdSense shows ads, but that's it, everything else is done in your browser. Donations through the buttons at the bottom of the page help pay for it, and the About page tells the rest.",
        link: { text: 'About page', href: '/about/' },
    },
];

// The donate buttons are the footer's, on every page: this paragraph only points at them.
export const SUPPORT = {
    title: 'Support Seeder!',
    text: 'Seeder is free, paid for by ads and by donations: the PayPal and Buy Me a Coffee buttons are at the bottom of every page. The code is open source on GitHub.',
    link: { text: 'on GitHub', href: 'https://github.com/TrinTragula/seeder' },
};
