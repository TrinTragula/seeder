import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEffect } from 'react';
import { act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { mountPage } from './boot';
import Root from './Root';

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const setServiceWorker = (value) => Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });

let root;
beforeEach(() => {
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
});
const adScripts = () => document.querySelectorAll('script[src*="adsbygoogle"]');
afterEach(() => {
    root.remove();
    delete navigator.serviceWorker;
    delete window.gtag;
    adScripts().forEach((script) => script.remove());
    vi.restoreAllMocks();
});

const mount = (element = <p>Hello page</p>) => act(() => { mountPage(element); });

describe('mountPage', () => {
    it('renders the page into #root', async () => {
        expect('serviceWorker' in navigator).toBe(false);
        await mount(<main><h1>Hello page</h1></main>);
        expect(root.querySelector('h1')).toHaveTextContent('Hello page');
    });

    it('unregisters every service worker left by an earlier release', async () => {
        const registrations = [{ unregister: vi.fn() }, { unregister: vi.fn() }, { unregister: vi.fn() }];
        const getRegistrations = vi.fn().mockResolvedValue(registrations);
        setServiceWorker({ getRegistrations });
        await mount();
        await flush();
        expect(getRegistrations).toHaveBeenCalledTimes(1);
        for (const registration of registrations) expect(registration.unregister).toHaveBeenCalledTimes(1);
        expect(root).toHaveTextContent('Hello page');
    });

    it('still renders, with no unhandled rejection, when getRegistrations rejects', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            setServiceWorker({ getRegistrations: vi.fn().mockRejectedValue(new Error('SecurityError')) });
            await mount();
            await flush();
            expect(root).toHaveTextContent('Hello page');
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('still renders, silently, when getRegistrations throws', async () => {
        const log = vi.spyOn(console, 'log');
        setServiceWorker({ getRegistrations: () => { throw new Error('denied'); } });
        await expect(mount()).resolves.toBeUndefined();
        expect(root).toHaveTextContent('Hello page');
        expect(log).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it('renders without the Service Worker API at all', async () => {
        expect('serviceWorker' in navigator).toBe(false);
        await mount();
        expect(root).toHaveTextContent('Hello page');
    });

    it('adds the AdSense loader once, after the page has run its own effects', async () => {
        const seen = [];
        function Page() {
            useEffect(() => { seen.push(adScripts().length); }, []);
            return <p>Hello page</p>;
        }
        await mount(<Page />);
        // StrictMode runs the page's effect twice; neither time was the loader there yet.
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((count) => count === 0)).toBe(true);
        expect(adScripts()).toHaveLength(1);
    });
});

describe('mountPage - prerendered markup', () => {
    const Page = ({ title = 'Hello page' }) => <main><h1>{title}</h1><p>Some text</p></main>;
    const prerender = (element) => { root.innerHTML = renderToString(<Root>{element}</Root>); };
    const hydrate = (element) => act(async () => { mountPage(element, { hydrate: true }); });

    it('hydrate: takes over the markup that is already there, without an error', async () => {
        const error = vi.spyOn(console, 'error');
        prerender(<Page />);
        const heading = root.querySelector('h1');
        await hydrate(<Page />);
        expect(root.querySelector('h1')).toBe(heading);
        expect(root.querySelectorAll('h1')).toHaveLength(1);
        expect(error).not.toHaveBeenCalled();
        expect(adScripts()).toHaveLength(1);
    });

    it('hydrate: a mismatch is recovered, logged and counted in analytics', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { });
        window.gtag = vi.fn();
        prerender(<Page title="Server" />);
        await hydrate(<Page title="Client" />);
        expect(root.querySelector('h1')).toHaveTextContent('Client');
        expect(error).toHaveBeenCalled();
        expect(window.gtag).toHaveBeenCalledWith('event', 'hydration_error', expect.objectContaining({ message: expect.any(String) }));
    });

    it('without hydrate: the app replaces a prerendered intro', async () => {
        root.innerHTML = '<header>Seeder</header><main class="page"><div class="static-intro"><h1>Seed map</h1></div></main>';
        await mount(<main className="app"><h1>The map</h1></main>);
        expect(root.querySelector('.static-intro')).toBeNull();
        expect(root.querySelectorAll('h1')).toHaveLength(1);
        expect(root.querySelector('h1')).toHaveTextContent('The map');
    });
});
