import { useLocalStorage } from './hooks/useLocalStorage';

export const WHATS_NEW_KEY = 'seeder.whatsnew.v1';

/*
 * Shown once to visitors who followed a pre-1.0 share link: their
 * bookmark still works, but the page around it moved. `show` is the from=legacy
 * flag, captured before the URL is rewritten; the flag below is what makes it
 * one-time, so dismissing it sticks across visits.
 */
export default function WhatsNew({ show, storageKey = WHATS_NEW_KEY, onDismiss }) {
    const [dismissed, setDismissed] = useLocalStorage(storageKey, false);
    if (!show || dismissed) return null;

    const dismiss = () => {
        setDismissed(true);
        onDismiss?.();
    };

    // Not a labelled <section>: a landmark named "Seeder has new
    // sections" makes every getByLabel('Seed') on this page ambiguous (Playwright
    // matches accessible names by substring), and a dismissible tip is not a
    // landmark anyway - the heading already names it.
    return (
        <div className="card margin-3">
            <h3 className="no-margin">Seeder has new sections</h3>
            <p>
                Seed searching moved to the <a href="/finder/">advanced finder</a>, which streams every
                seed that matches your criteria instead of stopping at the first one.
            </p>
            <p>
                This page gained <a href="#dashboard">Explore your seed</a>: spawn, strongholds,
                structures, biomes and farms for the seed you are looking at.
            </p>
            <button type="button" className="btn" onClick={dismiss}>Dismiss</button>
        </div>
    );
}
