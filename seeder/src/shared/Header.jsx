import React from 'react';

// Each link carries a small pixel icon; it is decorative (alt=""), the label names the link.
export const NAV = [
    { href: '/seed/', label: 'Seed', icon: '/svg/map.svg' },
    { href: '/finder/', label: 'Finder', icon: '/svg/search.svg' },
    { href: '/about/', label: 'About', icon: '/svg/info.svg' },
];

/*
 * Sections are compared with a trailing slash so that /seed, /seed/ and
 * /seed/?seed=1 all light up the same link. The argument may be a full location
 * path with query/hash attached, which is why those are cut off first.
 */
function withTrailingSlash(pathname) {
    const path = String(pathname || '/').split('#')[0].split('?')[0];
    return path.endsWith('/') ? path : `${path}/`;
}

/*
 * The site header. The site is multi-page, so these are plain anchors: every
 * click is a real document load, no router involved. Each page passes its own
 * path (through Layout), so the header renders the same in the prerender and in
 * the browser; the current location is only a fallback.
 */
export default function Header({ pathname = typeof window === 'undefined' ? '/' : window.location.pathname }) {
    const current = withTrailingSlash(pathname);
    return (
        <header className="site-header">
            <a className="brand" href="/">Seeder</a>
            <nav className="site-header__nav" aria-label="Primary">
                {NAV.map(({ href, label, icon }) => (
                    <a
                        key={href}
                        className="site-header__link"
                        href={href}
                        aria-current={current.startsWith(href) ? 'page' : undefined}
                    >
                        <img className="site-header__icon" src={icon} alt="" width="16" height="16" />
                        <span>{label}</span>
                    </a>
                ))}
            </nav>
            {/* No room for the social links on a phone. */}
            <div className="site-header__social hide-md-down">
                <a className="site-header__link" href="https://github.com/TrinTragula/seeder" target="_blank" rel="noreferrer">GitHub</a>
                <a className="site-header__link" href="https://twitter.com/McSeeder" target="_blank" rel="noreferrer">Twitter</a>
            </div>
        </header>
    );
}
