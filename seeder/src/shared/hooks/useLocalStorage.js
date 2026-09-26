import { useCallback, useEffect, useRef, useState } from 'react';

// Even reading `window.localStorage` throws when the browser blocks storage
// (Safari private browsing, "block all cookies"), so the lookup is guarded too
// and a page that cannot store anything still renders.
export const defaultStorage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

// The same for sessionStorage (state that lasts for the browser session, e.g. the
// Biome locator's biome and Find near me's point).
export const defaultSessionStorage = () => {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

export function readJson(storage, key, fallback) {
    try {
        const raw = storage?.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;                                    // absent, unreadable or not JSON
    }
}

export function writeJson(storage, key, value) {
    if (!storage) return false;                             // storage blocked by the browser
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;                                       // quota exceeded, or a private window
    }
}

/*
 * A piece of JSON-serialisable state backed by localStorage.
 *
 * The write happens in the setter rather than in an effect, so nothing is written
 * until something is actually saved - mounting the hook must not create the key.
 * `key` and `storage` are expected to be constants (they are module-level keys
 * here); the stored value is only re-read on a `storage` event, i.e. when another
 * tab of the site changed it.
 */
export function useLocalStorage(key, initial, { storage = defaultStorage() } = {}) {
    const [value, setValue] = useState(() => readJson(storage, key, initial));

    // The setter needs the current value without depending on it, and must not do
    // its writing inside a state updater (React may call those more than once).
    const current = useRef(value);
    const fallback = useRef(initial);

    const set = useCallback((next) => {
        const value = typeof next === 'function' ? next(current.current) : next;
        current.current = value;
        writeJson(storage, key, value);
        setValue(value);
    }, [key, storage]);

    useEffect(() => {
        const onStorage = (event) => {
            if (event.key !== null && event.key !== key) return;     // null = the whole store was cleared
            const value = readJson(storage, key, fallback.current);
            current.current = value;
            setValue(value);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [key, storage]);

    return [value, set];
}

export default useLocalStorage;
