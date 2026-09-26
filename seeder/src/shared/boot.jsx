import { createRoot, hydrateRoot } from 'react-dom/client';
import Root from './Root';
import '../index.css';

// A mismatch React recovered from (it re-rendered on the client). Still an error in
// the console, which the e2e fixture fails on, and counted in analytics.
export function reportHydrationError(error) {
    console.error(error);
    try {
        window.gtag?.('event', 'hydration_error', { message: String(error?.message ?? error).slice(0, 100) });
    } catch {
        // Analytics is best effort.
    }
}

/*
 * Every page entry (src/pages/<page>/main.jsx) boots through here, so the four
 * documents of the site share one root setup: the global styles, Root and the
 * service-worker cleanup. The app layout's body class is left to Layout, which
 * knows which shape it is.
 *
 * `hydrate` is for the pages whose whole tree is prerendered (landing, About): React
 * takes over the markup already there. The seed page and the finder prerender only an
 * intro, which the app replaces.
 */
export function mountPage(element, { hydrate = false } = {}) {
    const container = document.getElementById('root');
    const tree = <Root>{element}</Root>;
    if (hydrate) hydrateRoot(container, tree, { onRecoverableError: reportHydrationError });
    else createRoot(container).render(tree);

    // Earlier releases shipped a (never-registered) CRA/Workbox service worker. Make
    // sure browsers that still hold one drop it, or they keep serving stale bundles.
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations()
                .then((registrations) => registrations.forEach((registration) => registration.unregister()))
                .catch(() => { });
        }
    } catch {
        // Nothing to clean up where the API is unavailable (e.g. a sandboxed context).
    }
}
