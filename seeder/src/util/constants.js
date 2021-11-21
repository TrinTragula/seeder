export const BIOMES = [
    { value: 0, label: "Ocean" },
    { value: 1, label: "Plains" },
    { value: 2, label: "Desert" },
    { value: 3, label: "Windswept Hills" },
    { value: 4, label: "Forest" },
    { value: 5, label: "Taiga" },
    { value: 6, label: "Swamp" },
    { value: 7, label: "River" },
    { value: 8, label: "Nether Wastes" },
    { value: 9, label: "The End" },
    { value: 10, label: "Frozen Ocean" },
    { value: 11, label: "Frozen River" },
    { value: 12, label: "Snowy Plains" },
    { value: 13, label: "Snowy Mountains" },
    { value: 14, label: "Mushroom Fields" },
    { value: 15, label: "Mushroom Field Shore" },
    { value: 16, label: "Beach" },
    { value: 17, label: "Desert Hills" },
    { value: 18, label: "Wooded Hills" },
    { value: 19, label: "Taiga Hills" },
    { value: 20, label: "Mountain Edge" },
    { value: 21, label: "Jungle" },
    { value: 22, label: "Jungle Hills" },
    { value: 23, label: "Sparse Jungle" },
    { value: 24, label: "Deep Ocean" },
    { value: 25, label: "Stony Shore" },
    { value: 26, label: "Snowy Beach" },
    { value: 27, label: "Birch Forest" },
    { value: 28, label: "Birch Forest Hills" },
    { value: 29, label: "Dark Forest" },
    { value: 30, label: "Snowy Taiga" },
    { value: 31, label: "Snowy Taiga Hills" },
    { value: 32, label: "Giant Tree Taiga" },
    { value: 33, label: "Giant Tree Taiga Hills" },
    { value: 34, label: "Windswept Forest" },
    { value: 35, label: "Savanna" },
    { value: 36, label: "Savanna Plateau" },
    { value: 37, label: "Badlands" },
    { value: 38, label: "Wooded Badlands" },
    { value: 39, label: "Badlands Plateau" },
    { value: 40, label: "Small End Islands" },
    { value: 41, label: "End Midlands" },
    { value: 42, label: "End Highlands" },
    { value: 43, label: "End Barrens" },
    { value: 44, label: "Warm Ocean" },
    { value: 45, label: "Lukewarm Ocean" },
    { value: 46, label: "Cold Ocean" },
    { value: 47, label: "Deep Warm Ocean" },
    { value: 48, label: "Deep Lukewarm Ocean" },
    { value: 49, label: "Deep Cold Ocean" },
    { value: 50, label: "Deep Frozen Ocean" },
    { value: 127, label: "The Void" },
    { value: 129, label: "Sunflower Plains" },
    { value: 130, label: "Desert Lakes" },
    { value: 131, label: "Windswept Gravelly Hills" },
    { value: 132, label: "Flower Forest" },
    { value: 133, label: "Taiga Mountains" },
    { value: 134, label: "Swamp Hills" },
    { value: 140, label: "Ice Spikes" },
    { value: 149, label: "Modified Jungle" },
    { value: 151, label: "Modified Jungle Edge" },
    { value: 155, label: "Tall Birch Forest" },
    { value: 156, label: "Tall Birch Hills" },
    { value: 157, label: "Dark Forest Hills" },
    { value: 158, label: "Snowy Taiga Mountains" },
    { value: 160, label: "Giant Spruce Taiga" },
    { value: 161, label: "Giant Spruce Taiga Hills" },
    { value: 162, label: "Modified Gravelly Mountains" },
    { value: 163, label: "Windswept Savanna" },
    { value: 164, label: "Shattered Savanna Plateau" },
    { value: 165, label: "Eroded Badlands" },
    { value: 166, label: "Modified Wooded Badlands Plateau" },
    { value: 167, label: "Modified Badlands Plateau" },
    { value: 168, label: "Bamboo Jungle" },
    { value: 169, label: "Bamboo Jungle Hills" },
    { value: 170, label: "Soul Sand Valley" },
    { value: 171, label: "Crimson Forest" },
    { value: 172, label: "Warped Forest" },
    { value: 173, label: "Basalt Delta" },
    { value: 174, label: "Dripstone Caves" },
    { value: 175, label: "Lusch Caves" },
    { value: 177, label: "Meadow" },
    { value: 178, label: "Grove" },
    { value: 179, label: "Snowy Slopes" },
    { value: 180, label: "Jagged Peaks" },
    { value: 181, label: "Frozen Peaks" },
    { value: 182, label: "Stony Peaks" },
];

export const VERSIONS = {
    "1.0": 0,
    "1.1": 1,
    "1.2": 2,
    "1.3": 3,
    "1.4": 4,
    "1.5": 5,
    "1.6": 6,
    "1.7": 7,
    "1.8": 8,
    "1.9": 9,
    "1.10": 10,
    "1.11": 11,
    "1.12": 12,
    "1.13": 13,
    "1.14": 14,
    "1.15": 15,
    "1.16": 16,
    "1.17": 17,
    "1.18": 18,
};

export const VERSIONS_OPTIONS = Object.keys(VERSIONS).map(v => ({ label: v, value: VERSIONS[v] }));

export const STRUCTURES_OPTIONS = [
    { value: 1, pureText: "Desert Pyramid", label: <div className="flex-row flex-align-center"><img alt="Desert Pyramid" src="/img/temple.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Desert Pyramid</div> },
    { value: 2, pureText: "Jungle Pyramid", label: <div className="flex-row flex-align-center"><img alt="Jungle Pyramid" src="/img/jungle.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Jungle Pyramid</div> },
    { value: 3, pureText: "Swamp Hut", label: <div className="flex-row flex-align-center"><img alt="Swamp Hut" src="/img/hut.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Swamp Hut</div> },
    { value: 4, pureText: "Igloo", label: <div className="flex-row flex-align-center"><img alt="Igloo" src="/img/igloo.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Igloo</div> },
    { value: 5, pureText: "Village", label: <div className="flex-row flex-align-center"><img alt="Village" src="/img/village.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Village</div> },
    { value: 6, pureText: "Ocean Ruin", label: <div className="flex-row flex-align-center"><img alt="Ocean Ruin" src="/img/ocean.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Ocean Ruin</div> },
    { value: 7, pureText: "Shipwreck", label: <div className="flex-row flex-align-center"><img alt="Shipwreck" src="/img/wood.jpg" style={{ paddingRight: '15px' }} height="30px" width="30px" />Shipwreck</div> },
    { value: 8, pureText: "Monument", label: <div className="flex-row flex-align-center"><img alt="Monument" src="/img/guardian.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Monument</div> },
    { value: 9, pureText: "Mansion", label: <div className="flex-row flex-align-center"><img alt="Mansion" src="/img/mansion.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Mansion</div> },
    { value: 10, pureText: "Outpost", label: <div className="flex-row flex-align-center"><img alt="Outpost" src="/img/outpost.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Outpost</div> },
    { value: 11, pureText: "Ruined Portal", label: <div className="flex-row flex-align-center"><img alt="Ruined Portal" src="/img/portal.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Ruined Portal</div> },
    // 12 Ruined_Portal_N,
    // 13 Treasure,
    // 14 Mineshaft,
    { value: 15, pureText: "Fortress", label: <div className="flex-row flex-align-center"><img alt="Fortress" src="/img/fortress.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Fortress</div> },
    { value: 16, pureText: "Bastion", label: <div className="flex-row flex-align-center"><img alt="Bastion" src="/img/bastion.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Bastion</div> },
    { value: 17, pureText: "End City", label: <div className="flex-row flex-align-center"><img alt="End City" src="/img/end_city.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />End City</div> },
    { value: 18, pureText: "End Gateway", label: <div className="flex-row flex-align-center"><img alt="End Gateway" src="/img/end_gateway.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />End Gateway</div> },
];

export const DIMENSIONS_OPTIONS = [
    { value: 0, label: <div className="flex-row flex-align-center"><img alt="Overworld" src="/img/grass.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Overworld</div> },
    { value: -1, label: <div className="flex-row flex-align-center"><img alt="Nether" src="/img/nether_bricks.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />Nether</div> },
    { value: 1, label: <div className="flex-row flex-align-center"><img alt="End" src="/img/endstone.png" style={{ paddingRight: '15px' }} height="30px" width="30px" />End</div> },
];

export const HEIGHT_OPTIONS = [
    { value: 320, label: "Surface (Y=320)" },
    { value: 62, label: "Sea level (Y=62)" },
    { value: 42, label: "Underground (Y=42)" },
    { value: 0, label: "Deep undergorund (Y=0)" },
    { value: -30, label: "Deeper undergorund (Y=-30)" },
    { value: -70, label: "Bedrock (Y=-64)" },
]