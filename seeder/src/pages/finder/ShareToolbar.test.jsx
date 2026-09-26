import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import ShareToolbar, { LONG_LINK } from './ShareToolbar';
import { toHitView } from './hitModel';
import { DEFAULT_CRITERIA } from './criteria';
import { CSV_HEADER } from './exporters';
import { STRUCTURES_OPTIONS, VERSIONS } from '../../util/constants';
import { SITE_URL } from '../../shared/seedUrl';

const VILLAGE = STRUCTURES_OPTIONS.find((s) => s.pureText === 'Village').value;
const BIG = '8091867987493326313';
const criteria = { ...DEFAULT_CRITERIA, mcVersion: VERSIONS['26.3'], structures: [VILLAGE], rangeBlocks: 300, startingSeed: 5n };
const viewsOf = (seeds) => seeds.map((seed, index) => toHitView({ seed, spawnX: 0, spawnZ: 0, index, structures: [{ type: VILLAGE, x: 16, z: 16 }] }, criteria));
const views = viewsOf([BIG, '-5', '7']);
const params = (url) => new URL(url).searchParams;

// Clicks a copy button the way a user does and returns what reached the clipboard.
async function copied(name) {
    navigator.clipboard.writeText.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
    return navigator.clipboard.writeText.mock.calls[0]?.[0];
}

let clicked;
beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
    clicked = [];
    URL.createObjectURL = vi.fn((blob) => { clicked.blob = blob; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicked.push(this.download); });
});
afterEach(() => {
    vi.restoreAllMocks();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    delete navigator.share;
});

describe('ShareToolbar', () => {
    it('collapsible: one "Share / export" button that opens and shuts the row', () => {
        render(<ShareToolbar criteria={criteria} views={views} cursor={12345n} collapsible />);
        const toggle = screen.getByRole('button', { name: 'Share / export' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('toolbar')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const bar = screen.getByRole('toolbar', { name: 'Share and export' });
        expect(toggle).toHaveAttribute('aria-controls', bar.id);
        expect(within(bar).getByRole('button', { name: 'Download CSV' })).toBeEnabled();
        fireEvent.click(toggle);
        expect(screen.queryByRole('toolbar')).toBeNull();
    });

    it('not collapsible (desktop): the row, no toggle', () => {
        render(<ShareToolbar criteria={criteria} views={views} cursor={12345n} />);
        expect(screen.queryByRole('button', { name: 'Share / export' })).toBeNull();
        expect(screen.getByRole('toolbar', { name: 'Share and export' })).toBeInTheDocument();
    });

    it('is one labelled toolbar with a Share and an Export group', () => {
        render(<ShareToolbar criteria={criteria} views={views} cursor={12345n} />);
        const bar = screen.getByRole('toolbar', { name: 'Share and export' });
        const share = within(bar).getByRole('group', { name: 'Share' });
        const exp = within(bar).getByRole('group', { name: 'Export' });
        // Short labels on screen, the full phrases as accessible names.
        expect(within(share).getAllByRole('button').map((b) => b.textContent)).toEqual(['Share link']);
        expect(within(share).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Share these results']);
        expect(within(exp).getAllByRole('button').map((b) => b.textContent)).toEqual(['Copy seeds', 'CSV', 'JSON']);
        expect(within(exp).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Copy all seeds', 'Download CSV', 'Download JSON']);
    });

    it('"Share these results" lists every row\'s seed in order with start = the cursor', async () => {
        render(<ShareToolbar criteria={criteria} views={views} cursor={2n ** 60n} />);
        const url = await copied('Share these results');
        expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
        expect(url.startsWith(`${SITE_URL}/finder/?`)).toBe(true);
        expect(params(url).get('seeds')).toBe(`${BIG},-5,7`);
        expect(params(url).get('start')).toBe(String(2n ** 60n));
        expect(params(url).get('structures')).toBe(String(VILLAGE));
    });

    it('"Copy all seeds" copies one seed per line', async () => {
        render(<ShareToolbar criteria={criteria} views={views} cursor={0n} />);
        expect(await copied('Copy all seeds')).toBe(`${BIG}\n-5\n7`);
    });

    it('the downloads name their files and carry the rows (JSON start = the cursor)', async () => {
        render(<ShareToolbar criteria={criteria} views={views} cursor={99n} />);
        fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
        expect(clicked[0]).toMatch(/^seeder-seeds-26\.3-\d{8}\.csv$/);
        expect((await clicked.blob.text()).split('\r\n')[0]).toBe(CSV_HEADER);
        fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
        expect(clicked[1]).toMatch(/^seeder-seeds-26\.3-\d{8}\.json$/);
        const json = JSON.parse(await clicked.blob.text());
        expect(json.start).toBe('99');
        expect(json.hits.map((h) => h.seed)).toEqual([BIG, '-5', '7']);
    });

    it('"Share…" only with navigator.share, called with the results URL, and disabled without rows', async () => {
        const { rerender } = render(<ShareToolbar criteria={criteria} views={views} cursor={1n} />);
        expect(screen.queryByRole('button', { name: 'Share…' })).toBeNull();
        navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }));
        document.title = 'Minecraft seed finder - Seeder';
        rerender(<ShareToolbar criteria={criteria} views={views} cursor={1n} canShareNative />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share…' })); });
        const [{ title, url }] = navigator.share.mock.calls[0];
        expect(title).toBe('Minecraft seed finder - Seeder');
        expect(params(url).get('seeds')).toBe(`${BIG},-5,7`);
        expect(params(url).get('start')).toBe('1');
        rerender(<ShareToolbar criteria={criteria} views={[]} cursor={1n} canShareNative />);
        expect(screen.getByRole('button', { name: 'Share…' })).toBeDisabled();
    });

    it('without rows the share link and the exports are disabled, and no criteria-only link exists', () => {
        render(<ShareToolbar criteria={criteria} views={[]} cursor={0n} />);
        for (const name of ['Share these results', 'Copy all seeds', 'Download CSV', 'Download JSON']) {
            expect(screen.getByRole('button', { name })).toBeDisabled();
        }
        expect(screen.queryByRole('button', { name: 'Share this search' })).toBeNull();
    });

    it('warns about a seeds link longer than 2 000 characters', () => {
        const { rerender } = render(<ShareToolbar criteria={criteria} views={views} cursor={0n} />);
        expect(screen.queryByText('Long link: some apps truncate it.')).toBeNull();
        // 50 seeds of 19-20 digits make ~1.1 kB; 110 of them go past the limit.
        const many = viewsOf(Array.from({ length: 110 }, (_, i) => `-${BigInt(BIG) + BigInt(i)}`));
        rerender(<ShareToolbar criteria={criteria} views={many} cursor={0n} />);
        expect(LONG_LINK).toBe(2000);
        expect(screen.getByText('Long link: some apps truncate it.')).toBeInTheDocument();
    });
});
