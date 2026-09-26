import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CopyButton, { COPIED_MESSAGE } from './CopyButton';
import { TOAST_MS, resetToastForTests } from './toast';

const button = () => screen.getByRole('button');
const toast = () => document.querySelector('.toast');
// The click resolves the clipboard promise in a microtask; let it settle.
const settle = () => act(async () => { await Promise.resolve(); });

let writeText;
beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
    vi.useRealTimers();
    resetToastForTests();
});

describe('CopyButton', () => {
    it('copies the text and confirms with the toast; its own label never changes', async () => {
        render(<CopyButton text="https://mcseeder.com/seed/?seed=1&version=26.3" />);
        expect(button()).toHaveTextContent('COPY');
        fireEvent.click(button());
        await settle();
        expect(writeText).toHaveBeenCalledWith('https://mcseeder.com/seed/?seed=1&version=26.3');
        expect(COPIED_MESSAGE).toBe('Copied to clipboard');
        expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
        expect(button()).toHaveTextContent('COPY');
        act(() => vi.advanceTimersByTime(TOAST_MS));
        expect(toast().hidden).toBe(true);
    });

    it('takes a custom label and an accessible name for a short label', () => {
        render(<CopyButton text="x" label="CSV" ariaLabel="Download CSV" />);
        expect(button()).toHaveTextContent('CSV');
        expect(screen.getByRole('button', { name: 'Download CSV' })).toBe(button());
    });

    it('says nothing when the clipboard refuses', async () => {
        writeText.mockRejectedValue(new Error('not allowed'));
        render(<CopyButton text="x" />);
        fireEvent.click(button());
        await settle();
        await settle();
        expect(toast()).toBeNull();
        expect(button()).toHaveTextContent('COPY');
    });
});
