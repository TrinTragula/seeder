import React from 'react';
import './About.css';

export default function About() {
    return (
        <div className="width-total flex-column flex-align-center padding-15">
            <div className="about-container">
                <div className="flex-row flex-align-center">
                    <h1>Seeder</h1>
                    <small className="margin-left-15">(0.3.0)</small>
                </div>
                <h3>Who</h3>
                <p className="paragraph">
                    <a href="https://github.com/TrinTragula">TrinTragula</a>
                </p>
                <h3>What</h3>
                <p className="paragraph">
                    Find, show, share and admire Minecraft seeds (Java edition only).
                </p>
                <p className="paragraph">
                    This is a webapp based upon a library (<a href="https://github.com/Cubitect/cubiomes">cubiomes</a>)
                    written by cubitect in C and compiled in webassembly by me.
                    Go and give him love.
                </p>
                <p className="paragraph">
                    It uses fancy new technology to run the same code in your browser, so that you
                    can look up your seeds/find your perfect ones whitout installing or configuring anything.
                </p>
                <h3>
                    Features:
                </h3>
                <ul>
                    <li>Generates biomes for a given seed</li>
                    <li>Find the spawn point</li>
                    <li>Find a seed containing a list of biomes in a given range</li>
                    <li>Find a seed containing a strcuture in a given range</li>
                    <li>Find a seed containing a strcuture AND a list of biomes in a given range</li>
                    <li>Works with different MC versions</li>
                    <li>Finding rare seeds may slow down you PC while the search is running (seed finding is a very CPU intensive job)</li>
                </ul>
                <h3>
                    Coming features:
                </h3>
                <ul>
                    <li>Less CPU hunger</li>
                    <li>Find a list of structures, not just one</li>
                    <li>Move the map using your mouse (for now you can use your keyboard)</li>
                    <li>Better zoom</li>
                    <li>Other dimensions</li>
                </ul>
            </div>
        </div>
    );
}
