import { describe, it, expect, afterEach } from 'vitest';
import {
    ADS_SCRIPT_URL, loadAds, AD_CLIENT, AD_SLOT_RESPONSIVE, AD_SLOT_FINDER_INFEED, AD_LAYOUT_KEY_FINDER_INFEED,
    INFEED_EVERY, MAX_INFEED_UNITS, isPlaceholderSlot,
} from './ads';

describe('ads configuration', () => {
    it('names the site\'s AdSense client and the responsive unit', () => {
        expect(AD_CLIENT).toBe('ca-pub-2625181666337030');
        expect(AD_SLOT_RESPONSIVE).toBe('4456541019');
        expect(INFEED_EVERY).toBe(5);
        expect(MAX_INFEED_UNITS).toBe(2);
    });

    it('treats a missing slot and a TODO_ placeholder as not configured', () => {
        expect(isPlaceholderSlot('')).toBe(true);
        expect(isPlaceholderSlot(undefined)).toBe(true);
        expect(isPlaceholderSlot(null)).toBe(true);
        expect(isPlaceholderSlot('TODO_AD_SLOT_FINDER_INFEED')).toBe(true);
        expect(isPlaceholderSlot('TODO_AD_LAYOUT_KEY_FINDER_INFEED')).toBe(true);
    });

    // The in-feed unit needs both ids from the AdSense dashboard: pasting one without the
    // other would push a fluid unit with no layout key.
    it('configures the finder in-feed slot and its layout key together (both placeholders or both real)', () => {
        expect(isPlaceholderSlot(AD_LAYOUT_KEY_FINDER_INFEED)).toBe(isPlaceholderSlot(AD_SLOT_FINDER_INFEED));
        if (!isPlaceholderSlot(AD_SLOT_FINDER_INFEED)) expect(AD_SLOT_FINDER_INFEED).toMatch(/^\d+$/);
    });

    it('treats a real slot id as configured', () => {
        expect(isPlaceholderSlot(AD_SLOT_RESPONSIVE)).toBe(false);
        expect(isPlaceholderSlot(4456541019)).toBe(false);
    });
});

describe('loadAds', () => {
    const scripts = () => [...document.querySelectorAll('script[src*="adsbygoogle"]')];
    afterEach(() => scripts().forEach((script) => script.remove()));

    it('adds the AdSense loader for the site\'s client to the head, async and anonymous', () => {
        expect(ADS_SCRIPT_URL).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`);
        loadAds();
        const [script] = scripts();
        expect(scripts()).toHaveLength(1);
        expect(script.parentNode).toBe(document.head);
        expect(script.getAttribute('src')).toBe(ADS_SCRIPT_URL);
        expect(script.async).toBe(true);
        expect(script.getAttribute('crossorigin')).toBe('anonymous');
    });

    it('adds it only once, however often it is called', () => {
        loadAds();
        loadAds();
        loadAds();
        expect(scripts()).toHaveLength(1);
    });
});
