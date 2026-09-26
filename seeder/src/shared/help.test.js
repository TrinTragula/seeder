import { describe, it, expect } from 'vitest';
import { HELP, SEED_PAGE_HELP } from './help';

// The names of the fields the tips sit next to: Playwright's getByLabel matches by
// case-insensitive substring, so a tip named after its field would make it ambiguous.
const FIELDS = ['Range', 'Biome height', 'Start seed', 'Show chunk grid lines', 'Show slime chunks on the map', 'Structures to show'];

describe('help copy', () => {
    it('every tip has a label and a short text', () => {
        for (const [key, { label, text }] of Object.entries(HELP)) {
            expect(label, key).toMatch(/^About /);
            expect(text.length, key).toBeLessThan(400);
        }
    });

    it('no label contains the name of a field', () => {
        for (const { label } of Object.values(HELP)) {
            for (const field of FIELDS) expect(label.toLowerCase()).not.toContain(field.toLowerCase());
        }
    });

    it('no label on the seed page contains "seed" (the seed box is the only one)', () => {
        for (const key of SEED_PAGE_HELP) {
            expect(HELP[key], key).toBeDefined();
            expect(HELP[key].label).not.toMatch(/seed/i);
        }
    });
});
