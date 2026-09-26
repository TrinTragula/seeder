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

// Old share URLs carried the numeric index of OLD_VERSIONS; newer ones carry the label.
export const getInitialVersion = (urlVersion) => {
    let version = urlVersion;
    if (typeof version === "string" && /^\d+$/.test(version)) {
        version = OLD_VERSIONS[Number.parseInt(version)];
    }
    return version && VERSIONS[version] ? VERSIONS[version] : VERSIONS[DEFAULT_VERSION];
};
