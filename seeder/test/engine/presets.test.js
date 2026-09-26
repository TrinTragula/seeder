// The finder presets against the real engine: every preset is a search the newest version
// accepts, and each pinned preset's `since` is the first version with its content. A
// cubiomes bump that renames or moves a biome or structure fails here, not in a visitor's
// browser. How fast each preset finds seeds was measured once (docs/presets-proposal.md);
// that is not re-run here.
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorkerHarness } from './harness.js';
import { validate } from '../../src/pages/finder/criteria';
import { NEWEST_MC, PINNED_GROUP, PRESETS, presetAvailable, presetCriteria, presetsOf } from '../../src/pages/finder/presets.js';
import { BIOMES, STRUCTURES_OPTIONS, VERSIONS } from '../../src/util/constants';

const ALL_BIOMES = BIOMES.map((b) => b.value);
const ALL_TYPES = STRUCTURES_OPTIONS.map((s) => s.value);
const labelOf = (mc) => Object.keys(VERSIONS).find((k) => VERSIONS[k] === mc);

let w, seeder;
const supportFor = (mc) => seeder.getVersionSupport(mc, ALL_BIOMES, ALL_TYPES);
beforeAll(async () => {
    w = await createWorkerHarness();
    seeder = w.seeder;
});

describe(`presets on the newest version (${labelOf(NEWEST_MC)})`, () => {
    it('the engine knows it as the newest', () => {
        expect(supportFor(NEWEST_MC).newest).toBe(NEWEST_MC);
    });

    it('every preset is available and passes the form\'s validation', () => {
        const support = supportFor(NEWEST_MC);
        for (const p of PRESETS) {
            expect(presetAvailable(p, support), p.slug).toEqual({ ok: true, reason: null });
            expect(validate(presetCriteria(p, NEWEST_MC), support), p.slug).toEqual({ ok: true, errors: [] });
        }
    });

    it('find_seeds accepts every preset\'s search', () => {
        for (const p of PRESETS) {
            const c = presetCriteria(p, NEWEST_MC);
            w.clear();
            const result = seeder.findSeeds({
                mcVersion: c.mcVersion, dimension: c.dimension, yHeight: c.yHeight, biomes: c.biomes, structures: c.structures,
                rangeBlocks: c.rangeBlocks, startingSeed: '1', maxSeedsToScan: 1, maxResults: 1,
            });
            expect(result.error, p.slug).toBeNull();
            expect(result.examined, p.slug).toBe(1);
        }
    });
});

describe('the pinned presets', () => {
    it('each runs from its `since` version and not on the version before it', () => {
        for (const p of presetsOf(PINNED_GROUP)) {
            const from = supportFor(p.since);
            expect(validate(presetCriteria(p, p.since), from), `${p.slug} on ${labelOf(p.since)}`).toEqual({ ok: true, errors: [] });
            const before = p.since - 1;
            // presetCriteria would switch `before` to the newest version: check the raw criteria.
            const raw = { ...presetCriteria(p, p.since), mcVersion: before };
            expect(validate(raw, supportFor(before)).ok, `${p.slug} on ${labelOf(before)}`).toBe(false);
        }
    });
});
