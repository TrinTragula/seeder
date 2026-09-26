// True when this page is shown inside a frame on another site (someone embedding the
// app in their own page). Framing by our own origin stays allowed. The inline script in
// html/head-common.html runs the same test before anything renders (window.__framed).
export function isFramedElsewhere(win = window) {
    try {
        if (win.top === win.self) return false;
        return win.top.location.origin !== win.location.origin;
    } catch {
        // Reading a cross-origin top's location throws.
        return true;
    }
}
