import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Section, { SectionLoading, SectionEmpty, SectionError } from './Section';
import { FakeIntersectionObserver } from '../../../test/fakes';

const body = <p>the body</p>;

describe('Section', () => {
    it('is a region named by its heading, with the heading id derived from the section id', () => {
        const { container } = render(<Section id="spawn" title="Spawn">{body}</Section>);
        const section = container.querySelector('section#spawn');
        expect(section).toHaveClass('section');
        expect(section).toHaveAttribute('aria-labelledby', 'spawn-title');
        expect(screen.getByRole('heading', { name: 'Spawn' })).toHaveAttribute('id', 'spawn-title');
        expect(screen.getByRole('region', { name: 'Spawn' })).toBe(section);
    });

    it('draws a decorative icon before the title, keeping the heading name the title alone', () => {
        const { rerender } = render(<Section id="spawn" title="Spawn" icon="/img/spawn.png">{body}</Section>);
        const heading = screen.getByRole('heading', { name: 'Spawn' });
        const icon = heading.querySelector('img');
        expect(heading.firstElementChild).toBe(icon);
        expect(icon).toHaveAttribute('src', '/img/spawn.png');
        expect(icon).toHaveAttribute('alt', '');
        rerender(<Section id="spawn" title="Spawn">{body}</Section>);
        expect(screen.getByRole('heading', { name: 'Spawn' }).querySelector('img')).toBeNull();
    });

    it('mounts its body only once it comes near the screen', () => {
        const { container } = render(<Section id="spawn" title="Spawn">{body}</Section>);
        expect(screen.queryByText('the body')).toBeNull();
        const [observer] = FakeIntersectionObserver.live();
        expect(observer.targets).toEqual([container.querySelector('#spawn')]);
        expect(observer.options.rootMargin).toBe('200px');
        act(() => { FakeIntersectionObserver.trigger(container.querySelector('#spawn')); });
        expect(screen.getByText('the body')).toBeInTheDocument();
        // Mounted for good: the observer is gone.
        expect(FakeIntersectionObserver.live()).toHaveLength(0);
    });

    it('mounts its body at once when forced', () => {
        const { rerender } = render(<Section id="worlds" title="My worlds">{body}</Section>);
        expect(screen.queryByText('the body')).toBeNull();
        rerender(<Section id="worlds" title="My worlds" force>{body}</Section>);
        expect(screen.getByText('the body')).toBeInTheDocument();
    });

    it('a coming-soon section says so and never mounts a body', () => {
        const { container } = render(<Section id="farms" title="Farms" comingSoon force>{body}</Section>);
        expect(screen.getByText('This section is on its way.')).toBeInTheDocument();
        act(() => { FakeIntersectionObserver.trigger(container.querySelector('#farms')); });
        expect(screen.queryByText('the body')).toBeNull();
    });
});

describe('section states', () => {
    it('SectionLoading is a status saying "Loading…" over skeleton bars', () => {
        const { container } = render(<SectionLoading />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading…');
        expect(container.querySelectorAll('.section__bar')).toHaveLength(3);
    });

    it('SectionEmpty shows its message', () => {
        render(<SectionEmpty>None within 4096 blocks.</SectionEmpty>);
        expect(screen.getByText('None within 4096 blocks.')).toHaveClass('section__empty');
    });

    it('SectionError is an alert with the engine\'s message', () => {
        render(<SectionError error={{ code: -8, message: 'Not enough memory' }} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not compute this: Not enough memory');
    });
});
