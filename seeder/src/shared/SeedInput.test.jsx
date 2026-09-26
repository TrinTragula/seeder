import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedInput, { seedFromInput } from './SeedInput';
import { seedFromString } from '../util/seed';

const field = () => screen.getByLabelText('Seed');
const go = () => screen.getByRole('button', { name: 'GO' });
const random = () => screen.getByRole('button', { name: /Random/ });

describe('seedFromInput', () => {
    it('keeps an integer as it is, however long, and trims around it', () => {
        expect(seedFromInput('123')).toBe('123');
        expect(seedFromInput('-42')).toBe('-42');
        expect(seedFromInput(' 8091867987493326313 ')).toBe('8091867987493326313');
        expect(seedFromInput('-9223372036854775808')).toBe('-9223372036854775808');
    });
    it('writes an integer the canonical way: no plus sign, no leading zeros, no -0', () => {
        expect(seedFromInput('+5')).toBe('5');
        expect(seedFromInput('007')).toBe('7');
        expect(seedFromInput('-0')).toBe('0');
    });
    it('hashes an integer too big for a 64-bit long, like Minecraft does', () => {
        expect(seedFromInput('18446744073709551615')).toBe(String(seedFromString('18446744073709551615')));
        expect(seedFromInput('9223372036854775808')).toBe(String(seedFromString('9223372036854775808')));
    });
    it('hashes anything else like Minecraft does, "1.5" included', () => {
        expect(seedFromInput('hello')).toBe('99162322');
        expect(seedFromInput('12abc')).toBe(String(seedFromString('12abc')));
        expect(seedFromInput('1.5')).toBe(String(seedFromString('1.5')));
    });
});

describe('SeedInput', () => {
    it('GO submits a numeric seed as is, 64-bit values intact', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<SeedInput value="1" onSubmit={onSubmit} onRandom={() => { }} />);
        await user.clear(field());
        await user.type(field(), '8091867987493326313');
        await user.click(go());
        expect(onSubmit).toHaveBeenCalledWith('8091867987493326313');
    });

    it('Enter submits too, and text is hashed while the field keeps what was typed', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<SeedInput value="1" onSubmit={onSubmit} onRandom={() => { }} />);
        await user.clear(field());
        await user.type(field(), 'hello{Enter}');
        expect(onSubmit).toHaveBeenCalledWith('99162322');
        expect(field()).toHaveValue('hello');
    });

    it('ignores an empty or blank field', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<SeedInput value="1" onSubmit={onSubmit} onRandom={() => { }} />);
        await user.clear(field());
        await user.click(go());
        await user.type(field(), '   {Enter}');
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Random calls onRandom', async () => {
        const user = userEvent.setup();
        const onRandom = vi.fn();
        render(<SeedInput value="1" onSubmit={() => { }} onRandom={onRandom} />);
        await user.click(random());
        expect(onRandom).toHaveBeenCalledTimes(1);
        expect(random()).toHaveTextContent('Random seed');
    });

    it('disabled holds the Random button while typing, GO and Enter keep working', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<SeedInput value="1" onSubmit={onSubmit} onRandom={() => { }} disabled />);
        expect(random()).toBeDisabled();
        expect(go()).toBeEnabled();
        expect(field()).toBeEnabled();
        await user.clear(field());
        await user.type(field(), '7{Enter}');
        expect(onSubmit).toHaveBeenCalledWith('7');
    });

    it('follows the value from outside (Random, a saved world) ...', () => {
        const { rerender } = render(<SeedInput value="1" onSubmit={() => { }} onRandom={() => { }} />);
        expect(field()).toHaveValue('1');
        rerender(<SeedInput value="424242" onSubmit={() => { }} onRandom={() => { }} />);
        expect(field()).toHaveValue('424242');
    });

    it('... but leaves typed text alone when it already means the new value', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<SeedInput value="1" onSubmit={() => { }} onRandom={() => { }} />);
        await user.clear(field());
        await user.type(field(), 'hello');
        // The page hashed "hello" and now passes the hash back down.
        rerender(<SeedInput value="99162322" onSubmit={() => { }} onRandom={() => { }} />);
        expect(field()).toHaveValue('hello');
    });

    it('... including a number written another way, like "007" for 7', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        const { rerender } = render(<SeedInput value="1" onSubmit={onSubmit} onRandom={() => { }} />);
        await user.clear(field());
        await user.type(field(), '007{Enter}');
        expect(onSubmit).toHaveBeenCalledWith('7');
        rerender(<SeedInput value="7" onSubmit={onSubmit} onRandom={() => { }} />);
        expect(field()).toHaveValue('007');
        rerender(<SeedInput value="8" onSubmit={onSubmit} onRandom={() => { }} />);
        expect(field()).toHaveValue('8');
    });

    it('compact puts everything on one row with a short Random label', () => {
        render(<SeedInput value="1" onSubmit={() => { }} onRandom={() => { }} compact />);
        expect(screen.getByRole('button', { name: 'Random' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Random seed' })).toBeNull();
        expect(go()).toBeInTheDocument();
        expect(field()).toHaveValue('1');
    });
});
