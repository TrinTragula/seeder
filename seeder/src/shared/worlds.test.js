// The saved-worlds store: the data contract "My worlds" reads and writes.
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
    LAST_SEED_KEY, MAX_NAME, MAX_WORLDS, WORLDS_KEY,
    addWorld, findWorld, loadLastSeed, loadWorlds, removeWorld, renameWorld,
    saveLastSeed, saveWorlds, touchWorld, useWorlds,
} from './worlds';
import { seedFromString } from '../util/seed';

const fakeStorage = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: vi.fn((key, value) => map.set(key, value)),
        removeItem: (key) => map.delete(key),
    };
};
const stored = (storage) => JSON.parse(storage.map.get(WORLDS_KEY));
const world = (over = {}) => ({ name: 'Home', seed: '42', version: '1.18', dimension: 0, ...over });

// A fixed clock, one tick apart, so "least recently opened" is unambiguous.
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (n) => T0 + n * 60_000;

describe('loadWorlds', () => {
    it('is an empty list when nothing was ever saved', () => {
        expect(loadWorlds(fakeStorage())).toEqual([]);
        expect(loadWorlds(null)).toEqual([]);
    });

    it('is an empty list for corrupt JSON or a value that is not an array', () => {
        expect(loadWorlds(fakeStorage({ [WORLDS_KEY]: '{not json' }))).toEqual([]);
        expect(loadWorlds(fakeStorage({ [WORLDS_KEY]: '"a string"' }))).toEqual([]);
        expect(loadWorlds(fakeStorage({ [WORLDS_KEY]: 'null' }))).toEqual([]);
    });

    it('drops the invalid entries and keeps the rest', () => {
        const good = addWorld([], world(), at(0))[0];
        const storage = fakeStorage({
            [WORLDS_KEY]: JSON.stringify([
                good,
                null,
                'nope',
                { ...good, id: undefined },
                { ...good, seed: 42 },                       // a number: seeds are strings
                { ...good, seed: '12abc' },
                { ...good, dimension: 7 },
                { ...good, version: '' },
            ]),
        });
        expect(loadWorlds(storage)).toEqual([good]);
    });

    it('round-trips through saveWorlds', () => {
        const storage = fakeStorage();
        const list = addWorld([], world(), at(0));
        expect(saveWorlds(list, storage)).toBe(true);
        expect(loadWorlds(storage)).toEqual(list);
    });
});

describe('addWorld', () => {
    it('creates the full shape, with ISO dates and a unique id', () => {
        const [saved] = addWorld([], world(), at(0));
        expect(saved).toEqual({
            id: expect.any(String),
            name: 'Home',
            seed: '42',
            version: '1.18',
            dimension: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
        });
        const ids = new Set();
        let list = [];
        for (let i = 0; i < 10; i++) list = addWorld(list, world({ seed: String(i) }), at(i));
        for (const entry of list) ids.add(entry.id);
        expect(ids.size).toBe(10);
    });

    it('keeps a 64-bit seed as a string', () => {
        const big = '8091867987493326313';
        expect(addWorld([], world({ seed: big }), at(0))[0].seed).toBe(big);
        expect(addWorld([], world({ seed: -9223372036854775808n }), at(0))[0].seed).toBe('-9223372036854775808');
    });

    it('names an unnamed world after its seed, and caps a long name', () => {
        expect(addWorld([], world({ name: undefined }), at(0))[0].name).toBe('Seed 42');
        expect(addWorld([], world({ name: '   ' }), at(0))[0].name).toBe('Seed 42');
        expect(addWorld([], world({ name: '  spaced  ' }), at(0))[0].name).toBe('spaced');
        expect(addWorld([], world({ name: 'x'.repeat(80) }), at(0))[0].name).toHaveLength(MAX_NAME);
    });

    it('puts the newest world first', () => {
        let list = addWorld([], world({ seed: '1' }), at(0));
        list = addWorld(list, world({ seed: '2' }), at(1));
        expect(list.map((entry) => entry.seed)).toEqual(['2', '1']);
    });

    it('dedupes on seed + version + dimension, moving the entry to the front', () => {
        let list = addWorld([], world({ seed: '1', name: 'First' }), at(0));
        list = addWorld(list, world({ seed: '2' }), at(1));
        list = addWorld(list, world({ seed: '1', name: 'ignored' }), at(2));

        expect(list).toHaveLength(2);
        expect(list[0].seed).toBe('1');
        expect(list[0].name).toBe('First');                                  // renaming is renameWorld's job
        expect(list[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(list[0].lastOpenedAt).toBe('2026-01-01T00:02:00.000Z');       // bumped
    });

    it('treats the same seed in another version or dimension as another world', () => {
        let list = addWorld([], world(), at(0));
        list = addWorld(list, world({ version: '26.3' }), at(1));
        list = addWorld(list, world({ dimension: -1 }), at(2));
        expect(list).toHaveLength(3);
    });

    it(`evicts the least recently opened past ${MAX_WORLDS}`, () => {
        let list = [];
        for (let i = 0; i < MAX_WORLDS; i++) list = addWorld(list, world({ seed: String(i) }), at(i));
        expect(list).toHaveLength(MAX_WORLDS);

        // Seed 0 is the oldest, but opening it again makes seed 1 the eviction victim.
        list = touchWorld(list, findWorld(list, { seed: '0', version: '1.18', dimension: 0 }).id, at(100));
        list = addWorld(list, world({ seed: '999' }), at(101));

        expect(list).toHaveLength(MAX_WORLDS);
        expect(findWorld(list, { seed: '1', version: '1.18', dimension: 0 })).toBeNull();
        expect(findWorld(list, { seed: '0', version: '1.18', dimension: 0 })).not.toBeNull();
    });
});

describe('addWorld: the seed is the one it opens', () => {
    it('stores the canonical spelling, so "007" and "7" are one world', () => {
        let list = addWorld([], world({ seed: '007', name: undefined }), at(0));
        expect(list[0].seed).toBe('7');
        expect(list[0].name).toBe('Seed 7');
        list = addWorld(list, world({ seed: '7' }), at(1));
        list = addWorld(list, world({ seed: '+7' }), at(2));
        expect(list).toHaveLength(1);
        expect(list[0].lastOpenedAt).toBe('2026-01-01T00:02:00.000Z');
        expect(findWorld(list, { seed: '0007', version: '1.18' })).not.toBeNull();
    });

    it('hashes a text seed like the seed box does, and the stored world survives a save', () => {
        const storage = fakeStorage();
        const list = addWorld([], world({ seed: 'hello' }), at(0));
        expect(list[0].seed).toBe('99162322');
        saveWorlds(list, storage);
        expect(loadWorlds(storage)).toEqual(list);
        expect(addWorld([], world({ seed: '18446744073709551615' }), at(0))[0].seed)
            .toBe(String(seedFromString('18446744073709551615')));
    });

    it('saves nothing without a seed or a version', () => {
        const list = addWorld([], world(), at(0));
        expect(addWorld(list, world({ seed: undefined }), at(1))).toEqual(list);
        expect(addWorld(list, world({ seed: '   ' }), at(1))).toEqual(list);
        expect(addWorld(list, world({ version: undefined }), at(1))).toEqual(list);
        expect(addWorld([], world({ version: '' }), at(1))).toEqual([]);
    });

    it('reads a stored non-canonical seed as its canonical one', () => {
        const good = addWorld([], world({ seed: '7' }), at(0))[0];
        const storage = fakeStorage({ [WORLDS_KEY]: JSON.stringify([{ ...good, seed: '007' }]) });
        expect(loadWorlds(storage)).toEqual([good]);
    });

    it(`re-adding the least recently opened world of a full list promotes it instead of evicting it`, () => {
        let list = [];
        for (let i = 0; i < MAX_WORLDS; i++) list = addWorld(list, world({ seed: String(i) }), at(i));
        const oldest = findWorld(list, { seed: '0', version: '1.18', dimension: 0 });

        list = addWorld(list, world({ seed: '0' }), at(100));
        expect(list).toHaveLength(MAX_WORLDS);
        expect(list[0].id).toBe(oldest.id);
        expect(list[0].lastOpenedAt).toBe(new Date(at(100)).toISOString());
        expect(list.map((entry) => entry.seed).sort()).toEqual(Array.from({ length: MAX_WORLDS }, (_, i) => String(i)).sort());
    });
});

describe('findWorld, removeWorld, renameWorld, touchWorld', () => {
    const build = () => {
        let list = addWorld([], world({ seed: '1', name: 'One' }), at(0));
        list = addWorld(list, world({ seed: '2', name: 'Two' }), at(1));
        return list;
    };

    it('finds by seed + version + dimension and nothing else', () => {
        const list = build();
        expect(findWorld(list, { seed: '1', version: '1.18', dimension: 0 }).name).toBe('One');
        expect(findWorld(list, { seed: 1, version: '1.18' }).name).toBe('One');          // coerced, dimension defaults
        expect(findWorld(list, { seed: '1', version: '26.3', dimension: 0 })).toBeNull();
        expect(findWorld(list, { seed: '1', version: '1.18', dimension: 1 })).toBeNull();
        expect(findWorld([], { seed: '1', version: '1.18', dimension: 0 })).toBeNull();
    });

    it('removes by id and ignores an unknown one', () => {
        const list = build();
        expect(removeWorld(list, list[0].id).map((entry) => entry.name)).toEqual(['One']);
        expect(removeWorld(list, 'nope')).toHaveLength(2);
    });

    it('renames, trimming and capping at 40 characters', () => {
        const list = build();
        expect(renameWorld(list, list[0].id, '  Base  ')[0].name).toBe('Base');
        expect(renameWorld(list, list[0].id, 'x'.repeat(80))[0].name).toBe('x'.repeat(MAX_NAME));
        expect(renameWorld(list, list[0].id, '   ')[0].name).toBe('Seed 2');             // never nameless
        expect(renameWorld(list, list[0].id, 'Base')[1].name).toBe('One');               // the others are untouched
    });

    it('touch bumps lastOpenedAt and moves the world to the front', () => {
        const list = build();
        const touched = touchWorld(list, list[1].id, at(9));
        expect(touched.map((entry) => entry.name)).toEqual(['One', 'Two']);
        expect(touched[0].lastOpenedAt).toBe('2026-01-01T00:09:00.000Z');
        expect(touched[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(touchWorld(list, 'nope', at(9))).toEqual(list);
    });
});

describe('the last seed', () => {
    it('round-trips through storage', () => {
        const storage = fakeStorage();
        expect(saveLastSeed({ seed: '8091867987493326313', version: '26.3', dimension: -1 }, storage)).toBe(true);
        expect(storage.map.get(LAST_SEED_KEY)).toContain('8091867987493326313');
        expect(loadLastSeed(storage)).toEqual({ seed: '8091867987493326313', version: '26.3', dimension: -1 });
    });

    it('defaults the dimension to the Overworld and keeps the seed a string', () => {
        const storage = fakeStorage();
        saveLastSeed({ seed: 42, version: '1.18' }, storage);
        expect(loadLastSeed(storage)).toEqual({ seed: '42', version: '1.18', dimension: 0 });
    });

    it('is null when there is nothing stored or what is stored is unusable', () => {
        expect(loadLastSeed(fakeStorage())).toBeNull();
        expect(loadLastSeed(null)).toBeNull();
        expect(loadLastSeed(fakeStorage({ [LAST_SEED_KEY]: '{oops' }))).toBeNull();
        expect(loadLastSeed(fakeStorage({ [LAST_SEED_KEY]: '"42"' }))).toBeNull();
        expect(loadLastSeed(fakeStorage({ [LAST_SEED_KEY]: '{"seed":"x","version":"1.18"}' }))).toBeNull();
        expect(loadLastSeed(fakeStorage({ [LAST_SEED_KEY]: '{"seed":"42"}' }))).toBeNull();
    });
});

describe('the world type (largeBiomes)', () => {
    it('a world saved before world types existed still loads, as a Default world', () => {
        const old = { id: 'a', name: 'Old', seed: '42', version: '1.18', dimension: 0, createdAt: new Date(T0).toISOString(), lastOpenedAt: new Date(T0).toISOString() };
        const storage = fakeStorage({ [WORLDS_KEY]: JSON.stringify([old]) });
        expect(loadWorlds(storage)).toEqual([old]);
        expect(findWorld(loadWorlds(storage), { seed: '42', version: '1.18', dimension: 0 })).toEqual(old);
        expect(findWorld(loadWorlds(storage), { seed: '42', version: '1.18', dimension: 0, largeBiomes: true })).toBeNull();
    });

    it('Default and Large Biomes of one seed are two entries', () => {
        let list = addWorld([], world(), at(0));
        list = addWorld(list, world({ name: 'Big', largeBiomes: true }), at(1));
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({ name: 'Big', largeBiomes: true });
        // Saving either again only moves it to the front.
        list = addWorld(list, world(), at(2));
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Home');
        expect(list[0]).not.toHaveProperty('largeBiomes');
    });

    it('stores a Default world exactly as before, and the flag only when set', () => {
        const [plain] = addWorld([], world(), at(0));
        expect(Object.keys(plain).sort()).toEqual(['createdAt', 'dimension', 'id', 'lastOpenedAt', 'name', 'seed', 'version']);
        const [big] = addWorld([], world({ largeBiomes: true }), at(0));
        expect(big.largeBiomes).toBe(true);
    });

    it('a version without the type (before 1.3) saves a Default world', () => {
        const [w] = addWorld([], world({ version: '1.2', largeBiomes: true }), at(0));
        expect(w).not.toHaveProperty('largeBiomes');
    });

    it('drops a stored entry whose flag is not a boolean', () => {
        const bad = { id: 'b', name: 'x', seed: '1', version: '1.18', dimension: 0, largeBiomes: 'yes', createdAt: 'x', lastOpenedAt: 'x' };
        expect(loadWorlds(fakeStorage({ [WORLDS_KEY]: JSON.stringify([bad]) }))).toEqual([]);
    });

    it('the last seed keeps it', () => {
        const storage = fakeStorage();
        saveLastSeed({ seed: '42', version: '1.18', dimension: -1, largeBiomes: true }, storage);
        expect(loadLastSeed(storage)).toEqual({ seed: '42', version: '1.18', dimension: -1, largeBiomes: true });
        saveLastSeed({ seed: '42', version: '1.18', dimension: 0, largeBiomes: false }, storage);
        expect(loadLastSeed(storage)).toEqual({ seed: '42', version: '1.18', dimension: 0 });
    });

    it('useWorlds().isSaved tells the two apart', () => {
        const storage = fakeStorage();
        const { result } = renderHook(() => useWorlds(storage));
        act(() => result.current.add(world({ largeBiomes: true })));
        expect(result.current.isSaved('42', '1.18', 0, true)).toBe(true);
        expect(result.current.isSaved('42', '1.18', 0)).toBe(false);
        expect(result.current.isSaved('42', '1.18', 0, false)).toBe(false);
    });
});

describe('useWorlds', () => {
    it('starts from storage and ignores what is invalid', () => {
        const good = addWorld([], world(), at(0))[0];
        const storage = fakeStorage({ [WORLDS_KEY]: JSON.stringify([good, { junk: true }]) });
        const { result } = renderHook(() => useWorlds(storage));
        expect(result.current.worlds).toEqual([good]);
    });

    it('add, rename, touch and remove update both the state and storage', () => {
        const storage = fakeStorage();
        const { result } = renderHook(() => useWorlds(storage));
        expect(result.current.worlds).toEqual([]);

        act(() => result.current.add(world({ seed: '1', name: 'One' }), at(0)));
        act(() => result.current.add(world({ seed: '2', name: 'Two' }), at(1)));
        expect(result.current.worlds.map((entry) => entry.name)).toEqual(['Two', 'One']);
        expect(stored(storage).map((entry) => entry.name)).toEqual(['Two', 'One']);

        const one = result.current.worlds[1];
        act(() => result.current.rename(one.id, 'Renamed'));
        expect(result.current.worlds[1].name).toBe('Renamed');
        expect(stored(storage)[1].name).toBe('Renamed');

        act(() => result.current.touch(one.id, at(5)));
        expect(result.current.worlds[0].id).toBe(one.id);

        act(() => result.current.remove(one.id));
        expect(result.current.worlds.map((entry) => entry.name)).toEqual(['Two']);
        expect(stored(storage)).toHaveLength(1);
    });

    it('isSaved answers for the exact seed, version and dimension', () => {
        const storage = fakeStorage();
        const { result } = renderHook(() => useWorlds(storage));
        expect(result.current.isSaved('42', '1.18', 0)).toBe(false);
        act(() => result.current.add(world(), at(0)));
        expect(result.current.isSaved('42', '1.18', 0)).toBe(true);
        expect(result.current.isSaved('42', '26.3', 0)).toBe(false);
        expect(result.current.isSaved('42', '1.18', -1)).toBe(false);
    });

    it('reloads when another tab saves a world', () => {
        const storage = fakeStorage();
        const { result } = renderHook(() => useWorlds(storage));
        expect(result.current.worlds).toEqual([]);

        storage.map.set(WORLDS_KEY, JSON.stringify(addWorld([], world({ name: 'Elsewhere' }), at(0))));
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: WORLDS_KEY })));
        expect(result.current.worlds.map((entry) => entry.name)).toEqual(['Elsewhere']);
    });
});
