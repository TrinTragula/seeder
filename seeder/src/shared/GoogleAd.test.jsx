import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { StrictMode } from 'react';
import GoogleAd from './GoogleAd';
import { AD_CLIENT, AD_FALLBACK_MS, AD_SLOT_RESPONSIVE } from './ads';
import { COFFEE_URL, PAYPAL_BUTTON_ID } from './Footer';

// jsdom lays nothing out, so offsetWidth is 0 unless a test says otherwise.
const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const setOffsetWidth = (px) => Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => px, configurable: true });

beforeEach(() => { delete window.adsbygoogle; });
afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
    vi.unstubAllEnvs();
});

describe('GoogleAd', () => {
    it('renders an AdSense <ins> unit for the given slot with the responsive auto format', () => {
        setOffsetWidth(300);
        const { container } = render(<GoogleAd slot={AD_SLOT_RESPONSIVE} />);
        const ins = container.querySelector('ins.adsbygoogle');
        expect(ins).toHaveAttribute('data-ad-client', AD_CLIENT);
        expect(ins).toHaveAttribute('data-ad-slot', '4456541019');
        expect(ins).toHaveAttribute('data-ad-format', 'auto');
        expect(ins).toHaveAttribute('data-full-width-responsive', 'true');
        expect(ins).not.toHaveAttribute('data-ad-layout-key');
        expect(ins).toHaveStyle({ display: 'block' });
    });

    it('takes its client id from AD_CLIENT', () => {
        const { container } = render(<GoogleAd slot="1" />);
        expect(container.querySelector('ins')).toHaveAttribute('data-ad-client', 'ca-pub-2625181666337030');
    });

    it('requests one ad per mount when the unit is laid out', () => {
        setOffsetWidth(300);
        render(<GoogleAd slot="1" />);
        expect(window.adsbygoogle).toEqual([{}]);
    });

    it('does not request again on a re-render', () => {
        setOffsetWidth(300);
        const { rerender } = render(<GoogleAd slot="1" />);
        rerender(<GoogleAd slot="1" minHeight={250} />);
        rerender(<GoogleAd slot="1" className="x" />);
        expect(window.adsbygoogle).toHaveLength(1);
    });

    it('requests once under StrictMode, whose effects run twice', () => {
        setOffsetWidth(300);
        render(<StrictMode><GoogleAd slot="1" /></StrictMode>);
        expect(window.adsbygoogle).toHaveLength(1);
    });

    it('a new mount is a new <ins>, and is requested again', () => {
        setOffsetWidth(300);
        const first = render(<GoogleAd slot="1" />);
        const firstIns = first.container.querySelector('ins');
        first.unmount();
        const second = render(<GoogleAd slot="1" />);
        expect(second.container.querySelector('ins')).not.toBe(firstIns);
        expect(window.adsbygoogle).toHaveLength(2);
    });

    it('does not request an ad for a unit with no width (hidden or not yet laid out)', () => {
        setOffsetWidth(0);
        render(<GoogleAd slot="1" />);
        expect(window.adsbygoogle).toBeUndefined();
    });

    it('fluid (in-feed) units carry their layout key and are not full-width responsive', () => {
        const { container } = render(<GoogleAd slot="1" format="fluid" layoutKey="-6t+ed+2i-1n-4w" />);
        const ins = container.querySelector('ins');
        expect(ins).toHaveAttribute('data-ad-format', 'fluid');
        expect(ins).toHaveAttribute('data-ad-layout-key', '-6t+ed+2i-1n-4w');
        expect(ins).not.toHaveAttribute('data-full-width-responsive');
    });

    it('reserves minHeight (100 px by default) and adds className to the .ad wrapper', () => {
        const { container, rerender } = render(<GoogleAd slot="1" />);
        expect(container.firstChild).toHaveClass('ad');
        expect(container.firstChild).toHaveStyle({ minHeight: '100px' });
        rerender(<GoogleAd slot="1" minHeight={250} className="ad--wide" />);
        expect(container.firstChild).toHaveClass('ad', 'ad--wide');
        expect(container.firstChild).toHaveStyle({ minHeight: '250px' });
    });

    it('a placeholder slot never pushes and shows a dashed box in development', () => {
        setOffsetWidth(300);
        const { container } = render(<GoogleAd slot="TODO_AD_SLOT_FINDER_INFEED" minHeight={120} />);
        expect(container.querySelector('ins')).toBeNull();
        const box = container.querySelector('.ad--placeholder');
        expect(box).toHaveTextContent('Ad (slot not configured)');
        expect(box).toHaveStyle({ minHeight: '120px' });
        expect(window.adsbygoogle).toBeUndefined();
    });

    it('a placeholder slot renders nothing in production', () => {
        vi.stubEnv('DEV', false);
        setOffsetWidth(300);
        for (const slot of ['TODO_AD_SLOT_FINDER_INFEED', '', undefined]) {
            const { container, unmount } = render(<GoogleAd slot={slot} />);
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
        expect(window.adsbygoogle).toBeUndefined();
    });

    it('a slot that turns from a placeholder into a real id renders a fresh <ins> and pushes exactly once', () => {
        setOffsetWidth(300);
        const { container, rerender } = render(<GoogleAd slot="TODO_x" />);
        expect(container.querySelector('ins')).toBeNull();
        expect(window.adsbygoogle).toBeUndefined();
        rerender(<GoogleAd slot="123" />);
        const ins = container.querySelector('ins.adsbygoogle');
        expect(ins).toHaveAttribute('data-ad-slot', '123');
        expect(container.querySelector('.ad--placeholder')).toBeNull();
        expect(window.adsbygoogle).toEqual([{}]);
        rerender(<GoogleAd slot="123" minHeight={200} />);
        expect(window.adsbygoogle).toHaveLength(1);
    });

    it('swallows an ad script that throws on push', () => {
        setOffsetWidth(300);
        window.adsbygoogle = { push: () => { throw new Error('blocked'); } };
        expect(() => render(<GoogleAd slot="1" />)).not.toThrow();
    });
});

describe('GoogleAd when no ad comes', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    const note = () => screen.queryByText(/If it helped you, you can support it/);
    // AdSense writes data-ad-status on the <ins>; the MutationObserver reports it in a microtask.
    const status = async (container, value) => {
        container.querySelector('ins').setAttribute('data-ad-status', value);
        await act(async () => { await Promise.resolve(); });
    };

    it(`a slot still not filled after ${AD_FALLBACK_MS} ms (blocked, no script) shows the support box in its place`, () => {
        setOffsetWidth(300);
        const { container } = render(<GoogleAd slot="1" minHeight={120} />);
        act(() => { vi.advanceTimersByTime(AD_FALLBACK_MS - 1); });
        expect(note()).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(note()).toBeInTheDocument();
        const box = container.firstChild;
        expect(box).toHaveClass('ad', 'ad--empty');
        expect(box).toHaveStyle({ minHeight: '120px' });
        // Text links, no third-party images an ad blocker may drop as well.
        expect(screen.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', COFFEE_URL);
        const paypal = screen.getByRole('button', { name: 'Donate with PayPal' });
        expect(paypal.form.querySelector('[name="hosted_button_id"]')).toHaveValue(PAYPAL_BUTTON_ID);
        expect(box.querySelector('img')).toBeNull();
    });

    it('an unfilled slot shows it at once; an ad that fills later takes the space back', async () => {
        setOffsetWidth(300);
        const { container } = render(<GoogleAd slot="1" />);
        await status(container, 'unfilled');
        expect(note()).toBeInTheDocument();
        await status(container, 'filled');
        expect(note()).toBeNull();
        expect(container.firstChild).not.toHaveClass('ad--empty');
    });

    it('a filled slot never shows it, and an unmounted one sets no timer', async () => {
        setOffsetWidth(300);
        const { container, unmount } = render(<GoogleAd slot="1" />);
        await status(container, 'filled');
        act(() => { vi.advanceTimersByTime(AD_FALLBACK_MS * 2); });
        expect(note()).toBeNull();
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a placeholder slot sets no fallback timer and never shows the support box', () => {
        setOffsetWidth(300);
        const { unmount } = render(<GoogleAd slot="TODO_x" />);
        expect(vi.getTimerCount()).toBe(0);
        act(() => { vi.advanceTimersByTime(AD_FALLBACK_MS * 2); });
        expect(note()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        unmount();
    });

    it('a new slot starts over: the previous slot\'s support box goes away until the new one times out too', () => {
        setOffsetWidth(300);
        const { container, rerender } = render(<GoogleAd slot="1" />);
        act(() => { vi.advanceTimersByTime(AD_FALLBACK_MS); });
        expect(note()).toBeInTheDocument();
        rerender(<GoogleAd slot="2" />);
        expect(note()).toBeNull();
        expect(container.firstChild).not.toHaveClass('ad--empty');
        expect(container.querySelector('ins')).toHaveAttribute('data-ad-slot', '2');
        act(() => { vi.advanceTimersByTime(AD_FALLBACK_MS); });
        expect(note()).toBeInTheDocument();
    });

    it('the support box never names "Seed" (the seed page keeps that label for its seed box)', () => {
        render(<GoogleAd slot="1" />);
        act(() => { vi.advanceTimersByTime(AD_FALLBACK_MS); });
        expect(screen.queryAllByLabelText(/seed/i)).toHaveLength(0);
        for (const el of [...screen.getAllByRole('link'), ...screen.getAllByRole('button')]) {
            expect(el.textContent).not.toMatch(/seed/i);
        }
    });
});
