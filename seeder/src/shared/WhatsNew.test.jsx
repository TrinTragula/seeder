// The one-time card for visitors arriving from a pre-1.0 share link.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WhatsNew, { WHATS_NEW_KEY } from './WhatsNew';

const card = () => screen.queryByRole('heading', { name: 'Seeder has new sections' });

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('WhatsNew', () => {
    it('is shown to a legacy visitor who has not dismissed it', () => {
        render(<WhatsNew show />);
        expect(card()).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /finder/i })).toHaveAttribute('href', '/finder/');
        expect(screen.getByRole('link', { name: /explore/i })).toHaveAttribute('href', '#dashboard');
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('is not an ARIA landmark, so it cannot shadow the Seed input next to it', () => {
        // A <section aria-labelledby> named "Seeder has new sections" makes every
        // accessible-name lookup for "Seed" on the seed page ambiguous.
        render(<WhatsNew show />);
        expect(screen.queryByRole('region')).toBeNull();
    });

    it('renders nothing for everybody else', () => {
        const { container } = render(<WhatsNew show={false} />);
        expect(card()).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it('stays hidden once the flag is set, across reloads', () => {
        window.localStorage.setItem(WHATS_NEW_KEY, 'true');
        render(<WhatsNew show />);
        expect(card()).toBeNull();
    });

    it('Dismiss writes the flag, hides the card and tells the page', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        const { unmount } = render(<WhatsNew show onDismiss={onDismiss} />);
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(card()).toBeNull();
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem(WHATS_NEW_KEY)).toBe('true');

        unmount();
        render(<WhatsNew show />);
        expect(card()).toBeNull();
    });

    it('uses the storage key it is given, so a later card can be its own', async () => {
        const user = userEvent.setup();
        render(<WhatsNew show storageKey="seeder.whatsnew.v2" />);
        await user.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(window.localStorage.getItem('seeder.whatsnew.v2')).toBe('true');
        expect(window.localStorage.getItem(WHATS_NEW_KEY)).toBeNull();
    });
});
