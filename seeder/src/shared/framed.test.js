import { describe, it, expect } from 'vitest';
import { isFramedElsewhere } from './framed';

const frame = (top) => {
    const win = { location: { origin: 'https://mcseeder.com' } };
    win.self = win;
    win.top = top ?? win;
    return win;
};

describe('isFramedElsewhere', () => {
    it('is false for a top-level page', () => {
        expect(isFramedElsewhere(frame())).toBe(false);
        expect(isFramedElsewhere()).toBe(false);
    });

    it('is true inside a frame on another site (reading its location throws)', () => {
        const top = { get location() { throw new DOMException('Blocked a frame', 'SecurityError'); } };
        expect(isFramedElsewhere(frame(top))).toBe(true);
    });

    it('is true when the top page reports another origin', () => {
        expect(isFramedElsewhere(frame({ location: { origin: 'https://msseedmap.us' } }))).toBe(true);
    });

    it('is false inside a frame on our own origin', () => {
        expect(isFramedElsewhere(frame({ location: { origin: 'https://mcseeder.com' } }))).toBe(false);
    });
});
