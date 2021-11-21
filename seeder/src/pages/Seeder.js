import React, { useRef, useEffect, useState } from 'react';
import { QueueManager } from '../library/queue';
import { DrawSeed } from '../library/draw';
import Select, { createFilter } from 'react-select'
import './Seeder.css';
import { VERSIONS, VERSIONS_OPTIONS, BIOMES, STRUCTURES_OPTIONS, DIMENSIONS_OPTIONS, HEIGHT_OPTIONS } from '../util/constants';
import { debounce, copyToClipboard, setUrl } from '../util/functions';

const isNumeric = (str) => {
    if (typeof str != "string") return false;
    return !isNaN(str) && !isNaN(parseFloat(str));
}

export default function Seeder() {
    const filterConfig = {
        ignoreCase: true,
        ignoreAccents: true,
        trim: true,
        matchFrom: 'any',
        stringify: option => option.data.pureText,
    };

    const urlSearchParams = new URLSearchParams(window.location.search);
    const params = Object.fromEntries(urlSearchParams.entries());
    const urlSeed = params?.seed;
    const urlVersion = params?.version;

    const getRandomSeed = () => "" + Math.floor(-4_294_967_296 + Math.random() * 8_589_934_593);
    const canvas = useRef();
    const drawer = useRef();
    const [mcVersion, setMcVersion] = useState(isNumeric(urlVersion) ? Number.parseInt(urlVersion) : VERSIONS["1.18"]);
    const [seed, setSeed] = useState(
        Number.isInteger(Number.parseInt(urlSeed))
            ? Number.parseInt(urlSeed) + ""
            : getRandomSeed()
    );
    const [x, setX] = useState(null);
    const [z, setZ] = useState(null);
    const [biome, setBiome] = useState(null);
    const [inputSeed, setInputSeed] = useState(seed);
    const [dimension, setDimension] = useState(0); // Overworld
    const [yHeight, setYHeight] = useState(320); // Top of the world
    const [queueManager] = useState(() => new QueueManager("/workers/worker.js"));

    const [biomesToFind, setBiomesToFind] = useState(null);
    const [range, setRange] = useState(null);

    const [structureToFind, setStructureToFind] = useState(null);
    const [structuresToShow, setStructuresToShow] = useState([]);

    const [isFindingSeed, setIsFindingSeed] = useState(false);
    const [seedFindingSpeed, setSeedFindingSpeed] = useState(false);
    const [lastFoundSeed, setLastFoundSeed] = useState(0);
    const [menuToggled, setMenuToggled] = useState(false);
    const [showStructureCoords, setShowStructureCoords] = useState(true);

    const [buttonText, setButtonText] = useState('COPY');

    const [optionsRendered, setOptionsRendered] = useState(true);
    const [finderRendered, setFinderRendered] = useState(false);

    const [showLegend, setShowLegend] = useState(false);

    const [isRandomSeedButtonDisabled, setIsRandomSeedButtonDisabled] = useState(false);

    const drawSeed = (forced = false) => {
        setIsRandomSeedButtonDisabled(true);
        if (!drawer?.current) {
            canvas.current.width = canvas.current.offsetWidth;
            canvas.current.height = canvas.current.offsetHeight - 15;
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
        drawer.current.setYHeight(yHeight);
        drawer.current.setStructuresShown(structuresToShow);
        setUrl(seed, mcVersion, setButtonText);
        drawer.current.draw(() => {
            if (forced) {
                drawer.current.findSpawn((spawnSeed,) => {
                    setIsRandomSeedButtonDisabled(false);
                    if (seed === spawnSeed) {
                        drawer.current.drawStructures();
                    }
                });
                drawer.current.findStrongholds((strongholdSeed,) => {
                    if (seed === strongholdSeed) {
                        drawer.current.drawStructures()
                    }
                });
                for (const structure of structuresToShow) {
                    drawer.current.findStructure(structure, (structureSeed,) => {
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
    }

    const setOnKeyDownCallback = () => {
        const move = (e) => {
            if (e.keyCode === 38) {
                drawer.current.up();
            }
            else if (e.keyCode === 40) {
                drawer.current.down();
            }
            else if (e.keyCode === 37) {
                drawer.current.left();
            }
            else if (e.keyCode === 39) {
                drawer.current.right();
            }
        };
        const checkKey = (e) => {
            e = e || window.event;
            move(e);
        };
        document.onkeydown = debounce((e) => checkKey(e), 1);
    }

    const onResize = () => {
        if (canvas?.current) {
            canvas.current.width = canvas.current.offsetWidth;
            canvas.current.height = canvas.current.offsetHeight - 15;
            drawSeed();
        }
    }

    useEffect(() => {
        setOnKeyDownCallback();
        window.addEventListener('resize', debounce(onResize, 500));
        // eslint-disable-next-line
    }, []);

    useEffect(() => {
        drawSeed(true);
        // eslint-disable-next-line
    }, [mcVersion, seed, dimension, yHeight, queueManager, structuresToShow, showStructureCoords]);

    const setRandomSeed = () => {
        const rendomSeed = getRandomSeed();
        setSeed(rendomSeed);
        setInputSeed(rendomSeed);
    }

    const seedFromString = function (s) {
        let h;
        for (let i = 0; i < s.length; i++) {
            h = Math.imul(31, h) + s.charCodeAt(i) | 0;
        }
        return h;
    };

    const handleEnterSeed = () => {
        let newSeed = inputSeed;
        if (newSeed && newSeed !== seed) {
            if (!isNumeric(newSeed)) {
                newSeed = seedFromString(newSeed);
            }
            setSeed(newSeed);
        }
    }

    const restartAll = () => {
        queueManager.restartAll();
        setIsFindingSeed(false);
    }

    const findSeed = () => {
        if (range > 0) {
            setIsFindingSeed(true);
            setSeedFindingSpeed(0);
            const start = new Date();
            let events = 0;
            queueManager.seedUpdateCallback = () => {
                events++;
                const now = new Date();
                const speed = Math.floor((events * 10000) / ((now.getTime() - start.getTime()) / 1000));
                setSeedFindingSpeed(speed);
            }

            const callback = (foundSeed) => {
                foundSeed = "" + foundSeed;
                setSeed(foundSeed);
                setInputSeed(foundSeed);
                setLastFoundSeed(parseInt(foundSeed));
                setIsFindingSeed(false);
            }

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
    }

    const renderOptions = () => {
        if (optionsRendered) {
            return (
                <>
                    <div className="margin-3 width-total" style={{ paddingBottom: '10px' }}>
                        <label htmlFor="structures-shown">Show structures coords</label>
                        <input id="structures-shown" defaultChecked={true} className="margin-3" type="checkbox" value={showStructureCoords}
                            onClick={() => setShowStructureCoords(!showStructureCoords)} />
                    </div>
                    <div className="margin-3 width-total">
                        <div className="margin-3">Structures to show</div>
                        <Select options={STRUCTURES_OPTIONS} isClearable={true} isMulti onChange={(val) => {
                            const newValues = [...val?.map(x => x?.value)];
                            setStructuresToShow(newValues);
                        }} value={structuresToShow && STRUCTURES_OPTIONS.filter(v => structuresToShow.includes(v.value))}
                            filterOption={createFilter(filterConfig)} />
                    </div>
                </>
            );
        }
    };

    const renderFinder = () => {
        if (finderRendered) {
            return (<>
                <div className="margin-3">
                    <div className="margin-3">Select the biomes you want</div>
                    <Select options={BIOMES} isClearable={true} isMulti onChange={(val) => {
                        setLastFoundSeed(0);
                        setBiomesToFind([...val?.map(x => x?.value)])
                    }} />
                    <div className="margin-3">Select the structure you want</div>
                    <Select options={STRUCTURES_OPTIONS} isClearable={true} onChange={(val) => {
                        setLastFoundSeed(0);
                        setStructureToFind(val?.value);
                        if (val?.value && !structuresToShow?.includes(val?.value)) {
                            setStructuresToShow([val?.value, ...structuresToShow]);
                        }
                    }} filterOption={createFilter(filterConfig)} />
                    <div className="margin-3">Select the range from (0, 0)</div>
                    <Select options={[
                        { value: parseInt(100 / 4), label: "<100 blocks" },
                        { value: parseInt(300 / 4), label: "<300 blocks" },
                        { value: parseInt(500 / 4), label: "<500 blocks" },
                        { value: parseInt(750 / 4), label: "<750 blocks" },
                        { value: parseInt(1000 / 4), label: "<1k blocks" }
                    ]} onChange={(val) => {
                        setLastFoundSeed(0);
                        setRange(val?.value);
                    }} />
                </div>
                <div className="margin-3">
                    <button className="full-button" onClick={() => findSeed()} disabled={isRandomSeedButtonDisabled || !(range > 0 && (biomesToFind?.length > 0 || structureToFind))}>
                        {lastFoundSeed > 0 ? 'Find another' : 'Find'}
                    </button>
                </div>
            </>);
        }
    }

    const renderLegend = () => {
        if (showLegend && queueManager.COLORS) {
            const legend = BIOMES.map(x => ({
                biome: x.label,
                color: queueManager.COLORS[x.value]
            }));
            if (legend.every(x => x.color)) {
                return (<div className="legend flex-column">
                    <div className="overflow-y-scroll flex-1">
                        {legend.map(x => {
                            return (
                                <div key={x.biome} className="flex-row margin-3">
                                    <div style={{
                                        marginRight: "10px",
                                        width: "20px",
                                        height: "20px",
                                        backgroundColor: `rgba(${x?.color[0]}, ${x?.color[1]}, ${x?.color[2]}, ${x?.color[3]})`
                                    }}></div>
                                    <div>{x?.biome}</div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="margin-3">
                        <button className="full-button" onClick={() => setShowLegend(false)}>Close</button>
                    </div>
                </div>);
            }
        }
    }

    return (
        <>
            {
                isFindingSeed &&
                <div className="loading flex-column">
                    <h1>Finding seed...</h1>
                    <div className="loader"></div>
                    <h3 className="margin-bottom-25">
                        {seedFindingSpeed ? seedFindingSpeed + " seed/s" : "Calculating speed..."}
                    </h3>
                    <button className="stop-button padding-3" onClick={() => restartAll()}>STOP</button>
                </div>
            }
            <div className="map-container flex-5 flex-row">
                <canvas ref={canvas} style={{ background: "#333333" }}></canvas>
                <img alt="seed menu toggle"
                    className="menu-toggle"
                    onClick={() => setMenuToggled(!menuToggled)} src="/svg/menu.svg">
                </img>
                <img alt="arrow up" className="arrow arrow-up" onClick={() => drawer.current.up()} src="/svg/arrow.svg"></img>
                <img alt="arrow left" className="arrow arrow-left" onClick={() => drawer.current.left()} src="/svg/arrow.svg"></img>
                <img alt="arrow down" className="arrow arrow-down" onClick={() => drawer.current.down()} src="/svg/arrow.svg"></img>
                <img alt="arrow right" className="arrow arrow-right" onClick={() => drawer.current.right()} src="/svg/arrow.svg"></img>
                <div className="coords">
                    <div>
                        <b className="hide-mobile">X:</b> {x ?? 0}, <b className="hide-mobile">Z:</b> {z ?? 0}
                    </div>
                    <div className="biome-info">
                        {biome ?? 'Unkown'}
                    </div>
                </div>
            </div>
            <div className={`panel-container flex-2 overflow-auto ${menuToggled ? 'menu-toggled' : ''}`}>
                <div className="margin-3"><h3>Seed</h3></div>
                <div className="flex-row margin-3">
                    <input className="flex-3" value={inputSeed} onChange={(e) => setInputSeed(e?.target?.value)}
                        onKeyPress={(e) => e.key === 'Enter' && e?.target?.value && handleEnterSeed()} />
                    <button style={{ borderLeft: '0px' }} className="flex-1" onClick={() => handleEnterSeed()}>GO</button>
                </div>
                <div className="margin-3">
                    <button disabled={isRandomSeedButtonDisabled} className="full-button" onClick={() => setRandomSeed()}>Random seed</button>
                </div>
                <div className="margin-3 width-total">
                    <div className="margin-3">Dimension</div>
                    <Select options={DIMENSIONS_OPTIONS} onChange={(val) => {
                        setDimension(val?.value);
                    }} value={DIMENSIONS_OPTIONS.find(v => v.value === dimension)} />
                </div>
                <div className="margin-3 width-total">
                    <div className="margin-3">Select MC version</div>
                    <Select options={VERSIONS_OPTIONS} onChange={(val) => {
                        setMcVersion(val?.value);
                    }} value={VERSIONS_OPTIONS.find(v => v.value === mcVersion)} />
                </div>
                {
                    mcVersion >= VERSIONS["1.18"] &&
                    <div className="margin-3 width-total">
                        <div className="margin-3">Biome layer</div>
                        <Select options={HEIGHT_OPTIONS} onChange={(val) => {
                            setYHeight(val?.value);
                        }} value={HEIGHT_OPTIONS.find(v => v.value === yHeight)} />
                    </div>
                }
                <div className="margin-3 hide-mobile">Use your keyboard to navigate the map</div>
                <div className="margin-3">
                    <button className="half-button" onClick={() => drawer.current.zoom()}>Zoom +</button>
                    <button style={{ borderLeft: 0 }} className="half-button" onClick={() => drawer.current.dezoom()}>Zoom -</button>
                </div>
                <div className="margin-3">
                    <button className="full-button" onClick={() => setShowLegend(!showLegend)}>{showLegend ? 'Close legend' : 'Show legend'}</button>
                </div>

                <hr />

                <div className="margin-3 flex-row" onClick={() => setFinderRendered(!finderRendered)}>
                    <h3 className="flex-1">Seed finder <span style={{ color: "#ff8c00" }}>(TRY ME!)</span></h3>
                    <img alt="arrow up" className={`togglable arrow-${finderRendered ? 'up' : 'down'}  margin-left-15 bordered pointer`} src="/svg/arrow.svg"></img>
                </div>
                {renderFinder()}

                <hr />

                <div className="margin-3 flex-row" onClick={() => setOptionsRendered(!optionsRendered)}>
                    <h3 className="flex-1">Options</h3>
                    <img alt="arrow up" className={`togglable arrow-${optionsRendered ? 'up' : 'down'}  margin-left-15 bordered pointer`} src="/svg/arrow.svg"></img>
                </div>
                {renderOptions()}

                <hr />

                <div className="margin-3">
                    <h3>Share your seed:</h3>
                </div>
                <div className="flex-row margin-3">
                    <input style={{ background: 'white' }} className="flex-3" value={window.location.href} disabled />
                    <button style={{ borderLeft: '0px' }} className="flex-1"
                        onClick={() => {
                            copyToClipboard(window.location.href);
                            setButtonText('COPIED!')
                        }}>
                        {buttonText}
                    </button>
                </div>

                <hr />

                <div className="flex-row margin-3">
                    <div className="flex-row">
                        <a href="https://opensea.io/collection/mcseeder-collection" target="_blank" rel="noreferrer">
                            Own a seed in the blockchain!
                        </a>
                        <img className="margin-left-10" height="25" style={{ verticalAlign: "top" }} src="svg/opensea.svg" alt="OpenSea logo" />
                    </div>
                </div>
                <div className="flex-row">
                    <div className="margin-3">Or buy me a coffee!</div>
                    <form className="margin-3" action="https://www.paypal.com/donate" method="post" target="_top">
                        <input style={{ border: "0px" }} type="hidden" name="hosted_button_id" value="LNMNHMPCKH6MG" />
                        <input style={{ verticalAlign: "bottom", border: "0px" }} type="image" src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif" border="0" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Donate with PayPal button" />
                    </form>
                </div>
            </div>
            {renderLegend()}
        </>
    );
}


