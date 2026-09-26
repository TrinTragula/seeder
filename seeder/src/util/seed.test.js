import { describe, it, expect } from 'vitest';
import { seedFromString, canonicalSeed, getInitialVersion, getRandomSeed, DEFAULT_VERSION } from './seed';
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

describe('canonicalSeed (Minecraft parses a long, else hashes the text)', () => {
    it.each([
        ['9223372036854775807', '9223372036854775807'],
        ['-9223372036854775808', '-9223372036854775808'],
        ['8091867987493326313', '8091867987493326313'],
        ['+5', '5'],
        ['007', '7'],
        ['-007', '-7'],
        ['-0', '0'],
        ['+0', '0'],
        [' 42 ', '42'],
        ['hello', '99162322'],
    ])('%j -> %j', (text, seed) => {
        expect(canonicalSeed(text)).toBe(seed);
    });
    it.each(['9223372036854775808', '-9223372036854775809', '18446744073709551615', '99999999999999999999', '1.5', '12abc', '+-5', '1e3', '0x10'])
        ('hashes %j, which Long.parseLong refuses', (text) => {
            expect(canonicalSeed(text)).toBe(String(javaHashCode(text)));
        });
    it('hashes the trimmed text', () => {
        expect(canonicalSeed('  hello ')).toBe('99162322');
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
        for (const bad of [undefined, '', 'nope', '999', '1.2.3.4', '1e3', '0x10', '1e1', ' 17', '17.0', '+17', '-1']) expect(getInitialVersion(bad)).toBe(VERSIONS[DEFAULT_VERSION]);
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
