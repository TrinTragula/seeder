import { renderToString } from 'react-dom/server';
import Layout from './Layout';
import Root from './Root';
import StaticIntro from './StaticIntro';
import landing from '../pages/landing/page';
import about from '../pages/about/page';

/*
 * The build-time renderer the prerender plugin (vite/plugins.js) loads through Vite's
 * SSR loader. It runs in Node: nothing it renders may read window, document or
 * storage while rendering. The seed page and the finder start the engine and read
 * the URL as they render, so only their intro is prerendered, never the app.
 */
const PAGES = {
    landing,
    about,
    seed: () => <Layout variant="page" path="/seed/"><StaticIntro page="seed" /></Layout>,
    finder: () => <Layout variant="page" path="/finder/"><StaticIntro page="finder" /></Layout>,
};

export function render(page) {
    const tree = PAGES[page];
    if (!tree) throw new Error(`prerender: unknown page ${page}`);
    return renderToString(<Root>{tree()}</Root>);
}
