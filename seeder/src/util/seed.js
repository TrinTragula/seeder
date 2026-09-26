import { VERSIONS, OLD_VERSIONS } from './constants';

// The Minecraft version used when the URL carries none (or an unknown one).
// Update this when a new version becomes the default (see UPDATING.MD).
export const DEFAULT_VERSION = "26.3";

// Random seeds stay within ±2^32 so they read nicely; the engine accepts any 64-bit seed.
export const getRandomSeed = () => "" + Math.floor(-4_294_967_296 + Math.random() * 8_589_934_593);

// Minecraft hashes non-numeric seed text with Java's String.hashCode.
export const seedFromString = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h;
};

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// The seed Minecraft Java uses for typed text, as a canonical decimal string: an
// integer that fits a signed 64-bit long (Long.parseLong: optional sign, leading
// zeros allowed) is that number, anything else - "1.5", "hello", a decimal outside
// the long range - is its String.hashCode. The caller decides what empty means.
export const canonicalSeed = (text) => {
    const trimmed = String(text).trim();
    if (/^[+-]?\d+$/.test(trimmed)) {
        const n = BigInt(trimmed);
        if (n >= INT64_MIN && n <= INT64_MAX) return String(n);
    }
    return String(seedFromString(trimmed));
};

// The Large Biomes world type exists from 1.3 and changes only the Overworld (cubiomes
// ignores it in Beta, before 1.3, in the Nether and in the End).
export const LARGE_BIOMES_FROM = VERSIONS['1.3'];
export const supportsLargeBiomes = (mcVersion, dimension = 0) => mcVersion >= LARGE_BIOMES_FROM && dimension === 0;

// The version int the engine takes for a world: the plain MCVersion for a Default world,
// MCVersion | 1 << 16 for a Large Biomes one (cubiomes-mods/api.c unpacks it). It exists
// only on the way to the engine: URLs, storage and VERSIONS hold the plain version and a
// boolean, and the version probes (GET_VERSION_SUPPORT) take the plain version. Pass the
// request's dimension where one applies, so the Nether and End keep one cache key; leave
// it out for find_seeds, whose hits in every dimension carry the Overworld spawn.
export const LARGE_BIOMES_FLAG = 1 << 16;

// The World type control (seed page and finder): value = largeBiomes.
export const WORLD_TYPE_OPTIONS = [
    { value: false, label: 'Default' },
    { value: true, label: 'Large Biomes' },
];
// Why the control is disabled, or null when it is not. In the Nether and the End the
// choice is kept (it is still that world), before 1.3 the world is Default.
export const worldTypeHint = (mcVersion, dimension = 0) => {
    if (mcVersion < LARGE_BIOMES_FROM) return 'Large Biomes starts in 1.3.';
    if (dimension === -1) return 'No effect in the Nether.';
    if (dimension === 1) return 'No effect in the End.';
    return null;
};
export const engineVersion = (mcVersion, largeBiomes, dimension = 0) =>
    (largeBiomes && supportsLargeBiomes(mcVersion, dimension) ? mcVersion | LARGE_BIOMES_FLAG : mcVersion);

// Old share URLs carried the numeric index of OLD_VERSIONS; newer ones carry the label.
export const getInitialVersion = (urlVersion) => {
    let version = urlVersion;
    if (typeof version === "string" && /^\d+$/.test(version)) {
        version = OLD_VERSIONS[Number.parseInt(version)];
    }
    return version && VERSIONS[version] ? VERSIONS[version] : VERSIONS[DEFAULT_VERSION];
};
