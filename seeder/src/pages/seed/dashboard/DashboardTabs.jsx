import { useRef } from 'react';

// DOM ids of a tab and of the panel it controls (the panels are rendered by SeedPanel).
export const tabId = (id) => `dashboard-tab-${id}`;
export const panelId = (id) => `dashboard-panel-${id}`;

const MOVES = {
    ArrowRight: (i, n) => (i + 1) % n,
    ArrowLeft: (i, n) => (i - 1 + n) % n,
    Home: () => 0,
    End: (i, n) => n - 1,
};

/*
 * The dashboard's tab strip: sticky at the top of the panel on desktop, in the sheet's
 * header on phones (`inHeader`). WAI-ARIA tabs with automatic activation: only the
 * selected tab is in the tab order; arrows, Home and End move and open. The accessible
 * name is the full label.
 */
export default function DashboardTabs({ tabs, active, onSelect, listRef, inHeader = false }) {
    const buttons = useRef([]);
    const onKeyDown = (event, index) => {
        const move = MOVES[event.key];
        if (!move) return;
        event.preventDefault();
        const next = move(index, tabs.length);
        buttons.current[next]?.focus();
        onSelect(tabs[next].id);
    };
    return (
        <div ref={listRef} className={inHeader ? 'dashboard-tabs dashboard-tabs--header' : 'dashboard-tabs'} role="tablist" aria-label="Dashboard">
            {tabs.map((tab, index) => {
                const selected = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        ref={(el) => { buttons.current[index] = el; }}
                        type="button"
                        role="tab"
                        id={tabId(tab.id)}
                        className="dashboard-tab"
                        aria-label={tab.label}
                        aria-selected={selected}
                        aria-controls={panelId(tab.id)}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onSelect(tab.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                    >
                        <img className="dashboard-tab__icon" src={tab.icon} alt="" width="20" height="20" />
                        <span className="dashboard-tab__label">{tab.short}</span>
                    </button>
                );
            })}
        </div>
    );
}
