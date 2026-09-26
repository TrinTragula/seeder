# Seeder v1.0.2

Find, show, share and admire Minecraft seeds (Java edition mostly, Bedrock only if you are interested in biomes).

Works up to **26.3**!

![Seeder demo gif](https://i.ibb.co/KxW0Fm4/seeder1-18-dim.gif)

This is a webapp based upon a library ([cubiomes](https://github.com/Cubitect/cubiomes))
written by cubitect in C and compiled in webassembly by me.
Go and give him love. Since the original library is no longer maintained, this app now
builds against the actively maintained [xpple/cubiomes fork](https://github.com/xpple/cubiomes).

It's a React app that uses a WASM build of cubiomes to run the code in your browser, so that you
can look up your seeds/find your perfect ones without installing or configuring anything.

Works with every Java version from Beta 1.7 to 26.3. From 1.18 a seed gives the same terrain and
biomes on Bedrock too, so the biome map works for Bedrock worlds; structures, strongholds and slime
chunks are placed differently there, so those only hold for Java.

## Features

### Home page
- [x] Open any seed (a number or text, like the game does) or a random one
- [x] Continue with the last seed you opened, or one of your saved worlds
- [x] Old share links still work, they open the new seed page

### Seed map
- [x] Generates biomes for a given seed, in the Overworld, the Nether and the End
- [x] Biomes at any height from 1.18
- [x] Find the spawn point, the strongholds and the structures
- [x] Slime-chunk and chunk-grid overlays
- [x] Move the map using your mouse (drag to pan, mouse wheel to zoom) or your fingers (pinch to zoom)
- [x] Works on phones: full screen map, and everything else in a sheet you pull up
- [x] A dashboard next to the map, in tabs:
  - Map: version, dimension, height, zoom, legend, share link, save the world
  - Spawn & structures: spawn, strongholds with the number of eyes in their portal room, the nearest
    structures with their variants (zombie villages, giant ruined portals, bastion types, End city ships…)
  - Biomes: which biomes are around spawn, and where the nearest patch of any biome is
  - Find near me: what is at any coordinates you type
  - More: farms (whether the seed has a quad witch farm, blaze spawners in fortresses) and My worlds,
    to save the seeds you play

### Seed finder
- [x] Find seeds with several biomes and several structures at once, many results per search
- [x] Presets for common searches (speedrun, island, scenic, structure hunts)
- [x] Every result has a little map you can open, the spawn and where the structures are
- [x] Share a search or its seeds with a link, find more, export results as CSV or JSON, or share a picture of a seed
- [x] Finding rare seeds may slow down your PC while the search is running (seed finding is a very CPU intensive job)

## Ideas
- [ ] Ores and caves
- [ ] Chest loot

## Credits
- World generation: [cubiomes](https://github.com/Cubitect/cubiomes) by Cubitect (MIT licence), via the
  [xpple/cubiomes](https://github.com/xpple/cubiomes) fork.
- The pixel font is Minecraftia by Andrew Tyler, licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.

## Development

```sh
cd seeder
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in seeder/build/
npm test             # unit + component + engine tests (Vitest)
npm run test:e2e     # browser tests against a production build (Playwright)
npm run shots        # the home page pictures (needs cwebp)
npm run og-card      # the social preview picture, from the map one
```

The Minecraft world generation runs as WebAssembly inside Web Workers; the compiled
engine is committed under `seeder/public/workers/`, so no C toolchain is needed to
work on the app. The engine tests load that same WASM headlessly in Node.

## Licence

MIT, see [LICENSE](LICENSE).
