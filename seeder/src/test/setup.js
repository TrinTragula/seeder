// Vitest setup for the `unit` project (jsdom). Fills the gaps in jsdom that the
// app's canvas / react-select code relies on, with stubs that record instead of draw.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { RecordingCanvasContext, FakeResizeObserver, FakeMatchMedia, FakeIntersectionObserver } from './fakes';
import { resetToastForTests } from '../shared/toast';

// jsdom has no matchMedia; the seed page picks its layout with one. Desktop by default
// (see FakeMatchMedia). Re-installed after each test, since a test may delete it to
// check the fallback.
const installMatchMedia = () => { window.matchMedia = (query) => FakeMatchMedia.create(query); };
installMatchMedia();

// Testing Library only auto-cleans when the runner exposes globals; do it explicitly.
afterEach(() => {
    cleanup();
    // The copy toast lives on document.body, outside every rendered tree.
    resetToastForTests();
    FakeResizeObserver.reset();
    FakeIntersectionObserver.reset();
    // Re-installed like matchMedia: a test may delete it to check the fallback.
    globalThis.IntersectionObserver = FakeIntersectionObserver;
    FakeMatchMedia.reset();
    installMatchMedia();
});

// jsdom has no canvas implementation: getContext('2d') returns null and logs a
// "not implemented" error. Hand every canvas one recording context instead.
HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__recordingContext) this.__recordingContext = new RecordingCanvasContext(this);
    return this.__recordingContext;
};

// jsdom never loads an image, so decode() (missing or pending forever) resolves at once.
HTMLImageElement.prototype.decode = function decode() { return Promise.resolve(); };

// jsdom has no ImageData either (DrawSeed wraps worker pixels in one).
if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
        constructor(dataOrWidth, widthOrHeight, maybeHeight) {
            if (typeof dataOrWidth === 'number') {
                this.width = dataOrWidth;
                this.height = widthOrHeight;
                this.data = new Uint8ClampedArray(this.width * this.height * 4);
            } else {
                this.data = dataOrWidth;
                this.width = widthOrHeight;
                this.height = maybeHeight ?? this.data.length / 4 / this.width;
            }
        }
    };
}

// jsdom has no ResizeObserver; MapCanvas sizes its canvas with one. The fake records
// observers and is fired by hand with FakeResizeObserver.trigger().
globalThis.ResizeObserver = FakeResizeObserver;

// jsdom has no IntersectionObserver; the dashboard mounts its sections lazily and
// runs its scroll-spy with one. Nothing is "on screen" until a test says so with
// FakeIntersectionObserver.trigger(element).
globalThis.IntersectionObserver = FakeIntersectionObserver;

// react-select scrolls the focused option into view; jsdom lacks the method.
if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView() { };
}
