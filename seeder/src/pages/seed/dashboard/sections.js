/*
 * The dashboard's sections and the tabs that hold them. Section ids are part of the
 * in-page link contract (#worlds, showSection) and never change. `icon` is the small
 * decorative picture before each section's heading.
 */
export const SECTIONS = [
    { id: 'spawn', label: 'Spawn', icon: '/img/spawn.png' },
    { id: 'strongholds', label: 'Strongholds', icon: '/img/eye.png' },
    { id: 'structures', label: 'Structures', icon: '/img/village.png' },
    { id: 'locator', label: 'Biome locator', icon: '/svg/search.svg' },
    { id: 'biomes', label: 'Biomes', icon: '/img/grass.png' },
    { id: 'where', label: 'Find near me', icon: '/svg/pin.svg' },
    { id: 'farms', label: 'Farms', icon: '/img/hut.png' },
    { id: 'worlds', label: 'My worlds', icon: '/img/treasure.png' },
];

/*
 * The tabs, in order. `map` holds the controls (and the first ad unit) instead of
 * sections; every other tab lists its sections in display order. `label` is the tab's
 * accessible name, `short` the text under its `icon` in the strip (five columns must
 * fit 360 px; each short label is part of its label, so what is seen is what is said).
 */
export const TABS = [
    { id: 'map', label: 'Map', short: 'Map', icon: '/svg/map.svg', sections: [] },
    { id: 'world', label: 'Spawn & structures', short: 'Structures', icon: '/img/village.png', sections: ['spawn', 'strongholds', 'structures'] },
    { id: 'biomes', label: 'Biomes', short: 'Biomes', icon: '/img/grass.png', sections: ['locator', 'biomes'] },
    { id: 'near', label: 'Find near me', short: 'Near me', icon: '/svg/pin.svg', sections: ['where'] },
    { id: 'more', label: 'More', short: 'More', icon: '/svg/menu.svg', sections: ['farms', 'worlds'] },
];

// The tab the panel opens on.
export const FIRST_TAB = TABS[0].id;

// The tab whose end carries the second ad unit: the richest one.
export const AD_TAB = 'world';

// Which tab a section lives in.
export const tabOfSection = (sectionId) => TABS.find((t) => t.sections.includes(sectionId))?.id ?? null;
