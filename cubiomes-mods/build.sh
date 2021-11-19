source "/mnt/c/git/seeder/cubiomes-mods/emsdk/emsdk_env.sh"

emmake make release
emcc -O3 api.c libcubiomes.a -s WASM=1 -s WASM_BIGINT -s NO_EXIT_RUNTIME=1 -s "EXPORTED_FUNCTIONS=['_malloc','_main']" -s "EXTRA_EXPORTED_RUNTIME_METHODS=['cwrap']" -o ../seeder/public/workers/api.js
