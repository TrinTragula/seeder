import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import HelpTip, { placeHelp } from './HelpTip';

const A = { label: 'About layouts', text: 'A layout is the lower 48 bits.' };
const B = { label: 'About range', text: 'How far from 0,0.' };
const tip = (name = A.label) => screen.getByRole('button', { name });
const bubble = (name = A.label) => screen.queryByRole('dialog', { name });

describe('HelpTip', () => {
    it('is an icon button with no text: the sentence around it reads the same', () => {
        render(<p>Scanned <HelpTip {...A} /></p>);
        expect(tip()).toHaveTextContent('');
        expect(tip().closest('p')).toHaveTextContent(/^Scanned$/);
        expect(tip()).toHaveAttribute('aria-expanded', 'false');
        expect(bubble()).toBeNull();
    });

    it('opens on click, into <body>, and closes on a second click', () => {
        const { container } = render(<HelpTip {...A} />);
        fireEvent.click(tip());
        expect(bubble()).toHaveTextContent(A.text);
        expect(container).not.toContainElement(bubble());
        expect(tip()).toHaveAttribute('aria-expanded', 'true');
        expect(tip()).toHaveAttribute('aria-controls', bubble().id);
        expect(tip()).toHaveAccessibleDescription(A.text);
        fireEvent.click(tip());
        expect(bubble()).toBeNull();
        expect(tip()).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes with its close button and gives the focus back', () => {
        render(<HelpTip {...A} />);
        fireEvent.click(tip());
        fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
        expect(bubble()).toBeNull();
        expect(tip()).toHaveFocus();
    });

    it('Escape closes it and marks the key used (the bottom sheet then stays open)', () => {
        render(<HelpTip {...A} />);
        fireEvent.click(tip());
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        let seen = null;
        const late = (e) => { seen = e.defaultPrevented; };
        document.addEventListener('keydown', late);
        act(() => { document.body.dispatchEvent(event); });
        document.removeEventListener('keydown', late);
        expect(seen).toBe(true);
        expect(bubble()).toBeNull();
        expect(tip()).toHaveFocus();
    });

    it('a press elsewhere closes it; a press inside the bubble does not', () => {
        render(<><HelpTip {...A} /><button type="button">Elsewhere</button></>);
        fireEvent.click(tip());
        fireEvent.pointerDown(bubble());
        expect(bubble()).not.toBeNull();
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
        expect(bubble()).toBeNull();
    });

    it('a scroll or a resize closes it', () => {
        render(<HelpTip {...A} />);
        fireEvent.click(tip());
        fireEvent.scroll(document.body);
        expect(bubble()).toBeNull();
        fireEvent.click(tip());
        fireEvent(window, new Event('resize'));
        expect(bubble()).toBeNull();
    });

    it('Tab in the bubble goes back to its button', () => {
        render(<HelpTip {...A} />);
        fireEvent.click(tip());
        fireEvent.keyDown(screen.getByRole('button', { name: 'Close help' }), { key: 'Tab' });
        expect(bubble()).toBeNull();
        expect(tip()).toHaveFocus();
    });

    it('one tip at a time', () => {
        render(<><HelpTip {...A} /><HelpTip {...B} /></>);
        fireEvent.click(tip(A.label));
        fireEvent.click(tip(B.label));
        expect(bubble(A.label)).toBeNull();
        expect(bubble(B.label)).toHaveTextContent(B.text);
    });

    it('renders on the server (prerender) without touching the DOM', () => {
        const html = renderToString(<HelpTip {...A} />);
        expect(html).toContain('aria-label="About layouts"');
        expect(html).not.toContain(A.text);
    });
});

describe('placeHelp', () => {
    const viewport = { width: 400, height: 800 };
    const size = { width: 200, height: 60 };
    const rect = (left, top) => ({ left, top, width: 16, height: 16, right: left + 16, bottom: top + 16 });

    it('goes below the button, centred on it', () => {
        expect(placeHelp(rect(192, 100), size, viewport)).toEqual({ left: 100, top: 122 });
    });

    it('flips above when there is no room below', () => {
        expect(placeHelp(rect(192, 760), size, viewport)).toEqual({ left: 100, top: 694 });
    });

    it('stays inside the box it scrolls in when that box is wide enough', () => {
        const panel = { left: 150, right: 400 };
        expect(placeHelp(rect(160, 100), size, viewport, panel).left).toBe(166);
        expect(placeHelp(rect(160, 100), size, viewport, { left: 150, right: 300 }).left).toBe(68);
    });

    it('stays 16 px inside the viewport on both sides', () => {
        expect(placeHelp(rect(0, 100), size, viewport).left).toBe(16);
        expect(placeHelp(rect(390, 100), size, viewport).left).toBe(184);
    });
});
