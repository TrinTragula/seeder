import React from 'react';

// Minecraft's usage guidelines ask every site that uses the name, brand or assets to
// say so prominently, on every page: the footer is the one element all four
// documents share, the seed page's compact panel footer included.
export const DISCLAIMER = 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.';

// The donation links: the footer's buttons and GoogleAd's fallback use the same ones.
export const COFFEE_URL = 'https://buymeacoffee.com/mcseeder';
export const PAYPAL_DONATE_URL = 'https://www.paypal.com/donate';
export const PAYPAL_BUTTON_ID = 'LNMNHMPCKH6MG';

/*
 * Site footer: navigation, the donate block and the disclaimer above. `compact`
 * collapses it to a single row for the app-shaped pages (the seed page's panel).
 */
export default function Footer({ compact = false }) {
    return (
        <footer className={compact ? 'site-footer site-footer--compact' : 'site-footer'}>
            <nav className="site-footer__links" aria-label="Footer">
                <a href="/about/">About</a>
                <a href="https://github.com/TrinTragula/seeder" target="_blank" rel="noreferrer">GitHub</a>
                <a href="https://twitter.com/McSeeder" target="_blank" rel="noreferrer">Twitter</a>
            </nav>
            <div className="site-footer__donate">
                <span>Buy me a coffee!</span>
                <form action={PAYPAL_DONATE_URL} method="post" target="_top">
                    <input type="hidden" name="hosted_button_id" value={PAYPAL_BUTTON_ID} />
                    <input type="image" src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Donate with PayPal button" />
                </form>
                <a href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
                    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" />
                </a>
            </div>
            <p className="site-footer__legal">{DISCLAIMER}</p>
        </footer>
    );
}
