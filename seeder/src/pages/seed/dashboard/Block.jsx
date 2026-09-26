import HelpTip from '../../../shared/HelpTip';

/*
 * One titled block of results inside a section (Find near me, Farms): a small muted
 * heading over the block's list, its states and notes. `help` ({ label, text }, see
 * shared/help.js) adds a "?" beside the heading, outside it: the heading's name stays
 * the title alone.
 */
export function Block({ title, help = null, children }) {
    return (
        <div className="where-block">
            <h4 className={help ? 'where-block__title where-block__title--help' : 'where-block__title'}>{title}</h4>
            {help && <HelpTip {...help} />}
            {children}
        </div>
    );
}

export default Block;
