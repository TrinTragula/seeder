import { useEffect, useRef, useState } from 'react';
import { AD_CLIENT, AD_FALLBACK_MS, isPlaceholderSlot } from './ads';
import { COFFEE_URL, PAYPAL_BUTTON_ID, PAYPAL_DONATE_URL } from './Footer';

// Every <ins> AdSense has been asked to fill. AdSense throws ("already have ads")
// when the same element is pushed twice, and StrictMode runs every effect twice in
// development: remembering the element makes the second run a no-op.
const pushed = new WeakSet();

/*
 * What an empty slot shows instead of a blank box: a short support note with text
 * links - no third-party images, which ad blockers often drop too. No accessible name mentions "Seeder" (the seed page's getByLabel('Seed') rule).
 */
function SupportBox() {
    return (
        <div className="support-box">
            <p className="support-box__text">
                Seeder is free and runs in your browser. If it helped you, you can support it.
            </p>
            <div className="support-box__actions">
                <a className="btn" href={COFFEE_URL} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>
                <form action={PAYPAL_DONATE_URL} method="post" target="_top">
                    <input type="hidden" name="hosted_button_id" value={PAYPAL_BUTTON_ID} />
                    <button type="submit" className="btn" aria-label="Donate with PayPal">PayPal</button>
                </form>
            </div>
        </div>
    );
}

/*
 * One AdSense unit. The wrapper reserves `minHeight` so the page does
 * not shift when the ad arrives. The push waits for the unit to have a width: an
 * <ins> that is not laid out (display: none, a collapsed parent) makes AdSense log
 * an error and give up on it. A placeholder slot (not created in the AdSense
 * dashboard yet) never pushes: in development it shows where the unit will go, in
 * production it renders nothing at all.
 *
 * An empty slot shows SupportBox in the reserved space: AdSense marks the <ins>
 * data-ad-status="unfilled" when it has no ad, and a slot still not "filled" after
 * AD_FALLBACK_MS is taken as blocked (an ad blocker, a script that never loaded). An
 * ad that fills later still wins: the box goes away again.
 */
export default function GoogleAd({ slot, format = 'auto', layoutKey, minHeight = 100, className }) {
    const ref = useRef(null);
    const placeholder = isPlaceholderSlot(slot);
    const [empty, setEmpty] = useState(false);

    useEffect(() => {
        const ins = ref.current;
        if (placeholder || !ins || !(ins.offsetWidth > 0) || pushed.has(ins)) return;
        pushed.add(ins);
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch {
            // Blocked or broken ad script: the reserved box simply stays empty.
        }
    }, [placeholder, slot, format, layoutKey]);

    useEffect(() => {
        // A new unit starts over: the previous one's support box is not its verdict.
        setEmpty(false);
        const ins = ref.current;
        if (placeholder || !ins) return undefined;
        const status = () => ins.getAttribute('data-ad-status');
        const observer = new MutationObserver(() => {
            if (status() === 'filled') setEmpty(false);
            else if (status() === 'unfilled') setEmpty(true);
        });
        observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
        const timer = setTimeout(() => { if (status() !== 'filled') setEmpty(true); }, AD_FALLBACK_MS);
        return () => {
            observer.disconnect();
            clearTimeout(timer);
        };
    }, [placeholder, slot, format, layoutKey]);

    const classes = className ? `ad ${className}` : 'ad';
    if (placeholder) {
        return import.meta.env.DEV
            ? <div className={`${classes} ad--placeholder`} style={{ minHeight }}>Ad (slot not configured)</div>
            : null;
    }
    // Full-width responsive applies to the auto format only; a fluid (in-feed) unit is
    // shaped by its layout key instead.
    const fluid = format === 'fluid';
    return (
        <div className={empty ? `${classes} ad--empty` : classes} style={{ minHeight }}>
            {/* A new unit is a new element: AdSense fills each <ins> exactly once. */}
            <ins
                key={`${slot}|${format}|${layoutKey ?? ''}`}
                ref={ref}
                className="adsbygoogle"
                style={{ display: 'block' }}
                data-ad-client={AD_CLIENT}
                data-ad-slot={slot}
                data-ad-format={format}
                data-full-width-responsive={format === 'auto' ? 'true' : undefined}
                data-ad-layout-key={fluid ? layoutKey : undefined}
            />
            {empty && <SupportBox />}
        </div>
    );
}
