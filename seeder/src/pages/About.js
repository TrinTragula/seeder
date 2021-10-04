import React from 'react';
import './About.css';

export default function About() {
    return (
        <div className="width-total flex-column flex-align-center padding-15">
            <div className="about-container">
                <div className="flex-row flex-align-center">
                    <h1>Seeder</h1>
                    <small className="margin-left-15">(0.3.1)</small>
                </div>
                <div className="flex-row flex-align-center">
                    <div className="margin-3">Buy me a coffee!</div>
                    <form className="margin-3" action="https://www.paypal.com/donate" method="post" target="_top">
                        <input style={{ border: "0px" }} type="hidden" name="hosted_button_id" value="LNMNHMPCKH6MG" />
                        <input style={{ verticalAlign: "bottom", border: "0px" }} type="image" src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif" border="0" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Donate with PayPal button" />
                    </form>
                </div>
                <div>BTC:
                    <small><i>bc1q7j97cnz7jce3kgf3fh7hgfvu2h9q5ywrmleh0d</i></small>
                </div>
                <div>ETH:
                    <small><i>0x1fDA7E78fa0894b919b08DEF22B50e404D15384a</i></small>
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
                <h3>Where's the code?</h3>
                <p className="paragraph">
                    <a href="https://github.com/TrinTragula/seeder">Here</a>
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
