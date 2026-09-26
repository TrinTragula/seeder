import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GoogleAd from '../../../shared/GoogleAd';
import Footer from '../../../shared/Footer';
import { AD_SLOT_RESPONSIVE } from '../../../shared/ads';
import { useWorlds } from '../../../shared/worlds';
import { DashboardProvider } from './DashboardContext';
import { SECTIONS, TABS, FIRST_TAB, AD_TAB, tabOfSection } from './sections';
import Section from './Section';
import DashboardTabs, { panelId, tabId } from './DashboardTabs';
import SpawnSection from './SpawnSection';
import StrongholdsSection from './StrongholdsSection';
import StructuresSection from './StructuresSection';
import BiomesSection from './BiomesSection';
import WhereAmISection from './WhereAmISection';
import BiomeLocatorSection from './BiomeLocatorSection';
import FarmsSection from './FarmsSection';
import MyWorldsSection from './MyWorldsSection';
import './dashboard.css';

// The body of every section, by section id. A section without an entry renders as "on its way".
const BODIES = {
    spawn: SpawnSection,
    strongholds: StrongholdsSection,
    structures: StructuresSection,
    biomes: BiomesSection,
    where: WhereAmISection,
    locator: BiomeLocatorSection,
    farms: FarmsSection,
    worlds: MyWorldsSection,
};

const SECTION_OF = new Map(SECTIONS.map((s) => [s.id, s]));
// Room left between the sticky tab bar and a section scrolled to by showSection.
const SCROLL_GAP = 8;

// The panel's scroll container: the desktop <aside> or the sheet's content (both #dashboard).
const scrollerOf = (el) => el?.closest('#dashboard') ?? null;

/*
 * The seed page's panel, the same in the desktop column and in the bottom sheet: a
 * sticky tab bar, the open tab's panel, then the footer. A tab mounts its sections the
 * first time it is opened and keeps them mounted, hidden, afterwards, so a located
 * point survives a look at another tab. Ads never sit next to GO / Random (outside
 * this panel) and never over the map.
 *
 * `tabsHost` (phones): an element in the bottom sheet's header. The tab strip is portalled
 * there, under the seed row, so it shows at every snap, collapsed included; its state stays
 * here. A tab tapped while the sheet is collapsed opens the sheet halfway.
 */
export default function SeedPanel({
    world, mapApi, sheetApi, structuresToShow, setStructuresToShow, slimeOverlay, setSlimeOverlay, setDimension, controls,
    tabsHost = null,
}) {
    const [active, setActive] = useState(FIRST_TAB);
    const [visited, setVisited] = useState(() => new Set([FIRST_TAB]));
    // The section showSection() is heading for, scrolled to once its tab has rendered.
    const [target, setTarget] = useState(null);
    // The spot the sticky tab bar starts from, and the bar itself.
    const anchorRef = useRef(null);
    const tabsRef = useRef(null);

    const select = useCallback((id) => {
        if (sheetApi.current?.getSnap() === 'collapsed') sheetApi.current.open('half');
        setActive(id);
        setVisited((ids) => (ids.has(id) ? ids : new Set(ids).add(id)));
        // Scrolled past the bar: start the new tab at its top, right under the bar.
        const anchor = anchorRef.current;
        const box = scrollerOf(anchor);
        if (!box) return;
        const start = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
        if (box.scrollTop > start) box.scrollTop = start;
    }, [sheetApi]);

    // Go to a section like following a link to it: its tab, the sheet fully open on a phone.
    const showSection = useCallback((id) => {
        const tab = tabOfSection(id);
        if (!tab) return;
        sheetApi.current?.open('full');
        select(tab);
        setTarget(id);
    }, [sheetApi, select]);

    useEffect(() => {
        if (!target) return;
        setTarget(null);
        const el = document.getElementById(target);
        const box = scrollerOf(anchorRef.current);
        if (!el || !box || !tabsRef.current) return;
        box.scrollTop += el.getBoundingClientRect().top - tabsRef.current.getBoundingClientRect().bottom - SCROLL_GAP;
    }, [target, active]);

    // useWorlds() returns a fresh object every render; keep the context stable. Its
    // methods are stable callbacks, and isSaved changes exactly when the list does.
    const store = useWorlds();
    const worlds = useMemo(() => store, [store.worlds, store.isSaved]);

    const { seed, mcVersion, dimension, yHeight, versionLabel, largeBiomes = false } = world;
    const value = useMemo(() => ({
        world: { seed, mcVersion, dimension, yHeight, versionLabel, largeBiomes },
        mapApi, sheetApi, structuresToShow, setStructuresToShow, slimeOverlay, setSlimeOverlay, setDimension, worlds, showSection,
    }), [seed, mcVersion, dimension, yHeight, versionLabel, largeBiomes, mapApi, sheetApi, structuresToShow, setStructuresToShow,
        slimeOverlay, setSlimeOverlay, setDimension, worlds, showSection]);

    return (
        <DashboardProvider value={value}>
            <div ref={anchorRef} className="dashboard-tabs__anchor" aria-hidden="true" />
            {tabsHost
                ? createPortal(<DashboardTabs tabs={TABS} active={active} onSelect={select} listRef={tabsRef} inHeader />, tabsHost)
                : <DashboardTabs tabs={TABS} active={active} onSelect={select} listRef={tabsRef} />}
            {TABS.map((tab) => (
                <div
                    key={tab.id}
                    role="tabpanel"
                    id={panelId(tab.id)}
                    aria-labelledby={tabId(tab.id)}
                    className="dashboard-panel"
                    hidden={tab.id !== active}
                >
                    {visited.has(tab.id) && (
                        <>
                            {tab.id === 'map' && (
                                <>
                                    {controls}
                                    <GoogleAd slot={AD_SLOT_RESPONSIVE} />
                                </>
                            )}
                            {tab.sections.map((id) => {
                                const Body = BODIES[id];
                                return (
                                    <Section key={id} id={id} title={SECTION_OF.get(id).label} icon={SECTION_OF.get(id).icon} force comingSoon={!Body}>
                                        {Body && <Body />}
                                    </Section>
                                );
                            })}
                            {tab.id === AD_TAB && <GoogleAd slot={AD_SLOT_RESPONSIVE} />}
                        </>
                    )}
                </div>
            ))}
            <Footer compact />
        </DashboardProvider>
    );
}
