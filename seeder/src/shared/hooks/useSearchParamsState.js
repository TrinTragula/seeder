import { useEffect, useRef, useState } from 'react';

/*
 * Page state that lives in the query string.
 *
 * The URL is parsed once, in a state initializer, so the first render already has
 * everything the page needs - including parameters that `build` will not write
 * back (from=legacy), which a component can capture before the first effect.
 *
 * Updates go out with `history.replaceState`, never `pushState`: the map changes
 * seed and version constantly, and pushing would fill the history stack, so the
 * back button would no longer leave the page in one step.
 *
 *   parse(search) -> state
 *   build(state)  -> the URL to publish
 *   title(state)  -> optional document.title
 */
export function useSearchParamsState({ parse, build, title }) {
    const [state, setState] = useState(() => parse(window.location.search));

    // `build` and `title` are usually inline arrows, i.e. a new function on every
    // render. Keeping them in a ref keeps the effect keyed on the state alone.
    const fns = useRef({ build, title });
    useEffect(() => { fns.current = { build, title }; });

    useEffect(() => {
        window.history.replaceState(null, '', fns.current.build(state));
        if (fns.current.title) document.title = fns.current.title(state);
    }, [state]);

    return [state, setState];
}

export default useSearchParamsState;
