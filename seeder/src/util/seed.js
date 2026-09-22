import { VERSIONS, OLD_VERSIONS } from './constants';

// The Minecraft version used when the URL carries none (or an unknown one).
// Update this when a new version becomes the default (see UPDATING.MD).
export const DEFAULT_VERSION = "26.3";

// Finder range presets. The engine works in biome cells (1 cell = 4 blocks), so
// the values are blocks / 4.
export const RANGE_OPTIONS = [
    { value: Math.floor(100 / 4), label: "<100 blocks" },
    { value: Math.floor(300 / 4), label: "<300 blocks" },
    { value: Math.floor(500 / 4), label: "<500 blocks" },
    { value: Math.floor(750 / 4), label: "<750 blocks" },
    { value: Math.floor(1000 / 4), label: "<1k blocks" },
    { value: Math.floor(2000 / 4), label: "<2k blocks (SLOW!)" }
];

export const isNumeric = (str) => {
    if (typeof str !== "string") return false;
    return !isNaN(str) && !isNaN(parseFloat(str));
};

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

// ?seed= from a share URL: an integer is used verbatim (kept as a string so 64-bit
// seeds survive), anything else is hashed exactly like text typed in the seed box.
export const getInitialSeed = (urlSeed) => {
    if (urlSeed == null || String(urlSeed).trim() === "") return getRandomSeed();
    const text = String(urlSeed).trim();
    return /^-?\d+$/.test(text) ? text : String(seedFromString(text));
};

// Old share URLs carried the numeric index of OLD_VERSIONS; newer ones carry the label.
export const getInitialVersion = (urlVersion) => {
    let version = urlVersion;
    if (isNumeric(version) && !version.includes(".")) {
        version = OLD_VERSIONS[Number.parseInt(version)];
    }
    return version && VERSIONS[version] ? VERSIONS[version] : VERSIONS[DEFAULT_VERSION];
};
