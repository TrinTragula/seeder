# Seeder v0.4.2

Find, show, share and admire Minecraft seeds (Java edition only).

Works up to **1.19**!

![Seeder demo gif](https://i.ibb.co/KxW0Fm4/seeder1-18-dim.gif)

This is a webapp based upon a library ([cubiomes](https://github.com/Cubitect/cubiomes))
written by cubitect in C and compiled in webassembly by me.
Go and give him love.

It's a React app that uses a WASM build of cubiomes to run the code in your browser, so that you
can look up your seeds/find your perfect ones whitout installing or configuring anything.

## Features

- [x] Generates biomes for a given seed
- [x] Find the spawn point
- [x] Find a seed containing a list of biomes in a given range
- [x] Find a seed containing a strcuture in a given range
- [x] Find a seed containing a strcuture AND a list of biomes in a given range
- [x] Works with different MC versions up to 1.19
- [x] Finding rare seeds may slow down you PC while the search is running (seed finding is a very CPU intensive job)
- [x] Support for the Nether and End

## Coming features:
- [ ] Less CPU hunger
- [ ] Find a list of structures, not just one
- [ ] Move the map using your mouse (for now you can use your keyboard)
- [ ] Better zoom
