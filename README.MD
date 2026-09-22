# Seeder v0.7.0

Find, show, share and admire Minecraft seeds (Java edition only).

Works up to **26.3**!

![Seeder demo gif](https://i.ibb.co/KxW0Fm4/seeder1-18-dim.gif)

This is a webapp based upon a library ([cubiomes](https://github.com/Cubitect/cubiomes))
written by cubitect in C and compiled in webassembly by me.
Go and give him love. Since the original library is no longer maintained, this app now
builds against the actively maintained [xpple/cubiomes fork](https://github.com/xpple/cubiomes).

It's a React app that uses a WASM build of cubiomes to run the code in your browser, so that you
can look up your seeds/find your perfect ones without installing or configuring anything.

## Features

- [x] Generates biomes for a given seed
- [x] Find the spawn point
- [x] Find a seed containing a list of biomes in a given range
- [x] Find a seed containing a structure in a given range
- [x] Find a seed containing a structure AND a list of biomes in a given range
- [x] Works with different MC versions up to 26.3
- [x] Finding rare seeds may slow down your PC while the search is running (seed finding is a very CPU intensive job)
- [x] Support for the Nether and End
- [x] Move the map using your mouse (drag to pan, mouse wheel to zoom)

## Coming features:
- [ ] Less CPU hunger
- [ ] Find a list of structures, not just one
- [ ] Better zoom

## Development

```sh
cd seeder
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in seeder/build/
npm test             # unit + component + engine tests (Vitest)
npm run test:e2e     # browser tests against a production build (Playwright)
```

The Minecraft world generation runs as WebAssembly inside Web Workers; the compiled
engine is committed under `seeder/public/workers/`, so no C toolchain is needed to
work on the app. The engine tests load that same WASM headlessly in Node.
