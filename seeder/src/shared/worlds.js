import { useCallback, useMemo } from 'react';
import { defaultStorage, readJson, useLocalStorage, writeJson } from './hooks/useLocalStorage';
import { canonicalSeed } from '../util/seed';

// Versioned keys: the shape below is v1, so a future change can be migrated
// instead of silently misreading what is already in people's browsers.
export const WORLDS_KEY = 'seeder.worlds.v1';
export const LAST_SEED_KEY = 'seeder.lastSeed';

export const MAX_WORLDS = 20;
export const MAX_NAME = 40;

const DECIMAL = /^-?\d+$/;
const DIMENSIONS = [0, -1, 1];

/*
 * A saved world:
 *   { id, name, seed: "decimal", version: "<label>", dimension: 0 | -1 | 1,
 *     createdAt: ISO, lastOpenedAt: ISO }
 * The list is most-recently-opened first and holds at most MAX_WORLDS entries.
 * The seed is a string because it is 64-bit and must never go through Number.
 */
export const isWorld = (world) =>
    !!world && typeof world === 'object'
    && typeof world.id === 'string' && world.id !== ''
    && typeof world.name === 'string'
    && typeof world.seed === 'string' && DECIMAL.test(world.seed)
    && typeof world.version === 'string' && world.version !== ''
    && DIMENSIONS.includes(world.dimension)
    && typeof world.createdAt === 'string' && typeof world.lastOpenedAt === 'string';

// Anything stored by an older build, a broken write or a hand-edited devtools
// session is dropped rather than rendered: one bad entry must not lose the list.
// A seed stored in a non-canonical spelling ("007") is read as the one it opens.
export const sanitizeWorlds = (list) => (Array.isArray(list)
    ? list.filter(isWorld).map((world) => {
        const seed = canonicalSeed(world.seed);
        return seed === world.seed ? world : { ...world, seed };
    })
    : []);

const cleanName = (name) => String(name ?? '').trim().slice(0, MAX_NAME);
const defaultName = (seed) => `Seed ${seed}`;
const newId = (now) => globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`;

// The identity of a world is what it opens, not what it is called: the same seed
// on the same version in the same dimension is one entry however often it is saved.
const keyOf = ({ seed, version, dimension }) => `${seed}|${version}|${dimension ?? 0}`;

// The seed is stored as the one it opens, parsed like the seed box parses it:
// "007" and "7" are one world, and text is hashed. A missing or blank seed stays
// empty, which no world accepts.
const normalise = ({ seed, version, dimension }) => ({
    seed: String(seed ?? '').trim() === '' ? '' : canonicalSeed(seed),
    version: String(version),
    dimension: DIMENSIONS.includes(Number(dimension)) ? Number(dimension) : 0,
});

export function loadWorlds(storage = defaultStorage()) {
    return sanitizeWorlds(readJson(storage, WORLDS_KEY, []));
}

export function saveWorlds(list, storage = defaultStorage()) {
    return writeJson(storage, WORLDS_KEY, sanitizeWorlds(list));
}

export function findWorld(list, target) {
    const key = keyOf(normalise(target));
    return sanitizeWorlds(list).find((world) => keyOf(world) === key) ?? null;
}

/*
 * Save a world, most-recently-opened first. Saving one that is already in the
 * list only moves it back to the front and bumps `lastOpenedAt` - its id, its
 * creation date and the name the user gave it are kept (renaming is renameWorld's
 * job). Over MAX_WORLDS the least recently opened entries make room. A world
 * with no seed or no version is not saved: the list comes back unchanged.
 */
export function addWorld(list, { name, seed, version, dimension } = {}, now = Date.now()) {
    const worlds = sanitizeWorlds(list);
    const target = normalise({ seed, version, dimension });
    const at = new Date(now).toISOString();
    if (target.seed === '' || target.version === '' || version == null) return worlds;

    const existing = findWorld(worlds, target);
    if (existing) {
        return [{ ...existing, lastOpenedAt: at }, ...worlds.filter((world) => world.id !== existing.id)];
    }

    const world = {
        id: newId(now),
        name: cleanName(name) || defaultName(target.seed),
        ...target,
        createdAt: at,
        lastOpenedAt: at,
    };
    return trimToMax([world, ...worlds]);
}

function trimToMax(worlds) {
    if (worlds.length <= MAX_WORLDS) return worlds;
    const evicted = new Set([...worlds]
        .sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? -1 : a.lastOpenedAt > b.lastOpenedAt ? 1 : 0))
        .slice(0, worlds.length - MAX_WORLDS)
        .map((world) => world.id));
    return worlds.filter((world) => !evicted.has(world.id));
}

export function removeWorld(list, id) {
    return sanitizeWorlds(list).filter((world) => world.id !== id);
}

// An empty or whitespace-only name would leave an unidentifiable row in "My
// worlds", so it falls back to the default name instead of being stored.
export function renameWorld(list, id, name) {
    return sanitizeWorlds(list).map((world) =>
        world.id === id ? { ...world, name: cleanName(name) || defaultName(world.seed) } : world);
}

// Opening a saved world moves it back to the front of the list.
export function touchWorld(list, id, now = Date.now()) {
    const worlds = sanitizeWorlds(list);
    const world = worlds.find((entry) => entry.id === id);
    if (!world) return worlds;
    return [{ ...world, lastOpenedAt: new Date(now).toISOString() }, ...worlds.filter((entry) => entry.id !== id)];
}

/*
 * The seed the visitor last looked at, for the landing's last-seed section.
 * Separate from the saved worlds: it is written on every seed change and nobody
 * names it.
 */
export function loadLastSeed(storage = defaultStorage()) {
    const last = readJson(storage, LAST_SEED_KEY, null);
    if (!last || typeof last !== 'object') return null;
    if (typeof last.seed !== 'string' || !DECIMAL.test(last.seed)) return null;
    if (typeof last.version !== 'string' || last.version === '') return null;
    return { ...normalise(last) };
}

export function saveLastSeed({ seed, version, dimension } = {}, storage = defaultStorage()) {
    return writeJson(storage, LAST_SEED_KEY, normalise({ seed, version, dimension }));
}

// The saved worlds as React state: write-through to localStorage, and refreshed
// when another tab changes them.
export function useWorlds(storage = defaultStorage()) {
    const [stored, setStored] = useLocalStorage(WORLDS_KEY, [], { storage });
    const worlds = useMemo(() => sanitizeWorlds(stored), [stored]);

    const add = useCallback((world, now = Date.now()) =>
        setStored((list) => addWorld(list, world, now)), [setStored]);
    const remove = useCallback((id) => setStored((list) => removeWorld(list, id)), [setStored]);
    const rename = useCallback((id, name) => setStored((list) => renameWorld(list, id, name)), [setStored]);
    const touch = useCallback((id, now = Date.now()) =>
        setStored((list) => touchWorld(list, id, now)), [setStored]);
    const isSaved = useCallback((seed, version, dimension) =>
        !!findWorld(worlds, { seed, version, dimension }), [worlds]);

    return { worlds, add, remove, rename, touch, isSaved };
}
