import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import AdFeed from './AdFeed';

const range = (n) => Array.from({ length: n }, (_, i) => `seed-${i + 1}`);
// The rendered sequence as 'item N' / 'ad' tokens, in DOM order.
const sequence = (container) => [...container.children].map((el) => (el.classList.contains('ad') ? 'ad' : el.textContent));
const renderFeed = (items, props = {}) =>
    render(<AdFeed items={items} renderItem={(item) => <p>{item}</p>} {...props} />);

// jsdom lays nothing out: without a width GoogleAd never pushes, whatever the slot.
const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const setOffsetWidth = (px) => Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => px, configurable: true });

beforeEach(() => { delete window.adsbygoogle; });
afterEach(() => { Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor); });

describe('AdFeed', () => {
    it('puts an in-feed unit after items 5 and 10 of 12', () => {
        const { container } = renderFeed(range(12));
        const seq = sequence(container);
        expect(seq.filter((t) => t === 'ad')).toHaveLength(2);
        expect(seq.indexOf('ad')).toBe(5);                 // right after seed-5
        expect(seq.lastIndexOf('ad')).toBe(11);            // right after seed-10 (+1 for the first ad)
        expect(seq.filter((t) => t !== 'ad')).toEqual(range(12));
    });

    it('places no unit in a short list', () => {
        const { container } = renderFeed(range(3));
        expect(container.querySelectorAll('.ad')).toHaveLength(0);
        expect(sequence(container)).toEqual(range(3));
    });

    it('never places more than two units', () => {
        const { container } = renderFeed(range(15));
        expect(container.querySelectorAll('.ad')).toHaveLength(2);
        expect(sequence(container).at(-1)).toBe('seed-15');
    });

    it('hands renderItem each item with its index', () => {
        const renderItem = vi.fn((item) => <p>{item}</p>);
        render(<AdFeed items={['a', 'b', 'c']} renderItem={renderItem} />);
        expect(renderItem.mock.calls).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    });

    it('uses fluid in-feed units, 120 px high; a placeholder slot shows the dev placeholder', () => {
        const { container } = renderFeed(range(5), { slot: 'TODO_AD_SLOT_FINDER_INFEED' });
        const ad = container.querySelector('.ad');
        expect(ad).toHaveClass('ad--placeholder');
        expect(ad).toHaveStyle({ minHeight: '120px' });
        expect(container.querySelector('ins')).toBeNull();
    });

    it('a placeholder slot never pushes, even laid out and with room for every unit', () => {
        setOffsetWidth(300);
        const { container } = renderFeed(range(12), { slot: 'TODO_AD_SLOT_FINDER_INFEED' });
        expect(container.querySelectorAll('.ad--placeholder')).toHaveLength(2);
        expect(container.querySelector('ins')).toBeNull();
        expect(window.adsbygoogle).toBeUndefined();
    });

    it('a real slot, laid out, pushes once per unit', () => {
        setOffsetWidth(300);
        const { container } = renderFeed(range(12), { slot: '123' });
        expect(container.querySelectorAll('ins.adsbygoogle')).toHaveLength(2);
        expect(window.adsbygoogle).toEqual([{}, {}]);
    });

    it('honours every / max / slot / layoutKey', () => {
        const { container } = renderFeed(range(9), { every: 2, max: 3, slot: '123', layoutKey: 'key' });
        const units = container.querySelectorAll('ins.adsbygoogle');
        expect(units).toHaveLength(3);
        for (const ins of units) {
            expect(ins).toHaveAttribute('data-ad-slot', '123');
            expect(ins).toHaveAttribute('data-ad-format', 'fluid');
            expect(ins).toHaveAttribute('data-ad-layout-key', 'key');
        }
    });
});
