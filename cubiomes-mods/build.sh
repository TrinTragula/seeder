#!/usr/bin/env bash
set -euo pipefail

# The Emscripten SDK: $EMSDK when set, otherwise an emsdk/ checkout at the repo root.
# emsdk_env.sh reads variables it does not define, so it is sourced without -u.
set +u
source "${EMSDK:-$(cd "$(dirname "$0")/.." && pwd)/emsdk}/emsdk_env.sh"
set -u

emmake make release
emcc -O3 -flto api.c libcubiomes.a -s WASM=1 -s STACK_SIZE=1048576 -s WASM_BIGINT -s NO_EXIT_RUNTIME=1 -s "EXPORTED_FUNCTIONS=['_malloc','_main']" -s "EXPORTED_RUNTIME_METHODS=['cwrap','HEAPU8','HEAP32']" -o ../seeder/public/workers/api.js
