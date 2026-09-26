// The storage layer under saved worlds and the what's-new flag. Every test gets
// its own in-memory store, so nothing leaks between cases or into jsdom's real one.
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readJson, useLocalStorage, writeJson } from './useLocalStorage';

// A Storage double with the one behaviour that matters: it can also fail.
const fakeStorage = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: vi.fn((key) => (map.has(key) ? map.get(key) : null)),
        setItem: vi.fn((key, value) => map.set(key, value)),
        removeItem: vi.fn((key) => map.delete(key)),
    };
};

describe('readJson / writeJson', () => {
    it('reads back what it wrote', () => {
        const storage = fakeStorage();
        writeJson(storage, 'k', { a: [1, 2] });
        expect(readJson(storage, 'k', null)).toEqual({ a: [1, 2] });
    });

    it('falls back for a missing key, broken JSON or no storage at all', () => {
        expect(readJson(fakeStorage(), 'k', 'fallback')).toBe('fallback');
        expect(readJson(fakeStorage({ k: '{oops' }), 'k', 'fallback')).toBe('fallback');
        expect(readJson(null, 'k', 'fallback')).toBe('fallback');
    });

    it('reports a failed write instead of throwing', () => {
        const storage = fakeStorage();
        storage.setItem = () => { throw new Error('QuotaExceededError'); };
        expect(writeJson(storage, 'k', 1)).toBe(false);
        expect(writeJson(null, 'k', 1)).toBe(false);
        expect(writeJson(fakeStorage(), 'k', 1)).toBe(true);
    });
});

describe('useLocalStorage', () => {
    it('starts from what is stored, or from the initial value', () => {
        const stored = renderHook(() => useLocalStorage('k', [], { storage: fakeStorage({ k: '[1,2]' }) }));
        expect(stored.result.current[0]).toEqual([1, 2]);
        const empty = renderHook(() => useLocalStorage('k', 'none', { storage: fakeStorage() }));
        expect(empty.result.current[0]).toBe('none');
    });

    it('does not write anything until something is set', () => {
        const storage = fakeStorage();
        renderHook(() => useLocalStorage('k', [], { storage }));
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('writes through on set, and accepts an updater', () => {
        const storage = fakeStorage();
        const { result } = renderHook(() => useLocalStorage('k', [], { storage }));
        act(() => result.current[1](['a']));
        expect(result.current[0]).toEqual(['a']);
        expect(storage.map.get('k')).toBe('["a"]');
        act(() => result.current[1]((list) => [...list, 'b']));
        expect(result.current[0]).toEqual(['a', 'b']);
        expect(storage.map.get('k')).toBe('["a","b"]');
    });

    it('keeps the state when the write fails', () => {
        const storage = fakeStorage();
        storage.setItem = vi.fn(() => { throw new Error('QuotaExceededError'); });
        const { result } = renderHook(() => useLocalStorage('k', 0, { storage }));
        act(() => result.current[1](5));
        expect(result.current[0]).toBe(5);
    });

    it('refreshes when another tab changes the same key', () => {
        const storage = fakeStorage({ k: '1' });
        const { result } = renderHook(() => useLocalStorage('k', 0, { storage }));
        expect(result.current[0]).toBe(1);

        storage.map.set('k', '2');
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'other' })));
        expect(result.current[0]).toBe(1);                       // not our key
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'k' })));
        expect(result.current[0]).toBe(2);

        storage.map.clear();
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
        expect(result.current[0]).toBe(0);                       // the whole store was cleared
    });

    it('stops listening once unmounted', () => {
        const storage = fakeStorage({ k: '1' });
        const { result, unmount } = renderHook(() => useLocalStorage('k', 0, { storage }));
        unmount();
        storage.map.set('k', '9');
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'k' })));
        expect(result.current[0]).toBe(1);
    });

    it('still renders when the browser blocks storage entirely', () => {
        const { result } = renderHook(() => useLocalStorage('k', 'fallback', { storage: null }));
        expect(result.current[0]).toBe('fallback');
        act(() => result.current[1]('set anyway'));
        expect(result.current[0]).toBe('set anyway');
    });
});
