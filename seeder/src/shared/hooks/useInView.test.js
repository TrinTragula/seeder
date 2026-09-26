import { describe, it, expect, afterEach } from 'vitest';
import { createElement, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { useInView } from './useInView';
import { FakeIntersectionObserver } from '../../test/fakes';

// A probe that reports what the hook answers through its text.
function Probe({ options }) {
    const ref = useRef(null);
    const inView = useInView(ref, options);
    return createElement('div', { ref, 'data-testid': 'probe' }, inView ? 'visible' : 'hidden');
}
const mount = (options) => {
    const utils = render(createElement(Probe, { options }));
    return { ...utils, el: utils.getByTestId('probe') };
};

afterEach(() => { globalThis.IntersectionObserver = FakeIntersectionObserver; });

describe('useInView', () => {
    it('is false until the element comes into view, then true', () => {
        const { el } = mount();
        expect(el).toHaveTextContent('hidden');
        act(() => { FakeIntersectionObserver.trigger(el, false); });
        expect(el).toHaveTextContent('hidden');
        act(() => { FakeIntersectionObserver.trigger(el); });
        expect(el).toHaveTextContent('visible');
    });

    it('observes the viewport with a 200 px margin by default, applied to scroll containers too', () => {
        const { el } = mount();
        const [observer] = FakeIntersectionObserver.live();
        expect(observer.targets).toEqual([el]);
        // rootMargin alone would not reach inside the panel's own scroller.
        expect(observer.options).toEqual({ rootMargin: '200px', scrollMargin: '200px' });
        expect(observer.options.root).toBeUndefined();
    });

    it('with once (the default) latches and disconnects at the first sighting', () => {
        const { el } = mount();
        act(() => { FakeIntersectionObserver.trigger(el); });
        expect(FakeIntersectionObserver.live()).toHaveLength(0);
        // Nobody listens any more: scrolling away changes nothing.
        expect(FakeIntersectionObserver.trigger(el, false)).toBe(0);
        expect(el).toHaveTextContent('visible');
    });

    it('without once it follows the element in and out', () => {
        const { el } = mount({ once: false, rootMargin: '0px' });
        expect(FakeIntersectionObserver.live()[0].options).toEqual({ rootMargin: '0px', scrollMargin: '0px' });
        act(() => { FakeIntersectionObserver.trigger(el); });
        expect(el).toHaveTextContent('visible');
        act(() => { FakeIntersectionObserver.trigger(el, false); });
        expect(el).toHaveTextContent('hidden');
        expect(FakeIntersectionObserver.live()).toHaveLength(1);
    });

    it('disconnects on unmount', () => {
        const { unmount } = mount();
        expect(FakeIntersectionObserver.live()).toHaveLength(1);
        unmount();
        expect(FakeIntersectionObserver.live()).toHaveLength(0);
    });

    it('counts everything as visible where IntersectionObserver does not exist', () => {
        delete globalThis.IntersectionObserver;
        const { el } = mount();
        expect(el).toHaveTextContent('visible');
        expect(FakeIntersectionObserver.instances).toHaveLength(0);
    });
});
