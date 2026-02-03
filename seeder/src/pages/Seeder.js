import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { QueueManager } from '../library/queue';
import { DrawSeed } from '../library/draw';
import Select, { createFilter } from 'react-select'
import './Seeder.css';
import { VERSIONS, VERSIONS_OPTIONS, BIOMES, STRUCTURES_OPTIONS, DIMENSIONS_OPTIONS, HEIGHT_OPTIONS, OLD_VERSIONS } from '../util/constants';
import { debounce, copyToClipboard, setUrl, useDebounce, toHHMMSS } from '../util/functions';

const isNumeric = (str) => {
    if (typeof str !== "string") return false;
    return !isNaN(str) && !isNaN(parseFloat(str));
};

const filterConfig = {
    ignoreCase: true,
    ignoreAccents: true,
    trim: true,
    matchFrom: 'any',
    stringify: option => option.data.pureText,
};

const RANGE_OPTIONS = [
    { value: Math.floor(100 / 4), label: "<100 blocks" },
    { value: Math.floor(300 / 4), label: "<300 blocks" },
    { value: Math.floor(500 / 4), label: "<500 blocks" },
    { value: Math.floor(750 / 4), label: "<750 blocks" },
    { value: Math.floor(1000 / 4), label: "<1k blocks" },
    { value: Math.floor(2000 / 4), label: "<2k blocks (SLOW!)" }
];

const getRandomSeed = () => "" + Math.floor(-4_294_967_296 + Math.random() * 8_589_934_593);

const seedFromString = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h;
};

const getInitialSeed = (urlSeed) => {
    return Number.isInteger(Number.parseInt(urlSeed)) ? urlSeed + "" : getRandomSeed();
};

const getInitialVersion = (urlVersion) => {
    let version = urlVersion;
    if (isNumeric(version) && !version.includes(".")) {
        version = OLD_VERSIONS[Number.parseInt(version)];
    }
    return version && VERSIONS[version] ? VERSIONS[version] : VERSIONS["1.21.11"];
};

export default function Seeder() {
    const urlSearchParams = useMemo(() => new URLSearchParams(window.location.search), []);
    const params = useMemo(() => Object.fromEntries(urlSearchParams.entries()), [urlSearchParams]);
    const urlSeed = params?.seed;
    const urlVersion = params?.version;

    const canvas = useRef(null);
    const drawer = useRef(null);
    const mapContainer = useRef(null);

    const [mcVersion, setMcVersion] = useState(() => getInitialVersion(urlVersion));
    const [seed, setSeed] = useState(() => getInitialSeed(urlSeed));
    const [x, setX] = useState(null);
    const [z, setZ] = useState(null);
    const [biome, setBiome] = useState(null);
    const [inputSeed, setInputSeed] = useState(seed);
    const [dimension, setDimension] = useState(0);
    const [yHeight, setYHeight] = useState(256);
    const debouncedYHeight = useDebounce(yHeight, 500);
    const [queueManager] = useState(() => new QueueManager("/workers/worker.js"));

    const [biomesToFind, setBiomesToFind] = useState(null);
    const [range, setRange] = useState(null);

    const [structureToFind, setStructureToFind] = useState(null);
    const [structuresToShow, setStructuresToShow] = useState([]);

    const [isFindingSeed, setIsFindingSeed] = useState(false);
    const [findingSeedStartTime, setFindingSeedStartTime] = useState(null);
    const [findingSeedDuration, setFindingSeedDuration] = useState(null);
    const [seedFindingSpeed, setSeedFindingSpeed] = useState(0);
    const [lastFoundSeed, setLastFoundSeed] = useState(0);
    const [menuToggled, setMenuToggled] = useState(false);
    const [showStructureCoords, setShowStructureCoords] = useState(true);

    const [buttonText, setButtonText] = useState('COPY');

    const [optionsRendered, setOptionsRendered] = useState(true);
    const [finderRendered, setFinderRendered] = useState(true);

    const [showLegend, setShowLegend] = useState(false);

    const [isRandomSeedButtonDisabled, setIsRandomSeedButtonDisabled] = useState(false);

    const [isAdvancedModeEnabled, setIsAdvancedModeEnabled] = useState(false);

    // Update the finding seed timer displayed when searching seeds
    useEffect(() => {
        if (!findingSeedStartTime) return;

        const intervalId = setInterval(() => {
            setFindingSeedDuration(Date.now() - findingSeedStartTime.getTime());
        }, 1000);

        return () => clearInterval(intervalId);
    }, [findingSeedStartTime]);

    const drawSeed = useCallback((forced = false) => {
        setIsRandomSeedButtonDisabled(true);
        if (!drawer.current) {
            canvas.current.width = mapContainer.current.offsetWidth;
            canvas.current.height = mapContainer.current.offsetHeight - 15;
            drawer.current = new DrawSeed(mcVersion, queueManager, canvas.current, null, (x, z, biome) => {
                setX(x);
                setZ(z);
                setBiome(biome);
            }, 75, 1);
        }
        if (forced) {
            drawer.current.clear();
        }
        drawer.current.setShowStructureCoords(showStructureCoords);
        drawer.current.setSeed(seed);
        drawer.current.setMcVersion(mcVersion);
        drawer.current.setDimension(dimension);
        drawer.current.setYHeight(debouncedYHeight);
        drawer.current.setStructuresShown(structuresToShow);
        setUrl(seed, Object.keys(VERSIONS).find(v => VERSIONS[v] === mcVersion), setButtonText);
        drawer.current.draw(() => {
            if (forced) {
                drawer.current.findSpawn((spawnSeed) => {
                    setIsRandomSeedButtonDisabled(false);
                    if (seed === spawnSeed) {
                        drawer.current.drawStructures();
                    }
                });
                drawer.current.findStrongholds((strongholdSeed) => {
                    if (seed === strongholdSeed) {
                        drawer.current.drawStructures();
                    }
                });
                for (const structure of structuresToShow) {
                    drawer.current.findStructure(structure, (structureSeed) => {
                        if (seed === structureSeed) {
                            drawer.current.drawStructures();
                        }
                    });
                }
            } else {
                setIsRandomSeedButtonDisabled(false);
                drawer.current.drawStructures();
            }
        });
    }, [mcVersion, seed, dimension, debouncedYHeight, queueManager, structuresToShow, showStructureCoords]);

    const handleKeyDown = useCallback((e) => {
        if (!drawer.current) return;

        switch (e.key) {
            case 'ArrowUp':
                drawer.current.up();
                break;
            case 'ArrowDown':
                drawer.current.down();
                break;
            case 'ArrowLeft':
                drawer.current.left();
                break;
            case 'ArrowRight':
                drawer.current.right();
                break;
            default:
                break;
        }
    }, []);

    const onResize = useCallback(() => {
        if (mapContainer.current && canvas.current && drawer.current) {
            canvas.current.width = mapContainer.current.offsetWidth;
            canvas.current.height = mapContainer.current.offsetHeight - 15;
            drawer.current.draw();
        }
    }, []);

    useEffect(() => {
        const debouncedKeyDown = debounce(handleKeyDown, 1);
        const debouncedResize = debounce(onResize, 333);

        document.addEventListener('keydown', debouncedKeyDown);
        window.addEventListener('resize', debouncedResize);

        return () => {
            document.removeEventListener('keydown', debouncedKeyDown);
            window.removeEventListener('resize', debouncedResize);
        };
    }, [handleKeyDown, onResize]);

    useEffect(() => {
        drawSeed(true);
    }, [drawSeed]);

    const setRandomSeed = useCallback(() => {
        const newRandomSeed = getRandomSeed();
        setSeed(newRandomSeed);
        setInputSeed(newRandomSeed);
    }, []);

    const handleEnterSeed = useCallback(() => {
        let newSeed = inputSeed;
        if (newSeed && newSeed !== seed) {
            if (!isNumeric(newSeed)) {
                newSeed = seedFromString(newSeed);
            }
            setSeed(newSeed + "");
        }
    }, [inputSeed, seed]);

    const restartAll = useCallback(() => {
        queueManager.restartAll();
        setIsFindingSeed(false);
        setFindingSeedStartTime(null);
    }, [queueManager]);

    const findSeed = useCallback(() => {
        if (range > 0) {
            setIsFindingSeed(true);
            setFindingSeedStartTime(new Date());
            setSeedFindingSpeed(0);
            const start = Date.now();
            let events = 0;
            queueManager.seedUpdateCallback = () => {
                events++;
                const speed = Math.floor((events * 10000) / ((Date.now() - start) / 1000));
                setSeedFindingSpeed(speed);
            };

            const callback = (foundSeed) => {
                foundSeed = "" + foundSeed;
                setSeed(foundSeed);
                setInputSeed(foundSeed);
                setLastFoundSeed(parseInt(foundSeed, 10));
                setIsFindingSeed(false);
                setFindingSeedStartTime(null);
            };

            if (biomesToFind?.length > 0 && structureToFind) {
                queueManager.findBiomesWithStructures(
                    mcVersion,
                    structureToFind,
                    biomesToFind, -range, -range,
                    range * 2, lastFoundSeed + 1, dimension, yHeight, 9999,
                    callback
                );
            } else if (biomesToFind?.length > 0) {
                queueManager.findBiomes(
                    mcVersion,
                    biomesToFind, -range, -range,
                    range * 2, range * 2, lastFoundSeed + 1,
                    dimension, yHeight,
                    9999,
                    callback
                );
            } else if (structureToFind) {
                queueManager.findStructures(
                    mcVersion,
                    structureToFind, -range, -range,
                    range * 2, lastFoundSeed + 1, dimension, 9999,
                    callback
                );
            }
        }
    }, [range, biomesToFind, structureToFind, mcVersion, lastFoundSeed, dimension, yHeight, queueManager]);

    const handleBiomesToFindChange = useCallback((val) => {
        setLastFoundSeed(0);
        setBiomesToFind(val?.map(x => x?.value) ?? []);
    }, []);

    const handleStructureToFindChange = useCallback((val) => {
        setLastFoundSeed(0);
        setStructureToFind(val?.value);
        if (val?.value && !structuresToShow?.includes(val?.value)) {
            setStructuresToShow(prev => [val.value, ...prev]);
        }
    }, [structuresToShow]);

    const handleRangeChange = useCallback((val) => {
        setLastFoundSeed(0);
        setRange(val?.value);
    }, []);

    const handleStructuresToShowChange = useCallback((val) => {
        setStructuresToShow(val?.map(x => x?.value) ?? []);
    }, []);

    const selectedStructuresValue = useMemo(() =>
        structuresToShow ? STRUCTURES_OPTIONS.filter(v => structuresToShow.includes(v.value)) : [],
        [structuresToShow]
    );

    const selectedDimensionValue = useMemo(() =>
        DIMENSIONS_OPTIONS.find(v => v.value === dimension),
        [dimension]
    );

    const selectedVersionValue = useMemo(() =>
        VERSIONS_OPTIONS.find(v => v.value === mcVersion),
        [mcVersion]
    );

    const selectedHeightValue = useMemo(() =>
        HEIGHT_OPTIONS.find(v => v.value === yHeight),
        [yHeight]
    );

    const renderOptions = () => {
        if (!optionsRendered) return null;

        return (
            <>
                <div className="margin-3 width-total" style={{ paddingBottom: '10px' }}>
                    <label htmlFor="structures-shown">Show structures coords</label>
                    <input
                        id="structures-shown"
                        className="margin-3"
                        type="checkbox"
                        checked={showStructureCoords}
                        onChange={() => setShowStructureCoords(prev => !prev)}
                    />
                </div>
                <div className="margin-3 width-total">
                    <div className="margin-3">Structures to show</div>
                    <Select
                        options={STRUCTURES_OPTIONS}
                        isClearable
                        isMulti
                        onChange={handleStructuresToShowChange}
                        value={selectedStructuresValue}
                        filterOption={createFilter(filterConfig)}
                    />
                </div>
            </>
        );
    };

    const renderFinder = () => {
        if (!finderRendered) return null;

        return (
            <>
                <div className="margin-3">
                    <div className="margin-3">Select the biomes you want</div>
                    <Select
                        options={BIOMES}
                        isClearable
                        isMulti
                        onChange={handleBiomesToFindChange}
                        placeholder="Select biomes..."
                    />
                    <div className="margin-3">Select the structure you want</div>
                    <Select
                        options={STRUCTURES_OPTIONS}
                        isClearable
                        onChange={handleStructureToFindChange}
                        filterOption={createFilter(filterConfig)}
                        placeholder="Select structures..."
                    />
                    {!isAdvancedModeEnabled && (
                        <>
                            <div className="margin-3">Select the range from (0, 0)</div>
                            <Select
                                options={RANGE_OPTIONS}
                                onChange={handleRangeChange}
                                placeholder="Select range..."
                            />
                        </>
                    )}
                    <div className="margin-3 margin-v-10">
                        <label htmlFor="advanced-mode" className="pointer">Advanced mode</label>
                        <input
                            id="advanced-mode"
                            name="advanced-mode"
                            className="margin-3 pointer margin-left-10"
                            type="checkbox"
                            checked={isAdvancedModeEnabled}
                            onChange={() => setIsAdvancedModeEnabled(prev => !prev)}
                        />
                    </div>
                    {isAdvancedModeEnabled && (
                        <div className="margin-v-10 margin-3">
                            <div className="margin-3">Starting seed for search</div>
                            <input
                                type="number"
                                className="padding-3"
                                value={lastFoundSeed}
                                onChange={(e) => setLastFoundSeed(parseInt(e.target.value, 10) || 0)}
                            />
                            <div className="margin-3">Range from (0, 0)</div>
                            <input
                                type="number"
                                className="padding-3"
                                value={range ? range * 4 : ''}
                                onChange={(e) => setRange(e.target.value ? e.target.value / 4 : null)}
                            />
                            <div className="margin-3">Biome height</div>
                            <input
                                type="number"
                                className="padding-3"
                                value={yHeight ?? ''}
                                onChange={(e) => setYHeight(parseInt(e.target.value, 10) || null)}
                            />
                        </div>
                    )}
                </div>
                <div className="margin-3">
                    <button
                        className="full-button"
                        onClick={findSeed}
                        disabled={isRandomSeedButtonDisabled || !(range > 0 && (biomesToFind?.length > 0 || structureToFind))}
                    >
                        {lastFoundSeed > 0 ? 'Find another' : 'Find'}
                    </button>
                </div>
            </>
        );
    };

    const renderLegend = () => {
        if (!showLegend || !queueManager.COLORS) return null;

        const legend = BIOMES.map(item => ({
            biome: item.label,
            color: queueManager.COLORS[item.value]
        }));

        if (!legend.every(item => item.color)) return null;

        return (
            <div className="legend flex-column">
                <div className="overflow-y-scroll flex-1">
                    {legend.map(item => (
                        <div key={item.biome} className="flex-row margin-3">
                            <div style={{
                                marginRight: "10px",
                                width: "20px",
                                height: "20px",
                                backgroundColor: `rgba(${item.color[0]}, ${item.color[1]}, ${item.color[2]}, ${item.color[3]})`
                            }} />
                            <div>{item.biome}</div>
                        </div>
                    ))}
                </div>
                <div className="margin-3">
                    <button className="full-button" onClick={() => setShowLegend(false)}>Close</button>
                </div>
            </div>
        );
    };

    return (
        <>
            {isFindingSeed && (
                <div className="loading flex-column">
                    <h1>Finding seed...</h1>
                    <div className="loader" />
                    <h3>
                        {seedFindingSpeed ? `${seedFindingSpeed} seed/s` : "Calculating speed..."}
                    </h3>
                    <div className="margin-bottom-25">You have been searching for {toHHMMSS(findingSeedDuration)}...</div>
                    <button className="stop-button padding-3" onClick={restartAll}>STOP</button>
                </div>
            )}
            <div className="map-container flex-5 flex-row" ref={mapContainer}>
                <canvas ref={canvas} style={{ background: "#333333" }} />
                <img
                    alt="seed menu toggle"
                    className="menu-toggle"
                    onClick={() => setMenuToggled(prev => !prev)}
                    src="/svg/menu.svg"
                />
                <img alt="arrow up" className="arrow arrow-up" onClick={() => drawer.current?.up()} src="/svg/arrow.svg" />
                <img alt="arrow left" className="arrow arrow-left" onClick={() => drawer.current?.left()} src="/svg/arrow.svg" />
                <img alt="arrow down" className="arrow arrow-down" onClick={() => drawer.current?.down()} src="/svg/arrow.svg" />
                <img alt="arrow right" className="arrow arrow-right" onClick={() => drawer.current?.right()} src="/svg/arrow.svg" />
                <div className="coords">
                    <div>
                        <b className="hide-mobile">X:</b> {x ?? 0}, <b className="hide-mobile">Z:</b> {z ?? 0}
                    </div>
                    <div className="biome-info">
                        {biome ?? 'Unknown'}
                    </div>
                </div>
            </div>
            <div className={`flex-column panel-container flex-2 overflow-auto ${menuToggled ? 'menu-toggled' : ''}`}>
                <div className="margin-3"><h3>Seed</h3></div>
                <div className="flex-row margin-3">
                    <input
                        className="flex-3"
                        value={inputSeed}
                        onChange={(e) => setInputSeed(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && e.target.value && handleEnterSeed()}
                    />
                    <button style={{ borderLeft: '0px' }} className="flex-1" onClick={handleEnterSeed}>GO</button>
                </div>
                <div className="margin-3">
                    <button disabled={isRandomSeedButtonDisabled} className="full-button" onClick={setRandomSeed}>Random seed</button>
                </div>
                <div className="margin-3 width-total">
                    <div className="margin-3">Dimension</div>
                    <Select
                        options={DIMENSIONS_OPTIONS}
                        onChange={(val) => setDimension(val?.value)}
                        value={selectedDimensionValue}
                    />
                </div>
                <div className="margin-3 width-total">
                    <div className="margin-3">Select MC version</div>
                    <Select
                        options={VERSIONS_OPTIONS}
                        onChange={(val) => setMcVersion(val?.value)}
                        value={selectedVersionValue}
                    />
                </div>
                {mcVersion > VERSIONS["1.18"] && (
                    <div className="margin-3 width-total">
                        <div className="margin-3">Biome height</div>
                        <Select
                            options={HEIGHT_OPTIONS}
                            onChange={(val) => setYHeight(val?.value)}
                            value={selectedHeightValue}
                        />
                    </div>
                )}
                <div className="margin-3 hide-mobile">Use your keyboard to navigate the map</div>
                <div className="margin-3">
                    <button className="half-button" onClick={() => drawer.current?.zoom()}>Zoom +</button>
                    <button style={{ borderLeft: 0 }} className="half-button" onClick={() => drawer.current?.dezoom()}>Zoom -</button>
                </div>
                <div className="margin-3">
                    <button className="full-button" onClick={() => setShowLegend(prev => !prev)}>
                        {showLegend ? 'Close legend' : 'Show legend'}
                    </button>
                </div>

                <hr />

                <div className="flex-row margin-3">
                    <div className="flex-row flex-align-center">
                        <div className="margin-3">Buy me a coffee!</div>
                        <form className="margin-3" action="https://www.paypal.com/donate" method="post" target="_top">
                            <input style={{ border: "0px" }} type="hidden" name="hosted_button_id" value="LNMNHMPCKH6MG" />
                            <input style={{ verticalAlign: "bottom", border: "0px" }} type="image" src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Donate with PayPal button" />
                        </form>
                        <a className="margin-3" href="https://buymeacoffee.com/mcseeder" target="_blank" rel="noopener noreferrer">
                            <img style={{ height: "26px", verticalAlign: "bottom" }} src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" />
                        </a>
                    </div>
                </div>

                <hr />

                <div className="margin-3 flex-row" onClick={() => setFinderRendered(prev => !prev)}>
                    <h3 className="flex-1">Seed finder <span style={{ color: "#ff8c00" }}>(TRY ME!)</span></h3>
                    <img alt="arrow up" className={`togglable arrow-${finderRendered ? 'up' : 'down'} margin-left-15 bordered pointer`} src="/svg/arrow.svg" />
                </div>
                {renderFinder()}

                <hr />

                <div className="margin-3 flex-row" onClick={() => setOptionsRendered(prev => !prev)}>
                    <h3 className="flex-1">Options</h3>
                    <img alt="arrow up" className={`togglable arrow-${optionsRendered ? 'up' : 'down'} margin-left-15 bordered pointer`} src="/svg/arrow.svg" />
                </div>
                {renderOptions()}

                <hr />

                <div className="margin-3">
                    <h3>Share your seed:</h3>
                </div>
                <div className="flex-row margin-3" style={{ marginBottom: '33px' }}>
                    <input style={{ background: 'white' }} className="flex-3" value={window.location.href} disabled />
                    <button
                        style={{ borderLeft: '0px' }}
                        className="flex-1"
                        onClick={() => {
                            copyToClipboard(window.location.href);
                            setButtonText('COPIED!');
                        }}
                    >
                        {buttonText}
                    </button>
                </div>
            </div>
            {renderLegend()}
        </>
    );
}
