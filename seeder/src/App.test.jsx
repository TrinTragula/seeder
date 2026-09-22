import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { APP_VERSION } from './util/site';
import { FakeQueueManager, FakeDrawSeed } from './test/fakes';

vi.mock('./library/queue', async () => ({ QueueManager: (await import('./test/fakes')).FakeQueueManager }));
vi.mock('./library/draw', async () => ({ DrawSeed: (await import('./test/fakes')).FakeDrawSeed }));

beforeEach(() => { FakeQueueManager.reset(); FakeDrawSeed.reset(); });

describe('routes', () => {
    it('/ renders the seed map page', () => {
        window.history.replaceState({}, '', '/');
        render(<App />);
        expect(screen.getByLabelText('Seed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Random seed' })).toBeInTheDocument();
        expect(FakeQueueManager.instances.length).toBeGreaterThan(0);
    });
    it('/about renders the About page with the version from package.json', () => {
        window.history.replaceState({}, '', '/about');
        render(<App />);
        expect(screen.getByRole('heading', { name: 'Seeder', level: 1 })).toBeInTheDocument();
        expect(screen.getByText(`(${APP_VERSION})`)).toBeInTheDocument();
        expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
        expect(screen.queryByLabelText('Seed')).toBeNull();
    });
});

describe('header', () => {
    it('links home, to GitHub, Twitter and About', () => {
        window.history.replaceState({}, '', '/about');
        render(<App />);
        expect(screen.getByRole('link', { name: 'Seeder' })).toHaveAttribute('href', '/');
        expect(screen.getByRole('link', { name: 'Github' })).toHaveAttribute('href', 'https://github.com/TrinTragula/seeder');
        expect(screen.getByRole('link', { name: 'Twitter' })).toHaveAttribute('href', 'https://twitter.com/McSeeder');
        expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    });
});
