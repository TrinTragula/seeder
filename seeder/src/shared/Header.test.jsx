import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Header, { NAV } from './Header';

const nav = () => screen.getByRole('navigation', { name: 'Primary' });
const hrefsOf = (links) => links.map((link) => link.getAttribute('href'));
const currentLabels = () => within(nav())
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent);

describe('Header', () => {
    it('brands back to the landing page', () => {
        render(<Header pathname="/seed/" />);
        expect(screen.getByRole('link', { name: 'Seeder' })).toHaveAttribute('href', '/');
    });

    it('links the three sections with trailing slashes', () => {
        render(<Header pathname="/" />);
        expect(hrefsOf(within(nav()).getAllByRole('link'))).toEqual(['/seed/', '/finder/', '/about/']);
        expect(NAV.map((entry) => entry.href)).toEqual(['/seed/', '/finder/', '/about/']);
    });

    it('puts a decorative icon before each section label, keeping the link names', () => {
        render(<Header pathname="/" />);
        const links = within(nav()).getAllByRole('link');
        expect(links.map((link) => link.textContent)).toEqual(['Seed', 'Finder', 'About']);
        for (const [i, link] of links.entries()) {
            expect(link).toHaveAccessibleName(NAV[i].label);
            const icon = link.querySelector('img');
            expect(link.firstElementChild).toBe(icon);
            expect(icon).toHaveAttribute('src', NAV[i].icon);
            expect(icon).toHaveAttribute('alt', '');
        }
        expect(new Set(NAV.map((entry) => entry.icon)).size).toBe(NAV.length);
    });

    it('ships every header icon in public/', async () => {
        // Vitest runs from the app root (seeder/).
        const { existsSync } = await import('node:fs');
        for (const { icon } of NAV) expect(existsSync(`${process.cwd()}/public${icon}`), icon).toBe(true);
    });

    it('marks the current section with aria-current', () => {
        render(<Header pathname="/seed/" />);
        expect(currentLabels()).toEqual(['Seed']);
    });

    it('matches a section without its trailing slash', () => {
        render(<Header pathname="/seed" />);
        expect(currentLabels()).toEqual(['Seed']);
    });

    it('ignores the query string when matching', () => {
        render(<Header pathname="/finder/?x=1" />);
        expect(currentLabels()).toEqual(['Finder']);
    });

    it('marks nothing on the landing page', () => {
        render(<Header pathname="/" />);
        expect(currentLabels()).toEqual([]);
    });

    it('falls back to the current location', () => {
        window.history.replaceState({}, '', '/about/');
        render(<Header />);
        expect(currentLabels()).toEqual(['About']);
    });

    it('keeps GitHub and Twitter in the block that hides on mobile', () => {
        render(<Header pathname="/" />);
        const github = screen.getByRole('link', { name: 'GitHub' });
        const twitter = screen.getByRole('link', { name: 'Twitter' });
        expect(github).toHaveAttribute('href', 'https://github.com/TrinTragula/seeder');
        expect(twitter).toHaveAttribute('href', 'https://twitter.com/McSeeder');
        for (const link of [github, twitter]) {
            expect(link).toHaveAttribute('target', '_blank');
            expect(link.closest('.hide-md-down')).not.toBeNull();
        }
    });
});
