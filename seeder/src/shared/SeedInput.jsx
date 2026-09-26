import { useState } from 'react';
import { canonicalSeed } from '../util/seed';

// What the engine gets for typed text, parsed the way Minecraft parses it: a 64-bit
// integer as a canonical decimal string (so 64-bit seeds survive), anything else -
// "1.5", "hello", a number too big for a long - hashed with Java's String.hashCode.
// The same rule parseSeedPage applies to the URL.
export const seedFromInput = (text) => canonicalSeed(text);

/*
 * The seed box: a text field, GO and a Random button. Submitting with
 * Enter or GO hands `onSubmit` the seed the engine should render; an empty field is
 * ignored. `disabled` holds the Random button while the map is still busy with the
 * previous seed (the old page's behaviour); typing, GO and Enter are never blocked,
 * so nobody is locked out of the seed they came to see. `compact` puts all three on
 * one row for the phone header.
 */
export default function SeedInput({ value, onSubmit, onRandom, disabled = false, compact = false }) {
    const [text, setText] = useState(value == null ? '' : String(value));
    const [seen, setSeen] = useState(value);

    // Follow the value from outside (Random, a saved world, the URL) but leave typed
    // text alone when it already means the current seed: "hello" must not turn into
    // 99162322 under the user's cursor.
    if (value !== seen) {
        setSeen(value);
        if (seedFromInput(text) !== String(value)) setText(value == null ? '' : String(value));
    }

    const submit = () => {
        if (!text.trim()) return;
        onSubmit?.(seedFromInput(text));
    };

    return (
        <div className={compact ? 'seed-input seed-input--compact' : 'seed-input'}>
            <div className="seed-input__row flex-row">
                <input
                    aria-label="Seed"
                    className="input flex-3"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                />
                <button type="button" className="btn flex-1" onClick={submit}>GO</button>
                {compact && (
                    <button type="button" className="btn" disabled={disabled} onClick={onRandom}>Random</button>
                )}
            </div>
            {!compact && (
                <button type="button" className="btn btn--full seed-input__random" disabled={disabled} onClick={onRandom}>
                    Random seed
                </button>
            )}
        </div>
    );
}
