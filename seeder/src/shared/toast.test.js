import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TOAST_MS, resetToastForTests, showToast } from './toast';

const regions = () => document.querySelectorAll('.toast');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    vi.useRealTimers();
    resetToastForTests();
});

describe('showToast', () => {
    it('shows the message in one polite live region, then hides it', () => {
        showToast('Copied to clipboard');
        const [el] = regions();
        expect(el).toHaveAttribute('role', 'status');
        expect(el).toHaveAttribute('aria-live', 'polite');
        expect(el.hidden).toBe(false);
        expect(el).toHaveTextContent('Copied to clipboard');
        vi.advanceTimersByTime(TOAST_MS - 1);
        expect(el.hidden).toBe(false);
        vi.advanceTimersByTime(1);
        expect(el.hidden).toBe(true);
        expect(el).toHaveTextContent('');
    });

    it('a new message replaces the current one and restarts the timer; one region only', () => {
        showToast('one');
        vi.advanceTimersByTime(TOAST_MS - 100);
        showToast('two');
        expect(regions()).toHaveLength(1);
        expect(regions()[0]).toHaveTextContent('two');
        vi.advanceTimersByTime(TOAST_MS - 1);
        expect(regions()[0].hidden).toBe(false);
        vi.advanceTimersByTime(1);
        expect(regions()[0].hidden).toBe(true);
    });

    it('comes back after the region was removed from the document', () => {
        showToast('one');
        regions()[0].remove();
        showToast('two');
        expect(regions()).toHaveLength(1);
        expect(regions()[0]).toHaveTextContent('two');
    });
});
