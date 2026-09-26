import { CARDS } from '../pages/landing/content';

const INTROS = {
    seed: { card: 'map', loading: 'Loading the map…' },
    finder: { card: 'finder', loading: 'Loading the finder…' },
};

/*
 * What the seed page and the finder carry in their HTML: the landing card that
 * describes them, readable without JavaScript. The app replaces it when it mounts,
 * so it must stay free of browser APIs (it only ever renders in the prerender).
 */
export default function StaticIntro({ page }) {
    const { card: id, loading } = INTROS[page];
    const card = CARDS.find((entry) => entry.id === id);
    return (
        <div className="static-intro">
            <h1>{card.title}</h1>
            <p>{card.text}</p>
            <p className="static-intro__loading">{loading}</p>
        </div>
    );
}
