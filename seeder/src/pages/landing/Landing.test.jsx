import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import Landing from './Landing';
import { FakeQueueManager } from '../../test/fakes';
import { LAST_SEED_KEY, WORLDS_KEY } from '../../shared/worlds';
import { APP_VERSION } from '../../util/site';
import { FAQ, HERO_NAME, HERO_TITLE, NEWEST_VERSION_LABEL } from './content';

// The landing must never start the engine. Nothing it imports should
// reach the queue; if something ever does, this fake records the construction.
vi.mock('../../library/queue', async () => ({ QueueManager: (await import('../../test/fakes')).FakeQueueManager }));

const card = (title) => screen.getByRole('heading', { level: 2, name: title }).closest('li');
const continueSection = () => screen.getByRole('region', { name: 'Open the last seed you looked up:' });
const heroInput = () => within(screen.getByRole('form', { name: 'Open a seed' })).getByLabelText('Seed', { exact: true });

let n = 0;
const world = (over = {}) => {
    n += 1;
    return {
        id: `world-${n}`, name: `World ${n}`, seed: String(1000 + n), version: '26.3', dimension: 0,
        createdAt: '2026-09-20T10:00:00.000Z', lastOpenedAt: '2026-09-24T10:00:00.000Z', ...over,
    };
};
const store = (key, value) => window.localStorage.setItem(key, JSON.stringify(value));

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    FakeQueueManager.reset();
});

afterEach(() => {
    expect(FakeQueueManager.instances).toHaveLength(0);
    window.history.replaceState(null, '', '/');
});

describe('Landing - hero', () => {
    it('has one h1: the name, then the tagline', () => {
        render(<Landing />);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Seeder - Minecraft seed map, finder & explorer');
        expect(HERO_NAME).toBe('Seeder');
        expect(HERO_TITLE).toBe('Minecraft seed map, finder & explorer');
    });

    it('opens a seed with a plain GET form to /seed/, with no script in the way', () => {
        render(<Landing />);
        const form = screen.getByRole('form', { name: 'Open a seed' });
        expect(form).toHaveAttribute('action', '/seed/');
        expect(form).toHaveAttribute('method', 'get');
        const input = heroInput();
        expect(input).toHaveAttribute('name', 'seed');
        expect(input).toBeRequired();
        expect(input).toHaveAttribute('autocomplete', 'off');
        expect(within(form).getByRole('button', { name: 'Open map' })).toHaveAttribute('type', 'submit');
        // A submit handler that called preventDefault would make dispatchEvent return false.
        expect(fireEvent.submit(form)).toBe(true);
    });

    it('leads with a random seed: the hero\'s main button, before the seed form', () => {
        render(<Landing />);
        const random = screen.getByRole('link', { name: 'Open a random seed' });
        expect(random).toHaveAttribute('href', '/seed/');
        expect(random).toHaveClass('btn', 'btn--primary');
        const form = screen.getByRole('form', { name: 'Open a seed' });
        expect(random.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('or explore your own seed:')).toBeInTheDocument();
        // One main button in the hero: Open map steps back.
        expect(within(form).getByRole('button', { name: 'Open map' })).not.toHaveClass('btn--primary');
    });

    it('prefills the seed from a /?seed=<text> visit', () => {
        // Decimal seeds are legacy links and redirect before the landing mounts, so only text arrives here.
        window.history.replaceState(null, '', '/?seed=hello');
        render(<Landing />);
        expect(heroInput()).toHaveValue('hello');
    });

    it('starts empty on a plain visit', () => {
        render(<Landing />);
        expect(heroInput()).toHaveValue('');
    });

    it('tells how to find the seed of a world with /seed, under the form', () => {
        render(<Landing />);
        const hint = screen.getByText(/type \/seed in the chat/);
        const form = screen.getByRole('form', { name: 'Open a seed' });
        expect(form.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('names the app version and the newest Minecraft version, the numbers set apart', () => {
        render(<Landing />);
        // The numbers and the separator are their own elements (styling), so match the whole line's text.
        const line = `Seeder: ${APP_VERSION} · Works up to Minecraft: ${NEWEST_VERSION_LABEL}`;
        const badge = screen.getByText((_, element) => element?.tagName === 'P' && element.textContent.replace(/\s+/g, ' ') === line);
        expect([...badge.querySelectorAll('strong')].map((number) => number.textContent)).toEqual([APP_VERSION, NEWEST_VERSION_LABEL]);
    });
});

describe('Landing - section cards', () => {
    it('shows two cards, the map and the finder, each with a 960×600 image that is not lazy, a title and a primary link', () => {
        render(<Landing />);
        const list = screen.getByRole('list', { name: 'Sections' });
        const items = [...list.children];
        expect(items).toHaveLength(2);
        expect(items.map((item) => within(item).getByRole('heading', { level: 2 }).textContent))
            .toEqual(['Seed map', 'Advanced finder']);
        const sources = [];
        for (const item of items) {
            const image = within(item).getByRole('img');
            expect(image).toHaveAttribute('width', '960');
            expect(image).toHaveAttribute('height', '600');
            expect(image.getAttribute('alt')).not.toBe('');
            expect(image).not.toHaveAttribute('loading');
            sources.push(image.getAttribute('src'));
        }
        expect(sources).toEqual(['/img/landing/map.webp', '/img/landing/finder.webp']);
        expect(within(card('Seed map')).getByRole('link', { name: 'Open the map' })).toHaveAttribute('href', '/seed/');
        expect(within(card('Advanced finder')).getByRole('link', { name: 'Find your seed' })).toHaveAttribute('href', '/finder/');
    });

    it('continue: a first visit (nothing stored) has no such section', () => {
        render(<Landing />);
        expect(screen.queryByRole('region', { name: 'Open the last seed you looked up:' })).toBeNull();
        expect(screen.queryByRole('link', { name: /^Open Seed/ })).toBeNull();
    });

    it('continue: a section under the cards continues with the last seed at its canonical URL', () => {
        store(LAST_SEED_KEY, { seed: '42', version: '1.17', dimension: -1 });
        render(<Landing />);
        const section = continueSection();
        expect(within(section).getByRole('link', { name: 'Open Seed 42' }))
            .toHaveAttribute('href', '/seed/?seed=42&version=1.17&dim=-1');
        const cards = screen.getByRole('list', { name: 'Sections' });
        expect(cards.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(section).queryByRole('list', { name: 'Worlds you saved in this browser:' })).toBeNull();
    });

    it('continue: keeps a 64-bit seed exact', () => {
        store(LAST_SEED_KEY, { seed: '-8091867987493326313', version: '26.3', dimension: 0 });
        render(<Landing />);
        expect(screen.getByRole('link', { name: 'Open Seed -8091867987493326313' }))
            .toHaveAttribute('href', '/seed/?seed=-8091867987493326313&version=26.3');
    });

    it('continue: a version this build does not know opens on the default version', () => {
        store(LAST_SEED_KEY, { seed: '42', version: '99.9', dimension: 0 });
        render(<Landing />);
        expect(screen.getByRole('link', { name: 'Open Seed 42' })).toHaveAttribute('href', '/seed/?seed=42&version=26.3');
    });

    it('continue: lists up to three saved worlds by name, most recently opened first', () => {
        store(LAST_SEED_KEY, { seed: '42', version: '1.17', dimension: -1 });
        const worlds = [world({ name: 'Island' }), world({ name: 'Base', dimension: 1 }), world({ name: 'Speedrun', version: '1.16.5' }), world(), world()];
        store(WORLDS_KEY, worlds);
        render(<Landing />);
        const list = within(continueSection()).getByRole('list', { name: 'Worlds you saved in this browser:' });
        const links = within(list).getAllByRole('link');
        expect(links.map((link) => link.textContent)).toEqual(['Island', 'Base', 'Speedrun']);
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
            `/seed/?seed=${worlds[0].seed}&version=26.3`,
            `/seed/?seed=${worlds[1].seed}&version=26.3&dim=1`,
            `/seed/?seed=${worlds[2].seed}&version=1.16.5`,
        ]);
    });

    it('continue: does not list the last seed again among the saved worlds', () => {
        store(LAST_SEED_KEY, { seed: '42', version: '1.17', dimension: -1 });
        store(WORLDS_KEY, [
            world({ name: 'Current', seed: '42', version: '1.17', dimension: -1 }),
            world({ name: 'Same seed, Overworld', seed: '42', version: '1.17', dimension: 0 }),
            world({ name: 'Other' }),
        ]);
        render(<Landing />);
        const list = within(continueSection()).getByRole('list', { name: 'Worlds you saved in this browser:' });
        expect(within(list).getAllByRole('link').map((link) => link.textContent)).toEqual(['Same seed, Overworld', 'Other']);
    });

    it('continue: saved worlds without a last seed still show the section, with no Continue link', () => {
        store(WORLDS_KEY, [world({ name: 'Island' })]);
        render(<Landing />);
        const section = continueSection();
        expect(within(section).getByRole('link', { name: 'Island' })).toBeInTheDocument();
        expect(within(section).queryByRole('link', { name: /^Open Seed/ })).toBeNull();
    });

    it('reads storage once, on mount, and never writes it', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        try {
            const { rerender } = render(<Landing />);
            expect(getItem.mock.calls.map(([key]) => key).sort()).toEqual([LAST_SEED_KEY, WORLDS_KEY].sort());
            rerender(<Landing />);
            rerender(<Landing />);
            expect(getItem).toHaveBeenCalledTimes(2);
            expect(setItem).not.toHaveBeenCalled();
        } finally {
            getItem.mockRestore();
            setItem.mockRestore();
        }
    });
});

describe('Landing - ad and text', () => {
    it('holds exactly one ad unit, after the cards and before the FAQ', () => {
        const { container } = render(<Landing />);
        const units = container.querySelectorAll('ins.adsbygoogle');
        expect(units).toHaveLength(1);
        const cards = screen.getByRole('list', { name: 'Sections' });
        const faq = screen.getByRole('heading', { level: 2, name: 'FAQ' });
        expect(cards.compareDocumentPosition(units[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(units[0].compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('has no How it works or What\'s new section', () => {
        render(<Landing />);
        expect(screen.queryByRole('heading', { name: 'How it works' })).toBeNull();
        expect(screen.queryByRole('heading', { name: "What's new" })).toBeNull();
        expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
            .toEqual(['Seed map', 'Advanced finder', 'FAQ', 'Support Seeder!']);
    });

    it('answers six questions, the first one open', () => {
        const { container } = render(<Landing />);
        const details = [...container.querySelectorAll('details')];
        expect(details).toHaveLength(6);
        expect(details.map((d) => d.open)).toEqual([true, false, false, false, false, false]);
        expect(details.map((d) => d.querySelector('summary').textContent)).toEqual(FAQ.map((entry) => entry.question));
        const faq = screen.getByRole('region', { name: 'FAQ' });
        // The seed answer points at the wiki, the tracking answer at About.
        expect(within(faq).getByRole('link', { name: 'A seed' })).toHaveAttribute('href', 'https://minecraft.wiki/w/World_seed');
        expect(within(faq).getByRole('link', { name: 'About page' })).toHaveAttribute('href', '/about/');
    });

    it('asks for support without a second donate form: the buttons are the footer\'s', () => {
        const { container } = render(<Landing />);
        const support = screen.getByRole('region', { name: 'Support Seeder!' });
        expect(within(support).getByRole('link', { name: 'on GitHub' })).toHaveAttribute('href', 'https://github.com/TrinTragula/seeder');
        expect(container.querySelector('form[action*="paypal"]')).toBeNull();
    });
});
