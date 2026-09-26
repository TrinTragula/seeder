import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, useIsDesktop } from './useMediaQuery';
import { FakeMatchMedia } from '../../test/fakes';

describe('useMediaQuery', () => {
    it('starts from what matchMedia answers', () => {
        FakeMatchMedia.set('(orientation: portrait)', true);
        expect(renderHook(() => useMediaQuery('(orientation: portrait)')).result.current).toBe(true);
        expect(renderHook(() => useMediaQuery('(prefers-color-scheme: dark)')).result.current).toBe(false);
    });

    it('follows the query when it starts or stops matching', () => {
        const { result } = renderHook(() => useMediaQuery('(max-width: 400px)'));
        expect(result.current).toBe(false);
        act(() => { FakeMatchMedia.set('(max-width: 400px)', true); FakeMatchMedia.trigger(); });
        expect(result.current).toBe(true);
        act(() => { FakeMatchMedia.set('(max-width: 400px)', false); FakeMatchMedia.trigger(); });
        expect(result.current).toBe(false);
    });

    it('re-subscribes when the query changes and lets go of the old one on unmount', () => {
        FakeMatchMedia.set('(min-width: 1px)', true);
        const { result, rerender, unmount } = renderHook(({ q }) => useMediaQuery(q), { initialProps: { q: '(min-width: 1px)' } });
        expect(result.current).toBe(true);
        rerender({ q: '(min-width: 99999px)' });
        expect(result.current).toBe(false);
        const listening = () => FakeMatchMedia.lists.filter((l) => l.listeners.length > 0).map((l) => l.media);
        expect(listening()).toEqual(['(min-width: 99999px)']);
        unmount();
        expect(listening()).toEqual([]);
    });

    it('uses the fallback where matchMedia does not exist', () => {
        const saved = window.matchMedia;
        delete window.matchMedia;
        try {
            expect(renderHook(() => useMediaQuery('(min-width: 1px)')).result.current).toBe(false);
            expect(renderHook(() => useMediaQuery('(min-width: 1px)', true)).result.current).toBe(true);
            expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
        } finally {
            window.matchMedia = saved;
        }
    });
});

describe('useIsDesktop', () => {
    it('is the 768px breakpoint (--bp-md), desktop by default in the unit tests', () => {
        const { result } = renderHook(() => useIsDesktop());
        expect(result.current).toBe(true);
        act(() => { FakeMatchMedia.set('(min-width: 768px)', false); FakeMatchMedia.trigger(); });
        expect(result.current).toBe(false);
    });
});
