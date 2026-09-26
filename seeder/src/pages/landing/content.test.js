import { describe, it, expect } from 'vitest';
import indexHtml from '../../../index.html?raw';
import { VERSIONS } from '../../util/constants';
import {
    FAQ, HERO_LEAD, NEWEST_VERSION_LABEL, OLDEST_VERSION_LABEL, SUPPORT,
} from './content';

// A sentence ends with . ! or ? followed by whitespace or the end of the text, so the
// dots inside version numbers ("Beta 1.7", "1.18") do not count.
const sentences = (text) => text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);

describe('landing content', () => {
    it('has six FAQ entries whose answers are 2 to 4 sentences', () => {
        expect(FAQ).toHaveLength(6);
        for (const { question, answer } of FAQ) {
            expect(question.trim(), 'question').not.toBe('');
            expect(question.trim().endsWith('?'), question).toBe(true);
            const count = sentences(answer).length;
            expect(count, `${question}: ${count} sentences`).toBeGreaterThanOrEqual(2);
            expect(count, `${question}: ${count} sentences`).toBeLessThanOrEqual(4);
        }
    });

    it('a link inside an answer names text the answer really contains', () => {
        for (const { question, answer, link } of [...FAQ, { question: 'support', answer: SUPPORT.text, link: SUPPORT.link }]) {
            if (!link) continue;
            expect(answer, question).toContain(link.text);
            expect(link.href, question).toMatch(/^(\/[a-z]+\/|https:\/\/)/);
        }
    });

    it('derives the supported versions from VERSIONS instead of typing them', () => {
        const newest = Object.keys(VERSIONS).reduce((a, b) => (VERSIONS[b] > VERSIONS[a] ? b : a));
        const oldest = Object.keys(VERSIONS).reduce((a, b) => (VERSIONS[b] < VERSIONS[a] ? b : a));
        expect(NEWEST_VERSION_LABEL).toBe(newest);
        expect(OLDEST_VERSION_LABEL).toBe(oldest);
        const versions = FAQ.find(({ question }) => /versions/i.test(question));
        expect(versions.answer).toContain('Beta 1.7');
        expect(versions.answer).toContain(NEWEST_VERSION_LABEL);
    });

    it('says the biome map works for Bedrock from 1.18, and the structure markers do not', () => {
        const bedrock = FAQ.find(({ question }) => /Bedrock/.test(question));
        expect(bedrock.answer).toMatch(/^For biomes, yes\./);
        expect(bedrock.answer).toContain('from 1.18 a seed gives the same terrain and biomes on Bedrock');
        expect(bedrock.answer).toContain('only hold for Java');
    });

    it("index.html describes the page with the hero's sentence", () => {
        // Search results and link previews show these; they must say what the page says.
        const content = (attr) => indexHtml.match(new RegExp(`<meta ${attr} content="(.*?)"`))?.[1];
        expect(content('name="description"')).toBe(HERO_LEAD);
        expect(content('property="og:description"')).toBe(HERO_LEAD);
        expect(content('name="twitter:description"')).toBe(HERO_LEAD);
    });
});
