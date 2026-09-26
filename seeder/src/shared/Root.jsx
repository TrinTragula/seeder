import { StrictMode, useEffect } from 'react';
import { loadAds } from './ads';

// A parent's effects run after its children's, so by now the page has mounted (or
// hydrated) and its ad units have queued their pushes on window.adsbygoogle.
function AfterMount({ children }) {
    useEffect(() => { loadAds(); }, []);
    return children;
}

/*
 * What wraps every page, in the browser (boot.jsx) and in the prerender
 * (prerender.jsx) alike: hydration needs both trees to have the same shape.
 */
export default function Root({ children }) {
    return (
        <StrictMode>
            <AfterMount>{children}</AfterMount>
        </StrictMode>
    );
}
