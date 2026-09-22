// Vitest setup for the `unit` project (jsdom). Fills the gaps in jsdom that the
// app's canvas / react-select code relies on, with stubs that record instead of draw.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { RecordingCanvasContext } from './fakes';

// Testing Library only auto-cleans when the runner exposes globals; do it explicitly.
afterEach(() => cleanup());

// jsdom has no canvas implementation: getContext('2d') returns null and logs a
// "not implemented" error. Hand every canvas one recording context instead.
HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__recordingContext) this.__recordingContext = new RecordingCanvasContext(this);
    return this.__recordingContext;
};

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

// react-select scrolls the focused option into view; jsdom lacks the method.
if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView() { };
}
