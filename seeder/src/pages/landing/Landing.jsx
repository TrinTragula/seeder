import React, { useEffect, useRef, useState } from 'react';
import GoogleAd from '../../shared/GoogleAd';
import { AD_SLOT_RESPONSIVE } from '../../shared/ads';
import { buildSeedUrl } from '../../shared/seedUrl';
import { loadLastSeed, loadWorlds } from '../../shared/worlds';
import { VERSIONS } from '../../util/constants';
import { DEFAULT_VERSION } from '../../util/seed';
import { APP_VERSION } from '../../util/site';
import {
    CARDS, CONTINUE_TITLE, FAQ, FAQ_TITLE, HERO_LEAD, HERO_NAME, HERO_TITLE, NEWEST_VERSION_LABEL, OPEN_MAP,
    OWN_SEED_LABEL, RANDOM_SEED_LINK, SEED_HINT, SEED_PLACEHOLDER, SUPPORT, VERSION_BADGE, WORLDS_LABEL, continueLabel,
} from './content';
import './Landing.css';

/*
 * The landing must stay light: no worker pool, no map, nothing that imports the engine
 * singleton. The card images are static captures of the real pages.
 */

const MAX_WORLD_LINKS = 3;

// Stored worlds carry a version label; one this build no longer knows opens on the
// default version, the way the seed page itself treats an unknown ?version=.
const seedUrlOf = ({ seed, version, dimension, largeBiomes }) =>
    buildSeedUrl({ seed, mcVersion: VERSIONS[version] ?? VERSIONS[DEFAULT_VERSION], dimension, largeBiomes });

const sameWorld = (a, b) => a.seed === b.seed && a.version === b.version && a.dimension === b.dimension
    && !!a.largeBiomes === !!b.largeBiomes;

// What this browser remembers, read once: the landing never writes storage.
const NOTHING_REMEMBERED = { last: null, worlds: [] };
function readExplore() {
    const last = loadLastSeed();
    // "Continue with Seed …" already opens the last seed: listing it again by name
    // would be the same link twice.
    const worlds = loadWorlds().filter((world) => !last || !sameWorld(world, last)).slice(0, MAX_WORLD_LINKS);
    return { last, worlds };
}

// `/?seed=<text>` is not a legacy link (only decimal seeds redirect): old text-seed
// links still get their seed, typed into the hero for the visitor. Read after
// hydration: the prerendered hero has an empty box.
function readPrefill() {
    return (new URLSearchParams(window.location.search).get('seed') ?? '').trim();
}

// A sentence with one anchor in it: `link.text` is where the answer mentions the target.
function LinkedText({ text, link }) {
    const at = link ? text.indexOf(link.text) : -1;
    if (at < 0) return text;
    return (
        <>
            {text.slice(0, at)}
            <a href={link.href}>{link.text}</a>
            {text.slice(at + link.text.length)}
        </>
    );
}

function CardImage({ card }) {
    // Not lazy: the cards sit at or just under the fold and the first image may be
    // the largest paint. The size attributes reserve the box before the file arrives.
    return <img className="landing-card__image" src={card.image} width="960" height="600" alt={card.alt} />;
}

// The whole card is clickable: its primary link stretches
// over the card with CSS (.landing-card__cta::after), so there is still one link per
// card for keyboards and screen readers, named by its label.
function SectionCard({ card }) {
    return (
        <li className="card landing-card">
            <CardImage card={card} />
            <h2>{card.title}</h2>
            <p>{card.text}</p>
            <div className="landing-card__actions">
                <a className="btn btn--primary landing-card__cta" href={card.link.href}>{card.link.label}</a>
            </div>
        </li>
    );
}

// What the visitor was doing, under the cards: the last seed and the saved worlds. A
// first visit has neither, and the section is not there at all. Storage is only read
// after mount, since the prerendered page cannot know it; the ref keeps it to one read
// when StrictMode runs the effect twice.
function ContinueSection() {
    const [{ last, worlds }, setExplore] = useState(NOTHING_REMEMBERED);
    const read = useRef(false);
    useEffect(() => {
        if (read.current) return;
        read.current = true;
        setExplore(readExplore());
    }, []);
    if (!last && worlds.length === 0) return null;
    return (
        <section className="card landing-continue" aria-labelledby="landing-continue-title">
            <h2 id="landing-continue-title">{CONTINUE_TITLE}</h2>
            <div className="landing-continue__row">
                {last && <a className="btn btn--primary landing-continue__cta" href={seedUrlOf(last)}>{continueLabel(last.seed)}</a>}
                {worlds.length > 0 && (
                    <div className="landing-worlds">
                        <p className="landing-worlds__label" id="landing-worlds-label">{WORLDS_LABEL}</p>
                        <ul aria-labelledby="landing-worlds-label">
                            {worlds.map((world) => (
                                <li key={world.id}><a className="chip" href={seedUrlOf(world)}>{world.name}</a></li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}

export default function Landing() {
    const seedInput = useRef(null);
    useEffect(() => {
        const prefill = readPrefill();
        // Anything typed before hydration wins over the link's seed.
        if (prefill && seedInput.current && !seedInput.current.value) seedInput.current.value = prefill;
    }, []);
    return (
        <div className="landing">
            <div className="landing-hero">
                {/* The hidden dash keeps the name and the tagline apart in the heading's text. */}
                <h1>
                    <span className="landing-hero__name">{HERO_NAME}</span>
                    <span className="sr-only"> - </span>
                    <span className="landing-hero__tagline">{HERO_TITLE}</span>
                </h1>
                <p className="landing-hero__lead">{HERO_LEAD}</p>
                {/* A plain GET form, no submit handler: the seed page hashes text seeds and
                    canonicalises its own URL, so /seed/?seed=hello is all it takes. */}
                <a className="btn btn--primary landing-hero__random" href="/seed/">{RANDOM_SEED_LINK}</a>
                <p className="landing-hero__or">{OWN_SEED_LABEL}</p>
                <form className="landing-hero__form" action="/seed/" method="get" aria-label="Open a seed">
                    <input
                        ref={seedInput}
                        className="input"
                        name="seed"
                        aria-label="Seed"
                        placeholder={SEED_PLACEHOLDER}
                        required
                        autoComplete="off"
                    />
                    <button className="btn" type="submit">{OPEN_MAP}</button>
                </form>
                <p className="landing-hero__hint">{SEED_HINT}</p>
                <p className="landing-hero__badge">
                    {VERSION_BADGE.app} <strong>{APP_VERSION}</strong>
                    <span className="landing-hero__sep"> · </span>
                    {VERSION_BADGE.game} <strong>{NEWEST_VERSION_LABEL}</strong>
                </p>
            </div>

            <ul className="landing-cards" aria-label="Sections">
                {CARDS.map((card) => <SectionCard key={card.id} card={card} />)}
            </ul>
            <ContinueSection />

            {/* The page's one unit: below the cards, never between the hero and them */}
            <GoogleAd slot={AD_SLOT_RESPONSIVE} minHeight={120} className="landing-ad" />

            <section className="landing-section" aria-labelledby="landing-faq">
                <h2 id="landing-faq">{FAQ_TITLE}</h2>
                <div className="landing-faq">
                    {FAQ.map((entry, index) => (
                        <details key={entry.question} open={index === 0}>
                            <summary>{entry.question}</summary>
                            <p><LinkedText text={entry.answer} link={entry.link} /></p>
                        </details>
                    ))}
                </div>
            </section>

            <section className="landing-section" aria-labelledby="landing-support">
                <h2 id="landing-support">{SUPPORT.title}</h2>
                <p className="landing-support"><LinkedText text={SUPPORT.text} link={SUPPORT.link} /></p>
            </section>
        </div>
    );
}
