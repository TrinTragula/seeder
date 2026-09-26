import { useRef } from 'react';
import { useInView } from '../../../shared/hooks/useInView';

/*
 * One dashboard section: its body mounts only once it comes near the screen (or when
 * `force`d), so nothing is computed for a section nobody scrolled to. `icon`, when
 * given, is drawn before the title.
 */
export default function Section({ id, title, icon = null, force = false, comingSoon = false, children }) {
    const ref = useRef(null);
    const inView = useInView(ref);
    const titleId = `${id}-title`;
    let body = null;
    if (comingSoon) body = <p className="section__soon">This section is on its way.</p>;
    else if (force || inView) body = children;
    return (
        <section ref={ref} id={id} className="section" aria-labelledby={titleId}>
            <h3 id={titleId} className="section__title">
                {/* Decorative: the heading's name stays the title alone. */}
                {icon && <img className="section__icon" src={icon} alt="" width="20" height="20" />}
                {title}
            </h3>
            {body}
        </section>
    );
}

// Placeholder bars while a section's query runs.
export function SectionLoading() {
    return (
        <div className="section__loading" role="status">
            <span className="sr-only">Loading…</span>
            <span className="section__bar" aria-hidden="true" />
            <span className="section__bar" aria-hidden="true" />
            <span className="section__bar" aria-hidden="true" />
        </div>
    );
}

// A section that has nothing to show for this world.
export function SectionEmpty({ children }) {
    return <p className="section__empty">{children}</p>;
}

// The engine could not answer (`error` = { code, message } from useSeedQuery).
export function SectionError({ error }) {
    return (
        <p className="section__error" role="alert">
            Could not compute this: {error?.message ?? 'unknown error'}
        </p>
    );
}
