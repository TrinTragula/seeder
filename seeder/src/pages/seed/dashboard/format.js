// Display helpers of the dashboard's own. The ones the finder shares live in src/shared/format.js.

export { DIMENSION_LABELS } from '../../../shared/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * "just now", "5 min ago", "3 h ago", "2 days ago" for the last week, the local date
 * after that. A timestamp in the future (another device's clock) reads "just now".
 */
export function relativeTime(iso, now = Date.now()) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const ago = Math.max(0, now - then);
    if (ago < MINUTE) return 'just now';
    if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
    if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
    const days = Math.floor(ago / DAY);
    if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
    return new Date(then).toLocaleDateString();
}
