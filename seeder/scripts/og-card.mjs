// Renders the OpenGraph / Twitter card every page points at:
//
//     npm run og-card      # = node scripts/og-card.mjs
//
// It lays out a 1200×630 HTML card in headless Chromium (the one @playwright/test
// installed) and screenshots it to public/img/og-card.png: on the left a 600×600 crop
// of the landing's map capture (public/img/landing/map.webp, from `npm run shots`), so
// the preview looks like the product; on the right the name in the site's pixel font,
// the tagline, the address and the Mojang disclaimer. No server and no build needed.
// The PNG is committed and may be replaced with a hand-made one.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const APP = fileURLToPath(new URL('..', import.meta.url));
const MAP = join(APP, 'public', 'img', 'landing', 'map.webp');
const BASE_CSS = join(APP, 'src', 'shared', 'styles', 'base.css');
const OUT = join(APP, 'public', 'img', 'og-card.png');
const WIDTH = 1200;
const HEIGHT = 630;

// The same words as the landing's h1 and the footer's disclaimer. Read from the sources
// rather than imported: content.js pulls in constants.jsx (JSX) and Footer.jsx is JSX,
// neither of which plain Node can load.
const TAGLINE = 'Minecraft seed map, finder & explorer';
const DISCLAIMER = 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.';

const fail = (message) => {
    console.error(`og-card: ${message}`);
    process.exit(1);
};

function sourceString(file, name) {
    const text = readFileSync(join(APP, file), 'utf8');
    const match = text.match(new RegExp(`export const ${name} = (['"])(.*?)\\1;`));
    if (!match) fail(`could not read ${name} from ${file}`);
    return match[2];
}

// The pixel font is embedded in base.css as a data URI: reuse that exact @font-face, so
// the card shows the font the site shows (Minecraftia, CC BY-SA 3.0, Andrew Tyler).
function fontFace() {
    const css = readFileSync(BASE_CSS, 'utf8');
    const face = css.match(/@font-face\s*{[^}]*}/);
    if (!face || !face[0].includes('data:font/')) fail(`no embedded @font-face found in ${BASE_CSS}`);
    return face[0];
}

function cardHtml(mapDataUri) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><style>
${fontFace()}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    display: flex; gap: 12px; padding: 12px;
    background: #8FCA5C;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111;
}
.map {
    /* content-box: the crop is the capture's own 600×600 pixels, unscaled (600 + 2×3 + 2×12 = 630). */
    flex: none; box-sizing: content-box; width: 600px; height: 600px;
    border: 3px solid #000;
    background: #333 url(${mapDataUri}) center / cover no-repeat;
}
.text {
    flex: 1; min-width: 0; display: flex; flex-direction: column;
    padding: 48px 40px 32px;
    border: 3px solid #000; background: #f5f5f5;
}
h1 { margin: 0; font: 96px/1 Minecraft, monospace; }
.tagline { margin: 32px 0 0; font-size: 40px; font-weight: 700; line-height: 1.2; }
.site { margin: 28px 0 0; font: 32px/1 Minecraft, monospace; color: #1b1b1b; }
.legal { margin: auto 0 0; font-size: 17px; line-height: 1.4; color: #555; }
</style></head><body>
<div class="map" role="img" aria-label="Biome map of a seed"></div>
<div class="text">
    <h1>Seeder</h1>
    <p class="tagline">${TAGLINE}</p>
    <p class="site">mcseeder.com</p>
    <p class="legal">${DISCLAIMER}</p>
</div>
</body></html>`;
}

async function main() {
    if (!existsSync(MAP)) fail(`${MAP} is missing: run npm run shots first.`);
    // Stale copies here would put words on the card the site no longer says.
    if (sourceString('src/pages/landing/content.js', 'HERO_TITLE') !== TAGLINE) fail('TAGLINE differs from HERO_TITLE in content.js');
    if (sourceString('src/shared/Footer.jsx', 'DISCLAIMER') !== DISCLAIMER) fail('DISCLAIMER differs from Footer.jsx');

    const mapDataUri = `data:image/webp;base64,${readFileSync(MAP).toString('base64')}`;
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.setContent(cardHtml(mapDataUri), { waitUntil: 'load' });
        // A card rendered in the fallback monospace would ship silently: insist on the pixel font.
        await page.evaluate(() => document.fonts.ready);
        const loaded = await page.evaluate(() => document.fonts.check('96px Minecraft'));
        if (!loaded) fail('the Minecraft font did not load');
        await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    } finally {
        await browser.close();
    }
    console.log(`${OUT}  ${WIDTH}×${HEIGHT}  ${(statSync(OUT).size / 1024).toFixed(1)} kB`);
}

main().catch((error) => fail(error.stack ?? String(error)));
