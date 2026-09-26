// AdSense configuration. One place for every id, so a placement never
// hard-codes a slot and the policy numbers below are the only knobs.
export const AD_CLIENT = 'ca-pub-2625181666337030';
export const AD_SLOT_RESPONSIVE = '4456541019';

// The finder's in-feed unit ("Immagine sopra", styled like a result row). Both ids come
// from the unit's code in the AdSense dashboard; the layout key changes whenever the
// unit's style is edited there, so paste the new one after every style change.
export const AD_SLOT_FINDER_INFEED = '6248117605';
export const AD_LAYOUT_KEY_FINDER_INFEED = '-6r+dw+n-2o+9m';

// One in-feed unit after every INFEED_EVERY cards, never more than MAX_INFEED_UNITS
// per page: with the responsive unit above the results that is the 2-3 units policy.
export const INFEED_EVERY = 5;
export const MAX_INFEED_UNITS = 2;

// A slot still not filled this long after mounting is taken as blocked (an ad blocker,
// a script that never loaded) and shows the support box instead (GoogleAd).
export const AD_FALLBACK_MS = 4000;

// A slot that is missing or still a TODO_ placeholder is never pushed: AdSense logs a
// console error for unknown slots, and the e2e fixture fails any page that logs one.
export const isPlaceholderSlot = (slot) => !slot || String(slot).startsWith('TODO_');

// The AdSense loader. It is not in the <head>: Auto ads inserts units into the page as
// soon as the script runs, and in a prerendered document that would put nodes React
// did not render inside #root before it hydrates. Root loads it once the page is mounted.
export const ADS_SCRIPT_URL = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;

export function loadAds(doc = document) {
    if (doc.querySelector(`script[src="${ADS_SCRIPT_URL}"]`)) return;
    const script = doc.createElement('script');
    script.async = true;
    script.src = ADS_SCRIPT_URL;
    script.crossOrigin = 'anonymous';
    doc.head.appendChild(script);
}

// Reopens Google's consent message (AdSense Privacy & messaging, GDPR) so a visitor can
// change or withdraw their choice. The footer's "Privacy and cookie settings" button calls
// it, next to Google's own floating shield button (which cannot be turned off: no setting,
// no API, and its inline-styled shadow host takes no CSS). Queued, so a click before the
// consent script has loaded still works.
export function openPrivacySettings(win = window) {
    win.googlefc = win.googlefc || {};
    win.googlefc.callbackQueue = win.googlefc.callbackQueue || [];
    win.googlefc.callbackQueue.push(() => win.googlefc.showRevocationMessage());
}
