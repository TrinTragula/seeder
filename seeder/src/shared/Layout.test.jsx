import { describe, it, expect, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import Layout from './Layout';

// Stands in for a page that measures its container in an effect, like the map does.
function Measurer({ seen }) {
    useEffect(() => {
        seen.push(document.body.classList.contains('layout-app'));
    }, [seen]);
    return <div>page</div>;
}

afterEach(() => document.body.classList.remove('layout-app'));

describe('Layout', () => {
    it('app: the body class is already set when a child page runs its effects', () => {
        const seen = [];
        render(<Layout variant="app"><Measurer seen={seen} /></Layout>);
        expect(seen).toEqual([true]);
        expect(document.body.classList.contains('layout-app')).toBe(true);
    });

    it('app: header and main, no footer; the class goes away on unmount', () => {
        const { unmount } = render(<Layout variant="app"><div>page</div></Layout>);
        expect(screen.getByRole('banner')).toBeInTheDocument();
        expect(screen.getByRole('main')).toHaveClass('app');
        expect(screen.queryByRole('contentinfo')).toBeNull();
        unmount();
        expect(document.body.classList.contains('layout-app')).toBe(false);
    });

    it('page: header, a reading column and the footer, and no body class', () => {
        const seen = [];
        render(<Layout variant="page"><Measurer seen={seen} /></Layout>);
        expect(screen.getByRole('main')).toHaveClass('page');
        expect(screen.getByRole('contentinfo')).toBeInTheDocument();
        expect(seen).toEqual([false]);
        expect(document.body.classList.contains('layout-app')).toBe(false);
    });

    it('page: width="wide" widens the column; the default does not', () => {
        const { unmount } = render(<Layout variant="page" width="wide"><div>page</div></Layout>);
        expect(screen.getByRole('main')).toHaveClass('page', 'page--wide');
        unmount();
        render(<Layout variant="page"><div>page</div></Layout>);
        expect(screen.getByRole('main')).toHaveClass('page');
        expect(screen.getByRole('main')).not.toHaveClass('page--wide');
    });

    it('passes its page path to the header, which marks that section as current', () => {
        window.history.replaceState({}, '', '/');
        render(<Layout variant="page" path="/finder/"><div>page</div></Layout>);
        expect(screen.getByRole('link', { name: 'Finder' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Seed' })).not.toHaveAttribute('aria-current');
    });
});
