import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { copyToClipboard, useDebounce, toHHMMSS } from './functions';

describe('toHHMMSS', () => {
    it.each([
        [0, '0s'], [999, '0s'], [1000, '1s'], [59_999, '59s'], [60_000, '1m 0s'], [61_000, '1m 1s'],
        [3_599_000, '59m 59s'], [3_600_000, '1h 0m 0s'], [3_661_000, '1h 1m 1s'], [90_061_000, '25h 1m 1s'],
    ])('%i ms -> %s', (ms, text) => {
        expect(toHHMMSS(ms)).toBe(text);
    });
});

describe('copyToClipboard', () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    afterEach(() => {
        if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
        else delete navigator.clipboard;
        Object.defineProperty(window, 'isSecureContext', { value: undefined, configurable: true });
        delete document.execCommand;
    });
    it('uses the async clipboard API in a secure context', async () => {
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        await copyToClipboard('hello');
        expect(writeText).toHaveBeenCalledWith('hello');
    });
    it('falls back to a hidden textarea + execCommand elsewhere, cleaning up afterwards', async () => {
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        document.execCommand = vi.fn(() => {
            const ta = document.querySelector('textarea');
            expect(ta.value).toBe('hello');
            expect(document.activeElement).toBe(ta);
            return true;
        });
        await expect(copyToClipboard('hello')).resolves.toBeUndefined();
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
    });
    it('rejects when execCommand reports failure', async () => {
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        document.execCommand = vi.fn(() => false);
        await expect(copyToClipboard('hello')).rejects.toBeUndefined();
        expect(document.querySelector('textarea')).toBeNull();
    });
    it('rejects and still removes the textarea when execCommand throws', async () => {
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        const failure = new Error('not allowed');
        document.execCommand = vi.fn(() => { throw failure; });
        await expect(copyToClipboard('hello')).rejects.toBe(failure);
        expect(document.querySelector('textarea')).toBeNull();
    });
});

describe('useDebounce', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it('returns the initial value at once and trailing updates only after the delay', () => {
        const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), { initialProps: { value: 1 } });
        expect(result.current).toBe(1);
        rerender({ value: 2 });
        expect(result.current).toBe(1);
        vi.advanceTimersByTime(499);
        rerender({ value: 3 });                                 // restarts the timer
        vi.advanceTimersByTime(499);
        expect(result.current).toBe(1);
        vi.advanceTimersByTime(1);
        rerender({ value: 3 });
        expect(result.current).toBe(3);
    });
});
