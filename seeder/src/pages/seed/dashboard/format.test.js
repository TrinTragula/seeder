import { describe, it, expect } from 'vitest';
import { relativeTime, DIMENSION_LABELS } from './format';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

describe('relativeTime', () => {
    it('says "just now" under a minute, and for a clock that runs ahead', () => {
        expect(relativeTime(ago(0), NOW)).toBe('just now');
        expect(relativeTime(ago(59_999), NOW)).toBe('just now');
        expect(relativeTime(ago(-5 * MIN), NOW)).toBe('just now');
    });
    it('counts minutes under an hour', () => {
        expect(relativeTime(ago(MIN), NOW)).toBe('1 min ago');
        expect(relativeTime(ago(5 * MIN + 30_000), NOW)).toBe('5 min ago');
        expect(relativeTime(ago(59 * MIN), NOW)).toBe('59 min ago');
    });
    it('counts hours under a day', () => {
        expect(relativeTime(ago(H), NOW)).toBe('1 h ago');
        expect(relativeTime(ago(3 * H + 59 * MIN), NOW)).toBe('3 h ago');
        expect(relativeTime(ago(23 * H), NOW)).toBe('23 h ago');
    });
    it('counts days for a week', () => {
        expect(relativeTime(ago(D), NOW)).toBe('1 day ago');
        expect(relativeTime(ago(2 * D), NOW)).toBe('2 days ago');
        expect(relativeTime(ago(6 * D + 23 * H), NOW)).toBe('6 days ago');
    });
    it('gives the local date after that', () => {
        const iso = ago(30 * D);
        expect(relativeTime(iso, NOW)).toBe(new Date(iso).toLocaleDateString());
    });
    it('is empty for something that is not a date', () => {
        expect(relativeTime('yesterday-ish', NOW)).toBe('');
        expect(relativeTime(undefined, NOW)).toBe('');
    });
    it('defaults `now` to the current time', () => {
        expect(relativeTime(new Date().toISOString())).toBe('just now');
    });
});

describe('DIMENSION_LABELS', () => {
    it('names the three dimensions by their cubiomes id, as numbers or strings', () => {
        expect(DIMENSION_LABELS[0]).toBe('Overworld');
        expect(DIMENSION_LABELS[-1]).toBe('Nether');
        expect(DIMENSION_LABELS['-1']).toBe('Nether');
        expect(DIMENSION_LABELS[1]).toBe('End');
        expect(Object.keys(DIMENSION_LABELS).sort()).toEqual(['-1', '0', '1']);
    });
});
