import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import GoogleAd from './GoogleAd';

const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const setOffsetWidth = (px) => Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => px, configurable: true });

beforeEach(() => { delete window.adsbygoogle; });
afterEach(() => { Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor); });

describe('GoogleAd', () => {
    it('renders an AdSense <ins> unit for the given slot with the responsive auto format', () => {
        setOffsetWidth(300);
        const { container } = render(<GoogleAd adSlot="4456541019" style={{ margin: '6px' }} />);
        const ins = container.querySelector('ins.adsbygoogle');
        expect(ins).toHaveAttribute('data-ad-client', 'ca-pub-2625181666337030');
        expect(ins).toHaveAttribute('data-ad-slot', '4456541019');
        expect(ins).toHaveAttribute('data-ad-format', 'auto');
        expect(ins).toHaveAttribute('data-full-width-responsive', 'true');
        expect(container.firstChild).toHaveStyle({ margin: '6px', overflow: 'hidden' });
    });
    it('requests an ad once on mount when the unit is laid out', () => {
        setOffsetWidth(300);
        const { rerender } = render(<GoogleAd adSlot="1" />);
        rerender(<GoogleAd adSlot="1" />);
        expect(window.adsbygoogle).toEqual([{}]);
    });
    it('does not request an ad for a unit with no width (hidden or not yet laid out)', () => {
        setOffsetWidth(0);
        render(<GoogleAd adSlot="1" />);
        expect(window.adsbygoogle).toBeUndefined();
    });
    it('accepts a custom ad format', () => {
        setOffsetWidth(300);
        const { container } = render(<GoogleAd adSlot="1" adFormat="fluid" />);
        expect(container.querySelector('ins')).toHaveAttribute('data-ad-format', 'fluid');
    });
});
