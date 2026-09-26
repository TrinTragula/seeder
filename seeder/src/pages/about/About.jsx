import React from 'react';
import './About.css';
import GoogleAd from '../../shared/GoogleAd';
import { AD_SLOT_RESPONSIVE } from '../../shared/ads';
import { APP_VERSION } from '../../util/site';
// Derived from VERSIONS, so a Minecraft update never leaves this page naming an old range.
import { OLDEST_VERSION_LABEL, NEWEST_VERSION_LABEL } from '../landing/content';

/*
 * The About page. The donate buttons are here as well as in the shared footer.
 */
export default function About() {
    return (
        <div className="about">
            <div className="about__title">
                <h1>Seeder</h1>
                <small>({APP_VERSION})</small>
            </div>

            <section aria-labelledby="about-who">
                <h2 id="about-who">Who</h2>
                <div className="about__lines">
                    <div>
                        I'm <a href="https://github.com/TrinTragula">TrinTragula</a> 🇮🇹 on GitHub
                    </div>
                    <div>
                        Feel free to contact me on Twitter <a href="https://twitter.com/McSeeder" target="_blank" rel="noreferrer">@McSeeder</a>
                    </div>
                    <div>
                        Or send me an email at <a href="mailto:spam@mcseeder.com">spam@mcseeder.com</a>
                    </div>
                </div>
                <p>I'd love to know if you use this website and how</p>
            </section>

            <section aria-labelledby="about-help">
                <h2 id="about-help">Can I help?</h2>
                <div className="about__donate">
                    <span>Buy me a coffee!</span>
                    <form action="https://www.paypal.com/donate" method="post" target="_top">
                        <input type="hidden" name="hosted_button_id" value="LNMNHMPCKH6MG" />
                        <input type="image" src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Donate with PayPal button" />
                    </form>
                    <a href="https://buymeacoffee.com/mcseeder" target="_blank" rel="noopener noreferrer">
                        <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" />
                    </a>
                </div>
            </section>

            <section aria-labelledby="about-what">
                <h2 id="about-what">What is it</h2>
                <p>Find, show, share and admire Minecraft seeds (Java edition mostly, Bedrock only if you are interested in biomes).</p>
                <p>Works with every Java version from {OLDEST_VERSION_LABEL} to {NEWEST_VERSION_LABEL}.</p>
                <p>
                    This is a webapp based upon a library (<a href="https://github.com/Cubitect/cubiomes">cubiomes</a>)
                    written by cubitect in C and compiled in webassembly by me.
                    Go and give him love. Since the original library is no longer maintained, Seeder now builds against the
                    actively maintained <a href="https://github.com/xpple/cubiomes">xpple/cubiomes fork</a>.
                </p>
                <p>
                    It uses fancy new technology to run the same code in your browser, so that you
                    can look up your seeds/find your perfect ones without installing or configuring anything.
                </p>
            </section>

            <section aria-labelledby="about-code">
                <h2 id="about-code">Where's the code?</h2>
                <p><a href="https://github.com/TrinTragula/seeder">Here</a></p>
                <p>It's open source, under the MIT licence.</p>
            </section>

            <section aria-labelledby="about-does">
                <h2 id="about-does">What it does</h2>
                <ul className="about__list">
                    <li>Draws the biome map of any seed, in the Overworld, the Nether and the End (drag to pan, mouse wheel or pinch to zoom)</li>
                    <li>Shows biomes at any height from 1.18</li>
                    <li>Finds the spawn point, the strongholds and the structures</li>
                    <li>Slime-chunk and chunk-grid overlays on the map</li>
                    <li>
                        A dashboard next to the map for every seed:
                        <ul>
                            <li>spawn, and strongholds with the number of eyes in their portal room</li>
                            <li>the nearest structures, with their variants (zombie villages, giant ruined portals, bastion types, End city ships…)</li>
                            <li>which biomes are around spawn, and where the nearest patch of any biome is</li>
                            <li>Find near me: what is at any coordinates you type</li>
                            <li>farms: whether the seed has a quad witch farm, and blaze spawners in fortresses</li>
                            <li>My worlds: save the seeds you play</li>
                        </ul>
                    </li>
                    <li>Finds seeds with several biomes and several structures at once, many results per search</li>
                    <li>Presets for common searches, led by what the newest Minecraft version added: survival starts, speedrun, stacked structures, builders' biomes, structure hunts, the Nether and the End</li>
                    <li>Share a seed or a search with a link, export results as CSV or JSON, or share a picture of a seed</li>
                    <li>Finding rare seeds may slow down your PC while the search is running (seed finding is a very CPU intensive job)</li>
                </ul>
            </section>

            <section aria-labelledby="about-limits">
                <h2 id="about-limits">Limitations</h2>
                <ul className="about__list">
                    <li>
                        Seeder reproduces Java Edition. From 1.18, a seed gives the same terrain and biomes on Bedrock
                        Edition, so the biome map works for Bedrock worlds too; structures, strongholds and slime chunks are
                        placed differently on Bedrock, so those markers only hold for Java.
                    </li>
                    <li>
                        From 1.18, desert pyramids, jungle temples and mansions need high enough ground, which cubiomes can
                        only estimate: a few of the ones shown may not generate.
                    </li>
                    <li>The number of eyes in a stronghold's portal room is unknown before 1.13.</li>
                    <li>Dungeon and mineshaft spawners depend on terrain carving and cannot be predicted from the seed.</li>
                    {/* Non-breaking spaces: a coordinate never splits from its axis. */}
                    <li>Every finder search is centred on the world origin (X&nbsp;0, Z&nbsp;0), not on the spawn.</li>
                    <li>With a biome in it, a finder search reaches at most 1,000 blocks from the origin.</li>
                    <li>Biome searches are slow from 1.18: within 300 blocks, one core checks about a dozen seeds per second.</li>
                </ul>
            </section>

            <section aria-labelledby="about-credits">
                <h2 id="about-credits">Credits</h2>
                <ul className="about__list">
                    <li>
                        World generation: <a href="https://github.com/Cubitect/cubiomes">cubiomes</a> by Cubitect (MIT licence), via
                        the <a href="https://github.com/xpple/cubiomes">xpple/cubiomes</a> fork.
                    </li>
                    <li>
                        The pixel font is <a href="http://www.andrewtyler.net">Minecraftia by Andrew Tyler</a>, licensed{' '}
                        <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>.
                    </li>
                    <li>
                        The full licence texts are in <a href="/licenses.txt">licenses.txt</a>.
                    </li>
                </ul>
            </section>

            <section aria-labelledby="about-privacy">
                <h2 id="about-privacy">Privacy and ads</h2>
                <p>
                    Seeder has no accounts and no server of its own: maps and searches run in your browser.
                    Google Analytics counts page views and Google AdSense shows ads; like any page view, they see the address of
                    the page you are on, which includes the seed, version or search criteria. Where the law asks for it, Google's
                    own consent message lets you choose.
                </p>
            </section>

            <GoogleAd slot={AD_SLOT_RESPONSIVE} minHeight={120} className="about__ad" />
        </div>
    );
}
