import React, { useLayoutEffect } from 'react';
import Header from './Header';
import Footer from './Footer';
import './Layout.css';

/*
 * The two page shapes of the site:
 *   page - header, a 960px reading column, footer (landing, about, finder).
 *   app  - header and a full-height, internally scrolling main (seed).
 * `width="wide"` widens the page column to 1280px, for the finder's two columns.
 * `path` is the page's own path ("/seed/"), which the header marks as current.
 */
export default function Layout({ variant = 'page', width = 'normal', path, children }) {
    const isApp = variant === 'app';

    // The app shape has to lock the document itself; the class is what Layout.css
    // hangs `height: 100dvh` on, and only this component knows which shape we are.
    // A *layout* effect, because children size their canvas from the container in
    // their own effects, and React runs a child's passive effects before the
    // parent's: with useEffect the map would measure an unconstrained page and end
    // up vertically squashed. Layout effects run before every passive effect.
    useLayoutEffect(() => {
        if (!isApp) return undefined;
        document.body.classList.add('layout-app');
        return () => document.body.classList.remove('layout-app');
    }, [isApp]);

    return (
        <>
            <Header pathname={path} />
            <main className={isApp ? 'app' : width === 'wide' ? 'page page--wide' : 'page'}>{children}</main>
            {!isApp && <Footer />}
        </>
    );
}
