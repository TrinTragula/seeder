import { createContext, useContext } from 'react';

const DashboardContext = createContext(null);

/*
 * What every dashboard section needs, without prop threading. SeedPanel
 * provides:
 *   world               { seed: "decimal", mcVersion: <int>, dimension: 0|-1|1, yHeight, versionLabel,
 *                       largeBiomes: bool }. mcVersion is the plain VERSIONS int (version checks,
 *                       GET_VERSION_SUPPORT); every other engine request sends
 *                       engineVersion(mcVersion, largeBiomes, <the request's dimension>).
 *   mapApi              ref to MapCanvas' api (zoom, dezoom, the pans, panTo, setHighlight, setOverlay, getDrawer)
 *   sheetApi            ref to the bottom sheet's { open(snap), close(), getSnap() }; .current is null on desktop
 *   structuresToShow    StructureType ints drawn on the map, and setStructuresToShow
 *   slimeOverlay        whether the map draws the slime-chunk grid (SeedPage's state, so Find near me
 *                       and Farms share one toggle), and setSlimeOverlay(bool)
 *   setDimension(dim)   switch the page to another dimension (0 | -1 | 1), as the controls'
 *                       Dimension select does: SeedPage's URL state (Farms' "Switch to the Nether")
 *   worlds              the page's one saved-worlds store: useWorlds()' { worlds, add, remove, rename, touch, isSaved }
 *   showSection(id)     go to a section: open its tab (and the sheet fully on a phone), scroll to it
 * `worlds` is one store for the whole panel because useWorlds() instances do not see
 * each other's writes (they only listen to other tabs): the Save button in the
 * controls and the My worlds list must share it to agree.
 */
export function DashboardProvider({ value, children }) {
    return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
    const value = useContext(DashboardContext);
    if (!value) throw new Error('useDashboard() must be used inside a <DashboardProvider>');
    return value;
}
