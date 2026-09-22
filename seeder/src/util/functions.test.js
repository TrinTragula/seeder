import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { debounce, copyToClipboard, setUrl, useDebounce, toHHMMSS } from './functions';

describe('debounce', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it('collapses a burst of calls into one, with the last arguments, after the wait', () => {
        const fn = vi.fn();
        const d = debounce(fn, 100);
        d(1); d(2); d(3);
        vi.advanceTimersByTime(99);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(3);
    });
    it('defaults to a 25 ms wait', () => {
        const fn = vi.fn();
        debounce(fn)();
        vi.advanceTimersByTime(24);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('toHHMMSS', () => {
    it.each([
        [0, '0s'], [999, '0s'], [1000, '1s'], [59_999, '59s'], [60_000, '1m 0s'], [61_000, '1m 1s'],
        [3_599_000, '59m 59s'], [3_600_000, '1h 0m 0s'], [3_661_000, '1h 1m 1s'], [90_061_000, '25h 1m 1s'],
    ])('%i ms -> %s', (ms, text) => {
        expect(toHHMMSS(ms)).toBe(text);
    });
});

describe('setUrl', () => {
    afterEach(() => window.history.replaceState({}, '', '/'));
    it('pushes ?seed=&version= onto the current path and resets the copy button', () => {
        window.history.replaceState({}, '', '/some/path?old=1');
        const push = vi.spyOn(window.history, 'pushState');
        const setButtonText = vi.fn();
        setUrl('8091867987493326313', '1.21.11', setButtonText);
        expect(window.location.pathname).toBe('/some/path');
        expect(window.location.search).toBe('?seed=8091867987493326313&version=1.21.11');
        expect(push).toHaveBeenCalledTimes(1);
        expect(push.mock.calls[0][2]).toBe(`${window.location.origin}/some/path?seed=8091867987493326313&version=1.21.11`);
        expect(setButtonText).toHaveBeenCalledWith('COPY');
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
