import { copyToClipboard } from '../util/functions';
import { showToast } from './toast';

export const COPIED_MESSAGE = 'Copied to clipboard';

/*
 * Copies `text` and confirms it with the site-wide toast: the button keeps its
 * label, so nothing around it moves. A refused copy says nothing.
 * `ariaLabel` names the button when its visible label is a short form.
 */
export default function CopyButton({ text, label = 'COPY', className = 'btn', ariaLabel }) {
    const copy = () => {
        let copying;
        try {
            copying = Promise.resolve(copyToClipboard(text));
        } catch (_) {
            return;   // no clipboard at all: the URL is still in the box to select by hand
        }
        copying.then(() => showToast(COPIED_MESSAGE))
            .catch(() => { /* copy refused (no focus, no permission): say nothing untrue */ });
    };

    return (
        <button type="button" className={className} onClick={copy} aria-label={ariaLabel}>
            {label}
        </button>
    );
}
