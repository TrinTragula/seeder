// The hook that makes the address bar the page's state.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSearchParamsState } from './useSearchParamsState';

const parse = (search) => {
    const params = new URLSearchParams(search);
    return { seed: params.get('seed') ?? 'none', from: params.get('from') };
};
const build = (state) => `/seed/?seed=${state.seed}`;

const at = (url) => window.history.replaceState({}, '', url);
const title = document.title;

beforeEach(() => at('/'));
afterEach(() => {
    at('/');
    document.title = title;
    vi.restoreAllMocks();
});

describe('useSearchParamsState', () => {
    it('parses the URL once, before any effect runs', () => {
        at('/seed/?seed=42&from=legacy');
        const seen = [];
        renderHook(() => {
            const [state] = useSearchParamsState({ parse, build });
            seen.push(state);
            return state;
        });
        // The very first render already had the parsed state, from=legacy included.
        expect(seen[0]).toEqual({ seed: '42', from: 'legacy' });
    });

    it('publishes the built URL with replaceState, not pushState', () => {
        at('/seed/?seed=42');
        const replace = vi.spyOn(window.history, 'replaceState');
        const push = vi.spyOn(window.history, 'pushState');
        const { result } = renderHook(() => useSearchParamsState({ parse, build }));

        expect(replace).toHaveBeenCalledWith(null, '', '/seed/?seed=42');
        act(() => result.current[1]({ seed: '7' }));
        expect(window.location.search).toBe('?seed=7');
        expect(replace).toHaveBeenLastCalledWith(null, '', '/seed/?seed=7');
        expect(push).not.toHaveBeenCalled();
    });

    it('drops parameters build does not emit, on the first publish', () => {
        at('/seed/?seed=42&from=legacy&utm_source=x');
        renderHook(() => useSearchParamsState({ parse, build }));
        expect(window.location.search).toBe('?seed=42');
        expect(window.location.pathname).toBe('/seed/');
    });

    it('sets document.title from the state when a title builder is given', () => {
        at('/seed/?seed=42');
        const { result } = renderHook(() => useSearchParamsState({
            parse, build, title: (state) => `Seed ${state.seed} - Seeder`,
        }));
        expect(document.title).toBe('Seed 42 - Seeder');
        act(() => result.current[1]({ seed: '7' }));
        expect(document.title).toBe('Seed 7 - Seeder');
    });

    it('leaves the title alone when no title builder is given', () => {
        document.title = 'Minecraft seed map & explorer - Seeder';
        renderHook(() => useSearchParamsState({ parse, build }));
        expect(document.title).toBe('Minecraft seed map & explorer - Seeder');
    });

    it('accepts an updater function, like useState does', () => {
        at('/seed/?seed=42');
        const { result } = renderHook(() => useSearchParamsState({ parse, build }));
        act(() => result.current[1]((state) => ({ ...state, seed: `${state.seed}0` })));
        expect(result.current[0].seed).toBe('420');
        expect(window.location.search).toBe('?seed=420');
    });

    it('uses the latest build and title without re-publishing on every render', () => {
        at('/seed/?seed=42');
        const replace = vi.spyOn(window.history, 'replaceState');
        const { rerender } = renderHook(() => useSearchParamsState({
            parse,
            build: (state) => `/seed/?seed=${state.seed}`,        // a new arrow every render
            title: (state) => `Seed ${state.seed} - Seeder`,
        }));
        rerender();
        rerender();
        expect(replace).toHaveBeenCalledTimes(1);
    });
});
