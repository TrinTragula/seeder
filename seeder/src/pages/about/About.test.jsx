import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import About from './About';
import { APP_VERSION } from '../../util/site';
import { OLDEST_VERSION_LABEL, NEWEST_VERSION_LABEL } from '../landing/content';

// The original page's sections, then the new ones.
const SECTIONS = ['Who', 'Can I help?', 'What is it', "Where's the code?", 'What it does', 'Limitations', 'Credits', 'Privacy and ads'];

// A section's content, found through its heading (each h2 labels its <section>).
const section = (name) => screen.getByRole('region', { name });

describe('About', () => {
    it('shows the app name and the version from package.json', () => {
        render(<About />);
        expect(screen.getByRole('heading', { name: 'Seeder', level: 1 })).toBeInTheDocument();
        expect(screen.getByText(`(${APP_VERSION})`)).toBeInTheDocument();
        expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('has its sections in order', () => {
        render(<About />);
        expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(SECTIONS);
    });

    it('links the author and both contacts', () => {
        render(<About />);
        const who = within(section('Who'));
        expect(who.getByRole('link', { name: 'TrinTragula' })).toHaveAttribute('href', 'https://github.com/TrinTragula');
        expect(who.getByRole('link', { name: '@McSeeder' })).toHaveAttribute('href', 'https://twitter.com/McSeeder');
        expect(who.getByRole('link', { name: 'spam@mcseeder.com' })).toHaveAttribute('href', 'mailto:spam@mcseeder.com');
        expect(who.getByText('I\'d love to know if you use this website and how')).toBeInTheDocument();
    });

    it('keeps its own donate buttons (the footer has them too)', () => {
        render(<About />);
        const help = section('Can I help?');
        expect(help.querySelector('form[action="https://www.paypal.com/donate"] input[name="hosted_button_id"]')).toHaveValue('LNMNHMPCKH6MG');
        expect(within(help).getByRole('link', { name: 'Buy Me A Coffee' })).toHaveAttribute('href', 'https://buymeacoffee.com/mcseeder');
    });

    it('names the supported versions from VERSIONS and credits the xpple fork', () => {
        render(<About />);
        const what = within(section('What is it'));
        expect(what.getByText(`Works with every Java version from ${OLDEST_VERSION_LABEL} to ${NEWEST_VERSION_LABEL}.`)).toBeInTheDocument();
        expect(section('What is it')).toHaveTextContent('Bedrock only if you are interested in biomes');
        expect(what.getByRole('link', { name: 'xpple/cubiomes fork' })).toHaveAttribute('href', 'https://github.com/xpple/cubiomes');
    });

    it('links the source', () => {
        render(<About />);
        expect(within(section("Where's the code?")).getByRole('link', { name: 'Here' })).toHaveAttribute('href', 'https://github.com/TrinTragula/seeder');
        expect(section("Where's the code?")).toHaveTextContent('MIT licence');
    });

    it('lists the current features, farms and overlays included', () => {
        render(<About />);
        const features = section('What it does');
        expect(features).toHaveTextContent(/quad/);
        expect(features).toHaveTextContent(/Slime-chunk/);
        expect(features).toHaveTextContent('My worlds');
    });

    it('states the limitations: Bedrock biomes match, its structures do not, and no End city claim', () => {
        render(<About />);
        const limits = section('Limitations');
        expect(limits).toHaveTextContent('From 1.18, a seed gives the same terrain and biomes on Bedrock');
        expect(limits).toHaveTextContent('those markers only hold for Java');
        expect(limits).not.toHaveTextContent(/not supported/);
        expect(limits).toHaveTextContent(/dungeon/i);
        expect(limits).toHaveTextContent(/desert pyramids, jungle temples and mansions/);
        expect(limits).not.toHaveTextContent(/End cit/i);
        expect(limits).toHaveTextContent(/1,000 blocks/);
    });

    it('credits cubiomes, its fork and the pixel font with its licence', () => {
        render(<About />);
        const credits = within(section('Credits'));
        expect(credits.getByRole('link', { name: 'cubiomes' })).toHaveAttribute('href', 'https://github.com/Cubitect/cubiomes');
        expect(credits.getByRole('link', { name: 'xpple/cubiomes' })).toHaveAttribute('href', 'https://github.com/xpple/cubiomes');
        expect(credits.getByRole('link', { name: /Minecraftia/ })).toHaveAttribute('href', 'http://www.andrewtyler.net');
        expect(credits.getByRole('link', { name: 'CC BY-SA 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/');
        expect(section('Credits')).toHaveTextContent('The pixel font is Minecraftia by Andrew Tyler, licensed CC BY-SA 3.0.');
        expect(credits.getByRole('link', { name: 'licenses.txt' })).toHaveAttribute('href', '/licenses.txt');
    });

    it('says which Google services see the page address', () => {
        render(<About />);
        const privacy = section('Privacy and ads');
        expect(privacy).toHaveTextContent(/Google Analytics/);
        expect(privacy).toHaveTextContent(/AdSense/);
        expect(privacy).toHaveTextContent('which includes the seed, version or search criteria');
    });

    it('carries exactly one ad, after the last section', () => {
        const { container } = render(<About />);
        const ads = container.querySelectorAll('ins.adsbygoogle');
        expect(ads).toHaveLength(1);
        expect(section('Privacy and ads').compareDocumentPosition(ads[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
