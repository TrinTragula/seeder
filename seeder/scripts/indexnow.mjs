// npm run indexnow [-- --dry-run]
//
// Tells the IndexNow search engines (Bing, Yandex, Seznam…; ChatGPT search reads Bing's
// index) that the site's pages changed, after a deploy. It sends every URL of the built
// sitemap (build/sitemap.xml, so run `npm run build` first). The key is public by design:
// public/a914ea132e7a852cd2196a208cbb1630.txt proves the site owns it. Run it by hand after a deploy
// that changed pages; engines ignore repeated pings of unchanged URLs.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEY = 'a914ea132e7a852cd2196a208cbb1630';
const HOST = 'mcseeder.com';
const SITEMAP = fileURLToPath(new URL('../build/sitemap.xml', import.meta.url));

if (!fs.existsSync(SITEMAP)) {
    console.error('indexnow: build/sitemap.xml not found - run npm run build first.');
    process.exit(1);
}
const urlList = [...fs.readFileSync(SITEMAP, 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
const body = { host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList };
if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(body, null, 2));
    process.exit(0);
}
const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
});
console.log(`indexnow: ${urlList.length} URLs -> HTTP ${response.status} ${response.statusText}`);
if (!response.ok && response.status !== 202) process.exit(1);
