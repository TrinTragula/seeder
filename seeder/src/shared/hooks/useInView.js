import { useEffect, useState } from 'react';

const supported = () => typeof IntersectionObserver !== 'undefined';

/*
 * Whether the element in `ref` is on screen, or within `rootMargin` of it. The root
 * is the viewport (no `root` option): the seed panel scrolls inside its
 * own container, and an element scrolled out of that container, or inside the
 * collapsed bottom sheet (translated below the screen), does not intersect the
 * viewport either - which is exactly "not visible" on both layouts.
 *
 * rootMargin only widens the root, never a scroll container on the way to it, so
 * the same margin goes into `scrollMargin` too: that is what makes "200 px before it
 * scrolls into the panel" work inside the panel's own scroller. Browsers without
 * scrollMargin (Chromium < 120, Firefox today) ignore it and mount on first sight.
 *
 * With `once` (the default) the answer latches at the first sighting and the
 * observer is dropped: lazy sections mount once and stay. Without
 * IntersectionObserver everything counts as visible, so nothing is ever hidden.
 */
export function useInView(ref, { rootMargin = '200px', once = true } = {}) {
    const [inView, setInView] = useState(() => !supported());

    useEffect(() => {
        if (!supported()) {
            setInView(true);
            return undefined;
        }
        const element = ref.current;
        if (!element) return undefined;
        const observer = new IntersectionObserver((entries) => {
            const entry = entries.filter((e) => e.target === element).at(-1);
            if (!entry) return;
            if (once) {
                if (!entry.isIntersecting) return;
                setInView(true);
                observer.disconnect();
            } else {
                setInView(entry.isIntersecting);
            }
        }, { rootMargin, scrollMargin: rootMargin });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, rootMargin, once]);

    return inView;
}

export default useInView;
