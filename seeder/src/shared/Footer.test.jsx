import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Footer, { DISCLAIMER } from './Footer';
import Layout from './Layout';

describe('Footer', () => {
    it("carries Minecraft's non-affiliation disclaimer", () => {
        expect(DISCLAIMER).toBe('Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.');
        render(<Footer />);
        expect(screen.getByRole('contentinfo')).toHaveTextContent(DISCLAIMER);
    });

    it('keeps it in the compact footer too (the seed page panel)', () => {
        const { container } = render(<Footer compact />);
        expect(container.querySelector('footer')).toHaveTextContent(DISCLAIMER);
    });

    it('is on every page shape: page and app layouts both get it', () => {
        // The page shape renders the footer itself; the app shape (seed page) renders
        // <Footer compact> inside its panel, covered above.
        render(<Layout variant="page"><p>content</p></Layout>);
        expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
    });

    it('still links About, GitHub and Twitter and holds the donate buttons', () => {
        render(<Footer />);
        const nav = screen.getByRole('navigation', { name: 'Footer' });
        expect(nav.querySelectorAll('a')).toHaveLength(3);
        expect(screen.getByAltText('Donate with PayPal button')).toBeInTheDocument();
        expect(screen.getByAltText('Buy Me A Coffee')).toBeInTheDocument();
    });

    describe('privacy and cookie settings', () => {
        afterEach(() => { delete window.googlefc; });

        it('is on the full and the compact footer', () => {
            const { unmount } = render(<Footer />);
            expect(screen.getByRole('button', { name: 'Privacy and cookie settings' })).toBeInTheDocument();
            unmount();
            render(<Footer compact />);
            expect(screen.getByRole('button', { name: 'Privacy and cookie settings' })).toBeInTheDocument();
        });

        it("reopens Google's consent message once the consent script runs the queue", () => {
            render(<Footer />);
            fireEvent.click(screen.getByRole('button', { name: 'Privacy and cookie settings' }));
            // Clicked before the consent script loaded: the call waits in its queue.
            expect(window.googlefc.callbackQueue).toHaveLength(1);
            window.googlefc.showRevocationMessage = vi.fn();
            window.googlefc.callbackQueue.forEach((cb) => cb());
            expect(window.googlefc.showRevocationMessage).toHaveBeenCalledTimes(1);
        });

        it('keeps a queue the consent script already set up', () => {
            const existing = () => {};
            window.googlefc = { callbackQueue: [existing] };
            render(<Footer />);
            fireEvent.click(screen.getByRole('button', { name: 'Privacy and cookie settings' }));
            expect(window.googlefc.callbackQueue).toHaveLength(2);
            expect(window.googlefc.callbackQueue[0]).toBe(existing);
        });
    });
});
