source "/Users/tucano/Personal/git/seeder/emsdk/emsdk_env.sh"
# source ~/git/temp/emsdk/emsdk_env.sh

emmake make release
emcc -O3 -flto api.c libcubiomes.a -s WASM=1 -s STACK_SIZE=1048576 -s WASM_BIGINT -s NO_EXIT_RUNTIME=1 -s "EXPORTED_FUNCTIONS=['_malloc','_main']" -s "EXPORTED_RUNTIME_METHODS=['cwrap','HEAPU8','HEAP32']" -o ../seeder/public/workers/api.js
