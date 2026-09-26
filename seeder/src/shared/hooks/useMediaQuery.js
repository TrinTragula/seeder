import { useEffect, useState } from 'react';

const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/*
 * Whether a media query matches, kept live through its `change` event. `fallback`
 * is the answer where matchMedia does not exist (old browsers, bare test DOMs), so
 * the caller decides which layout a browser without it gets.
 */
export function useMediaQuery(query, fallback = false) {
    const [matches, setMatches] = useState(() => (supported() ? window.matchMedia(query).matches : fallback));

    useEffect(() => {
        if (!supported()) return undefined;
        const list = window.matchMedia(query);
        const update = () => setMatches(list.matches);
        // The query may have changed since the state was initialised.
        update();
        list.addEventListener('change', update);
        return () => list.removeEventListener('change', update);
    }, [query]);

    return matches;
}

// 768px mirrors --bp-md in tokens.css (a custom property cannot drive a media query).
// Desktop is the fallback: without matchMedia we cannot tell, and the desktop layout
// works everywhere, while the bottom sheet needs a touch-sized screen.
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)', true);
