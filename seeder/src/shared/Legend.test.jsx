import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Legend from './Legend';
import { BIOMES } from '../util/constants';
import { FAKE_COLORS } from '../test/fakes';

describe('Legend', () => {
    it('lists every biome with the colour the map paints it in', () => {
        render(<Legend colors={FAKE_COLORS} onClose={() => { }} />);
        for (const { label } of BIOMES) expect(screen.getByText(label)).toBeInTheDocument();
        const swatch = screen.getByText('Plains').previousSibling;
        expect(swatch).toHaveStyle({ backgroundColor: `rgba(${FAKE_COLORS[1].join(', ')})` });
        const other = screen.getByText('Desert').previousSibling;
        expect(other).toHaveStyle({ backgroundColor: `rgba(${FAKE_COLORS[2].join(', ')})` });
    });

    it('still lists the biomes before the palette has arrived, with blank swatches', () => {
        render(<Legend colors={null} onClose={() => { }} />);
        for (const { label } of BIOMES) expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.getByText('Plains').previousSibling.style.backgroundColor).toBe('');
    });

    it('lists only the given biomes when told which apply', () => {
        render(<Legend colors={FAKE_COLORS} biomes={[8, 170]} onClose={() => { }} />);
        expect(screen.getByText('Nether Wastes')).toBeInTheDocument();
        expect(screen.getByText('Soul Sand Valley')).toBeInTheDocument();
        expect(screen.queryByText('Plains')).toBeNull();
    });

    it('Close calls onClose', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<Legend colors={FAKE_COLORS} onClose={onClose} />);
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
