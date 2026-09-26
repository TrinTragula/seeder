// One small toast per document ("Copied to clipboard"), outside React so every page
// and every component can raise it without a provider. A new message replaces the one
// on screen and restarts its timer. The region is a polite live region, so screen
// readers announce it without moving the focus.

export const TOAST_MS = 2000;

let region = null;
let timer = null;

function ensureRegion(doc) {
    if (region && region.isConnected && region.ownerDocument === doc) return region;
    region = doc.createElement('div');
    region.className = 'toast';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.hidden = true;
    doc.body.appendChild(region);
    return region;
}

export function showToast(message, { duration = TOAST_MS, document: doc = globalThis.document } = {}) {
    if (!doc?.body) return;
    const el = ensureRegion(doc);
    el.textContent = message;
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
        el.hidden = true;
        el.textContent = '';
    }, duration);
}

// Tests: forget the region and its timer.
export function resetToastForTests() {
    clearTimeout(timer);
    timer = null;
    region?.remove();
    region = null;
}
