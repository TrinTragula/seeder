import { describe, it, expect } from 'vitest';
import { seedFromString, isNumeric, getInitialSeed, getInitialVersion, getRandomSeed, RANGE_OPTIONS, DEFAULT_VERSION } from './seed';
import { VERSIONS, OLD_VERSIONS } from './constants';

// Java's String.hashCode, computed with BigInt so it cannot share bugs with the implementation.
const javaHashCode = (s) => {
    let h = 0n;
    for (const ch of s) h = (31n * h + BigInt(ch.charCodeAt(0))) & 0xFFFFFFFFn;
    return Number(h >= 0x80000000n ? h - 0x100000000n : h);
};

describe('seedFromString (Minecraft text seeds)', () => {
    it('matches Java String.hashCode for known values', () => {
        expect(seedFromString('hello')).toBe(99162322);
        expect(seedFromString('')).toBe(0);
        expect(seedFromString('a')).toBe(97);
    });
    it.each(['minecraft', 'Herobrine', 'The quick brown fox jumps over the lazy dog', 'ünïcödé ✓', '1234567890123456789012345678901234567890'])
        ('wraps to a signed 32-bit int like Java for %j', (s) => {
            expect(seedFromString(s)).toBe(javaHashCode(s));
        });
    it('produces negative hashes when the int overflows', () => {
        expect(seedFromString('polygenelubricants')).toBeLessThan(0);   // classic Integer.MIN_VALUE example
        expect(seedFromString('polygenelubricants')).toBe(-2147483648);
    });
});

describe('isNumeric', () => {
    it.each(['0', '42', '-7', '1.5', ' 3 ', '8091867987493326313'])('accepts %j', (s) => expect(isNumeric(s)).toBe(true));
    it.each(['', 'abc', '12abc', 'NaN', undefined, null, 42])('rejects %j', (s) => expect(isNumeric(s)).toBe(false));
});

describe('getInitialSeed (the ?seed= URL parameter)', () => {
    it('keeps a numeric seed verbatim, including 64-bit values that Number would round', () => {
        expect(getInitialSeed('123')).toBe('123');
        expect(getInitialSeed('-42')).toBe('-42');
        expect(getInitialSeed('8091867987493326313')).toBe('8091867987493326313');
    });
    it('falls back to a random seed when the parameter is missing', () => {
        for (const missing of [undefined, null, '', '   ']) {
            const seed = getInitialSeed(missing);
            expect(seed).toMatch(/^-?\d+$/);
        }
    });
    it('hashes a non-numeric parameter like text typed in the seed box', () => {
        expect(getInitialSeed('hello')).toBe('99162322');
        expect(getInitialSeed('12abc')).toBe(String(seedFromString('12abc')));
        expect(getInitialSeed('1.5')).toBe(String(seedFromString('1.5')));
        expect(getInitialSeed(' 42 ')).toBe('42');
    });
});

describe('getInitialVersion (the ?version= URL parameter)', () => {
    it('resolves a version label to its cubiomes int', () => {
        expect(getInitialVersion('1.21.11')).toBe(VERSIONS['1.21.11']);
        expect(getInitialVersion('Beta 1.7')).toBe(VERSIONS['Beta 1.7']);
    });
    it('treats a dotted numeric string as a label, not as a legacy index', () => {
        expect(getInitialVersion('26.3')).toBe(VERSIONS['26.3']);
        expect(getInitialVersion('1.18')).toBe(VERSIONS['1.18']);
    });
    it('maps legacy numeric share URLs through OLD_VERSIONS', () => {
        expect(getInitialVersion('17')).toBe(VERSIONS['1.17']);
        expect(getInitialVersion('0')).toBe(VERSIONS['1.0']);
        expect(getInitialVersion('18')).toBe(VERSIONS['1.18']);
    });
    it.each(Object.entries(OLD_VERSIONS))('legacy index %s (%s) restores a version other than the default', (index, label) => {
        const resolved = getInitialVersion(index);
        expect(resolved, `?version=${index} (${label}) falls back to the default version`).not.toBe(VERSIONS[DEFAULT_VERSION]);
        expect(Object.keys(VERSIONS).find((k) => VERSIONS[k] === resolved)).toMatch(new RegExp('^' + label.replaceAll('.', '\\.') + '(\\.\\d+)?$'));
    });
    it('falls back to the default version for unknown or missing values', () => {
        expect(DEFAULT_VERSION in VERSIONS).toBe(true);
        for (const bad of [undefined, '', 'nope', '999', '1.2.3.4']) expect(getInitialVersion(bad)).toBe(VERSIONS[DEFAULT_VERSION]);
    });
});

describe('getRandomSeed', () => {
    it('returns an integer string within ±2^32', () => {
        for (let i = 0; i < 200; i++) {
            const s = getRandomSeed();
            expect(s).toMatch(/^-?\d+$/);
            const n = Number(s);
            expect(n).toBeGreaterThanOrEqual(-4_294_967_296);
            expect(n).toBeLessThanOrEqual(4_294_967_296);
        }
    });
    it('varies between calls', () => {
        expect(new Set(Array.from({ length: 20 }, getRandomSeed)).size).toBeGreaterThan(1);
    });
});

describe('RANGE_OPTIONS', () => {
    it('stores blocks / 4 (biome cells) for each preset', () => {
        expect(RANGE_OPTIONS.map((o) => o.value)).toEqual([25, 75, 125, 187, 250, 500]);
        expect(RANGE_OPTIONS.map((o) => o.label)).toEqual(['<100 blocks', '<300 blocks', '<500 blocks', '<750 blocks', '<1k blocks', '<2k blocks (SLOW!)']);
    });
});
