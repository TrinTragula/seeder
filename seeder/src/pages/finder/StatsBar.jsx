import { toHHMMSS } from '../../util/functions';
import HelpTip from '../../shared/HelpTip';
import { HELP } from '../../shared/help';
import { maxSeedsToScanFor } from './criteria';

const number = (n) => Number(n).toLocaleString('en-US');
const bigNumber = (n) => BigInt(n).toLocaleString('en-US');
// toHHMMSS floors to whole seconds; most structure runs end in ~100 ms.
const took = (ms) => (ms < 1000 ? 'under 1s' : toHHMMSS(ms));

// Structure searches scan lower-48 layouts (65 536 seeds each); biome searches scan seeds.
export const unitOf = (criteria) => (criteria?.structures?.length > 0 ? 'layouts' : 'seeds');
// What the scan counter's "?" says for each unit.
const unitHelp = (unit) => (unit === 'layouts' ? HELP.layouts : HELP.seedsScanned);

// Share of the scan cap consumed, 0..1. BigInt first: examined can pass 2^53.
function fraction(examined, max) {
    if (!(max > 0n)) return 0;
    const permille = (BigInt(examined) * 1000n) / max;
    return Math.min(1, Number(permille) / 1000);
}

/*
 * The results column's head: while searching, the live counters, the scan
 * progress and STOP; once done, one sentence for how the run ended. Nothing while
 * idle - a criteria URL that has not been searched shows no status at all.
 * Props: status, progress (throttled coordinator progress or null), target (count),
 * result (the run's end, see useFinderSearch), criteria (the run's), onStop.
 */
export default function StatsBar({ status, progress, target, result, criteria, onStop }) {
    if (status === 'idle') return null;
    const unit = unitOf(criteria);
    const found = progress?.hits ?? 0;

    if (status === 'done' && result) {
        const checked = number(result.tested);
        const kept = found === 1 ? '1 result' : `${number(found)} results`;
        let sentence;
        if (result.reason === 'error') {
            return (
                <div className="stats-bar stats-bar--done">
                    <p className="stats-bar__error" role="alert">{result.error?.message ?? 'The search failed.'}</p>
                </div>
            );
        }
        if (result.reason === 'target') {
            sentence = `Found all ${number(target)} seeds after ${checked} seeds checked in ${took(result.elapsedMs)}.`;
        } else if (result.reason === 'exhausted') {
            sentence = `Found ${number(found)} of ${number(target)} after scanning ${bigNumber(result.examined)} ${unit}: try a wider range or fewer criteria.`;
        } else {
            sentence = `Stopped after ${checked} seeds checked; ${kept} kept.`;
        }
        return (
            <div className="stats-bar stats-bar--done">
                <p className="stats-bar__sentence" role="status">{sentence}</p>
                {/* Outside the status: its text stays the sentence alone. */}
                {result.reason === 'exhausted' && <HelpTip {...unitHelp(unit)} />}
            </div>
        );
    }

    const tested = progress?.tested ?? 0;
    const elapsedMs = progress?.elapsedMs ?? 0;
    const rate = elapsedMs > 0 ? Math.round((tested / elapsedMs) * 1000) : 0;
    const examined = progress?.examined ?? 0n;
    const max = criteria ? maxSeedsToScanFor(criteria) : 0n;
    return (
        <div className="stats-bar stats-bar--searching">
            <div className="stats-bar__text" role="status">
                <p className="stats-bar__line">
                    Searching… {number(tested)} seeds checked · {number(rate)} seeds/s · {toHHMMSS(elapsedMs)}
                </p>
                <p className="stats-bar__found">found {number(found)} of {number(target)}</p>
            </div>
            <div className="stats-bar__progress">
                <progress aria-label="Search progress" max={1} value={fraction(examined, max)} />
                <span className="stats-bar__scanned">
                    {bigNumber(examined)} of {bigNumber(max)} {unit} scanned{' '}
                    <HelpTip {...unitHelp(unit)} />
                </span>
            </div>
            <button type="button" className="btn btn--danger stats-bar__stop" onClick={onStop}>STOP</button>
        </div>
    );
}
