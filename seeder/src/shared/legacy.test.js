import { describe, it, expect } from 'vitest';
import { resolveLegacyRedirect } from './legacy';
import { DEFAULT_VERSION, seedFromString } from '../util/seed';
import { OLD_VERSIONS, VERSIONS } from '../util/constants';

const paramsOf = (url) => new URLSearchParams(url.slice(url.indexOf('?')));

describe('resolveLegacyRedirect', () => {
    it('passes a version label through', () => {
        expect(resolveLegacyRedirect('?seed=42&version=1.18')).toBe('/seed/?seed=42&version=1.18&from=legacy');
    });

    it('resolves a legacy numeric version index to its label', () => {
        expect(OLD_VERSIONS[17]).toBe('1.17');
        expect(paramsOf(resolveLegacyRedirect('?seed=42&version=17')).get('version')).toBe('1.17');
        expect(paramsOf(resolveLegacyRedirect('?seed=42&version=16')).get('version')).toBe('1.16.5');
    });

    it('falls back to the default version for an unknown label', () => {
        expect(paramsOf(resolveLegacyRedirect('?seed=42&version=9.99')).get('version')).toBe(DEFAULT_VERSION);
        expect(paramsOf(resolveLegacyRedirect('?seed=42&version=banana')).get('version')).toBe(DEFAULT_VERSION);
    });

    it('falls back to the default version when none is given', () => {
        expect(paramsOf(resolveLegacyRedirect('?seed=42')).get('version')).toBe(DEFAULT_VERSION);
        expect(paramsOf(resolveLegacyRedirect('?seed=42&version=')).get('version')).toBe(DEFAULT_VERSION);
    });

    it('keeps every label of VERSIONS byte-identical', () => {
        for (const label of Object.keys(VERSIONS)) {
            expect(paramsOf(resolveLegacyRedirect(`?seed=1&version=${encodeURIComponent(label)}`)).get('version')).toBe(label);
        }
    });

    it('keeps 64-bit and negative seeds byte-identical', () => {
        const big = '8091867987493326313';
        expect(paramsOf(resolveLegacyRedirect(`?seed=${big}`)).get('seed')).toBe(big);
        expect(resolveLegacyRedirect(`?seed=${big}&version=26.3`)).toContain(`seed=${big}&`);
        expect(paramsOf(resolveLegacyRedirect('?seed=-9223372036854775808')).get('seed')).toBe('-9223372036854775808');
        expect(paramsOf(resolveLegacyRedirect('?seed=-1')).get('seed')).toBe('-1');
    });

    it('redirects to the canonical seed: sign, leading zeros and -0 normalised, out-of-range decimals hashed', () => {
        expect(paramsOf(resolveLegacyRedirect('?seed=%2B5')).get('seed')).toBe('5');
        expect(paramsOf(resolveLegacyRedirect('?seed=007')).get('seed')).toBe('7');
        expect(paramsOf(resolveLegacyRedirect('?seed=-0')).get('seed')).toBe('0');
        expect(paramsOf(resolveLegacyRedirect('?seed=18446744073709551615')).get('seed'))
            .toBe(String(seedFromString('18446744073709551615')));
        expect(resolveLegacyRedirect('?seed=007&version=1.18')).toBe('/seed/?seed=7&version=1.18&from=legacy');
    });

    it('keeps the Nether and End dimensions and drops anything else', () => {
        expect(paramsOf(resolveLegacyRedirect('?seed=42&dim=-1')).get('dim')).toBe('-1');
        expect(paramsOf(resolveLegacyRedirect('?seed=42&dim=1')).get('dim')).toBe('1');
        expect(paramsOf(resolveLegacyRedirect('?seed=42&dim=0')).has('dim')).toBe(false);
        expect(paramsOf(resolveLegacyRedirect('?seed=42&dim=7')).has('dim')).toBe(false);
        expect(paramsOf(resolveLegacyRedirect('?seed=42&dim=nether')).has('dim')).toBe(false);
    });

    it('builds /seed/?seed=…&version=…[&dim=…]&from=legacy in that order', () => {
        const url = resolveLegacyRedirect('?version=1.18&dim=-1&seed=42');
        expect(url).toBe('/seed/?seed=42&version=1.18&dim=-1&from=legacy');
        expect(url.startsWith('/seed/?seed=')).toBe(true);
        expect(url.endsWith('&from=legacy')).toBe(true);
    });

    it('ignores unrelated parameters', () => {
        expect(resolveLegacyRedirect('?seed=42&version=1.18&utm_source=x')).toBe('/seed/?seed=42&version=1.18&from=legacy');
    });

    it('returns null when there is no seed', () => {
        expect(resolveLegacyRedirect('')).toBeNull();
        expect(resolveLegacyRedirect('?')).toBeNull();
        expect(resolveLegacyRedirect('?version=1.18')).toBeNull();
    });

    it('returns null for a non-numeric seed (the seed page hashes those itself)', () => {
        expect(resolveLegacyRedirect('?seed=hello')).toBeNull();
        expect(resolveLegacyRedirect('?seed=12abc')).toBeNull();
        expect(resolveLegacyRedirect('?seed=')).toBeNull();
        expect(resolveLegacyRedirect('?seed=1.5')).toBeNull();
        expect(resolveLegacyRedirect('?seed=%20')).toBeNull();
        expect(resolveLegacyRedirect('?seed=%2B-5')).toBeNull();
    });

    it('trims whitespace around the seed', () => {
        expect(paramsOf(resolveLegacyRedirect('?seed=%2042%20')).get('seed')).toBe('42');
        expect(paramsOf(resolveLegacyRedirect('?seed=+42+')).get('seed')).toBe('42');
    });
});
