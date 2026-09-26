import { describe, it, expect } from 'vitest';
import { badgesFor, VARIANT_TYPES, VILLAGE_BIOME_LABELS, PORTAL_BIOME_LABELS } from './variants';
import { BIOMES, STRUCTURES_OPTIONS } from '../../../util/constants';

const type = (name) => STRUCTURES_OPTIONS.find((s) => s.pureText === name).value;
const biome = (label) => BIOMES.find((b) => b.label === label).value;

// Shaped like STRUCTURE_VARIANT's reply: all 19 fields, as the engine fills them.
const variant = (over = {}) => ({
    supported: 1, abandoned: 0, giant: 0, underground: 0, airpocket: 0, basement: 0, cracked: 0, size: 0,
    start: -1, biome: -1, rotation: 2, mirror: 1, bx: -8, by: 320, bz: 3, sx: 9, sy: 4, sz: 9, endShip: 0, ...over,
});
const labels = (t, v) => badgesFor(t, v).map((b) => b.label);

describe('VARIANT_TYPES', () => {
    it('is Igloo, Village, Shipwreck, Ruined Portal, Bastion and End City', () => {
        expect([...VARIANT_TYPES].sort((a, b) => a - b))
            .toEqual(['Igloo', 'Village', 'Shipwreck', 'Ruined Portal', 'Bastion', 'End City'].map(type).sort((a, b) => a - b));
    });
});

describe('badgesFor', () => {
    describe('Village', () => {
        const village = type('Village');

        it('a zombie village is a danger badge', () => {
            expect(badgesFor(village, variant({ abandoned: 1, start: 2, biome: biome('Plains') }))).toEqual([
                { key: 'abandoned', label: 'Zombie village', tone: 'danger' },
                { key: 'village-biome', label: 'Plains village', tone: 'accent' },
            ]);
        });

        it('names the five village types by their biome ids (accent)', () => {
            const cases = { Plains: 'Plains village', Desert: 'Desert village', Savanna: 'Savanna village', Taiga: 'Taiga village', 'Snowy Plains': 'Snowy village' };
            for (const [label, text] of Object.entries(cases)) {
                expect(badgesFor(village, variant({ start: 1, biome: biome(label) }))).toEqual([{ key: 'village-biome', label: text, tone: 'accent' }]);
            }
            expect(Object.keys(VILLAGE_BIOME_LABELS).map(Number).sort((a, b) => a - b))
                .toEqual([1, 2, 5, 12, 35]);                                // cubiomes: plains, desert, taiga, snowy_tundra, savanna
        });

        it('an unknown biome id gives no type badge', () => {
            expect(labels(village, variant({ start: 0, biome: biome('Meadow') }))).toEqual([]);
            expect(labels(village, variant({ start: 0, biome: 999 }))).toEqual([]);
        });

        it('1.12 (biome -1, abandoned 1): only "Zombie village"', () => {
            expect(labels(village, variant({ abandoned: 1, biome: -1, start: -1 }))).toEqual(['Zombie village']);
        });

        it('before 1.14 (no start piece) the sampled biome the engine reports is not a village type', () => {
            // What the engine really answers on 1.10-1.13: the validated biome, start -1.
            expect(labels(village, variant({ biome: biome('Taiga'), start: -1 }))).toEqual([]);
            expect(labels(village, variant({ abandoned: 1, biome: biome('Plains'), start: -1 }))).toEqual(['Zombie village']);
        });

        it('1.9 and older (supported 0): nothing', () => {
            expect(labels(village, variant({ supported: 0, abandoned: 1 }))).toEqual([]);
        });
    });

    describe('Ruined Portal', () => {
        const portal = type('Ruined Portal');

        it('giant (accent), underground and air pocket (muted)', () => {
            expect(badgesFor(portal, variant({ giant: 1, underground: 1, airpocket: 1, start: 2, biome: biome('Plains') }))).toEqual([
                { key: 'giant', label: 'Giant', tone: 'accent' },
                { key: 'underground', label: 'Underground', tone: 'muted' },
                { key: 'airpocket', label: 'Air pocket', tone: 'muted' },
            ]);
            expect(labels(portal, variant({ airpocket: 1, start: 4, biome: biome('Jungle') }))).toEqual(['Air pocket', 'Jungle portal']);
        });

        it('names the six portal looks by category (muted), nothing for the standard one', () => {
            const cases = {
                Desert: 'Desert portal', Jungle: 'Jungle portal', Swamp: 'Swamp portal', Ocean: 'Ocean portal',
                'Nether Wastes': 'Nether portal', 'Windswept Hills': 'Mountain portal',
            };
            for (const [label, text] of Object.entries(cases)) {
                expect(badgesFor(portal, variant({ start: 3, biome: biome(label) }))).toEqual([{ key: 'portal-biome', label: text, tone: 'muted' }]);
            }
            expect(Object.keys(PORTAL_BIOME_LABELS)).toHaveLength(6);
            expect(labels(portal, variant({ start: 3, biome: biome('Plains') }))).toEqual([]);
            expect(labels(portal, variant({ start: 3, biome: 999 }))).toEqual([]);
        });
    });

    describe('Bastion', () => {
        it('names the four bastion types by start (accent)', () => {
            const bastion = type('Bastion');
            expect(['Housing units', 'Hoglin stables', 'Treasure room', 'Bridge'].map((_, start) => badgesFor(bastion, variant({ start }))))
                .toEqual(['Housing units', 'Hoglin stables', 'Treasure room', 'Bridge'].map((label) => [{ key: 'bastion', label, tone: 'accent' }]));
            expect(labels(bastion, variant({ start: -1 }))).toEqual([]);
            expect(labels(bastion, variant({ start: 7 }))).toEqual([]);
        });
    });

    describe('Igloo', () => {
        it('"With basement" (accent), nothing without one', () => {
            const igloo = type('Igloo');
            expect(badgesFor(igloo, variant({ basement: 1, size: 9, biome: biome('Snowy Taiga') })))
                .toEqual([{ key: 'basement', label: 'With basement', tone: 'accent' }]);
            expect(labels(igloo, variant({ basement: 0, size: 9 }))).toEqual([]);
        });
    });

    describe('Shipwreck', () => {
        const wreck = type('Shipwreck');

        it('a wreck outside the oceans is "Beached" (muted)', () => {
            expect(badgesFor(wreck, variant({ start: 4, biome: biome('Beach') }))).toEqual([{ key: 'beached', label: 'Beached', tone: 'muted' }]);
            expect(labels(wreck, variant({ start: 4, biome: biome('Snowy Beach') }))).toEqual(['Beached']);
        });

        it('every ocean is not beached, and an unknown biome says nothing', () => {
            for (const label of ['Ocean', 'Frozen Ocean', 'Deep Ocean', 'Warm Ocean', 'Lukewarm Ocean', 'Cold Ocean',
                'Deep Warm Ocean', 'Deep Lukewarm Ocean', 'Deep Cold Ocean', 'Deep Frozen Ocean']) {
                expect(labels(wreck, variant({ start: 12, biome: biome(label) })), label).toEqual([]);
            }
            expect(labels(wreck, variant({ start: 12, biome: -1 }))).toEqual([]);
        });
    });

    describe('End City', () => {
        const city = type('End City');

        it('reports the ship whatever `supported` says (getVariant has no End city data)', () => {
            expect(badgesFor(city, variant({ supported: 0, endShip: 1 }))).toEqual([{ key: 'end-ship', label: 'Has ship (elytra)', tone: 'accent' }]);
            expect(badgesFor(city, variant({ supported: 0, endShip: 0 }))).toEqual([{ key: 'end-ship', label: 'No ship', tone: 'muted' }]);
            expect(labels(city, variant({ supported: 1, endShip: 1 }))).toEqual(['Has ship (elytra)']);
            expect(labels(city, variant({ supported: 0, endShip: -1 }))).toEqual([]);
        });
    });

    it('Fortress (supported 0) and types without badges give nothing', () => {
        expect(badgesFor(type('Fortress'), variant({ supported: 0 }))).toEqual([]);
        expect(badgesFor(type('Ancient City'), variant({ start: 2, biome: biome('Deep Dark') }))).toEqual([]);
        expect(badgesFor(type('Outpost'), variant({ rotation: 3 }))).toEqual([]);
    });

    it('an unknown type, a missing variant or `supported 0` give nothing', () => {
        expect(badgesFor(99, variant({ abandoned: 1, giant: 1, basement: 1 }))).toEqual([]);
        expect(badgesFor(type('Village'), null)).toEqual([]);
        expect(badgesFor(type('Village'), undefined)).toEqual([]);
        expect(badgesFor(type('Igloo'), variant({ supported: 0, basement: 1 }))).toEqual([]);
        expect(badgesFor(type('Ruined Portal'), variant({ supported: 0, giant: 1 }))).toEqual([]);
    });

    it('rotation, mirror and sizes never become badges', () => {
        for (const t of VARIANT_TYPES) {
            for (const b of badgesFor(t, variant({ rotation: 3, mirror: 1, sx: 40, sy: 20, sz: 40, size: 11 }))) {
                expect(b.key).not.toMatch(/rotation|mirror|size/);
            }
        }
    });
});
