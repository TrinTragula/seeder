import { describe, it, expect } from 'vitest';
import { AD_TAB, FIRST_TAB, SECTIONS, TABS, tabOfSection } from './sections';

describe('SECTIONS and TABS', () => {
    it('every section appears in exactly one tab', () => {
        for (const { id } of SECTIONS) {
            expect(TABS.filter((t) => t.sections.includes(id)).map((t) => t.id), id).toHaveLength(1);
        }
    });

    it('tabs list only known sections, each once', () => {
        const ids = SECTIONS.map((s) => s.id);
        const listed = TABS.flatMap((t) => t.sections);
        for (const id of listed) expect(ids, id).toContain(id);
        expect(new Set(listed).size).toBe(listed.length);
        expect(listed).toHaveLength(ids.length);
    });

    it('every section has its own icon, shipped in public/', async () => {
        // Vitest runs from the app root (seeder/).
        const { existsSync } = await import('node:fs');
        for (const { id, icon } of SECTIONS) {
            expect(icon, id).toMatch(/^\/(img|svg)\//);
            expect(existsSync(`${process.cwd()}/public${icon}`), icon).toBe(true);
        }
        expect(new Set(SECTIONS.map((s) => s.icon)).size).toBe(SECTIONS.length);
    });

    it('section and tab ids are unique', () => {
        expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
        expect(new Set(TABS.map((t) => t.id)).size).toBe(TABS.length);
    });

    it('each short label is part of its accessible label, whatever the case', () => {
        for (const { label, short } of TABS) expect(label.toLowerCase(), short).toContain(short.toLowerCase());
    });

    it('the first tab and the ad tab exist', () => {
        expect(TABS.map((t) => t.id)).toContain(FIRST_TAB);
        expect(TABS.map((t) => t.id)).toContain(AD_TAB);
    });
});

describe('tabOfSection', () => {
    it('names the tab that holds a section', () => {
        for (const tab of TABS) {
            for (const id of tab.sections) expect(tabOfSection(id), id).toBe(tab.id);
        }
        expect(tabOfSection('worlds')).toBe('more');
    });

    it('answers null for an unknown section, and for a tab id', () => {
        for (const id of ['nope', '', undefined, null, 'map']) expect(tabOfSection(id), String(id)).toBeNull();
    });
});
