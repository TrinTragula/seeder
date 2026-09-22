// The app version lives in package.json only; Vite injects it here at build time
// (see `define` in vite.config.js). Bump package.json and the About page, the
// worker cache-buster and the manifest link all follow.
export const APP_VERSION = __APP_VERSION__;

// Cache-busts the whole worker chain: worker.js forwards its ?v= to api.js,
// seeder.js and api.wasm, so a new release never runs against a stale WASM.
export const WORKER_PATH = `/workers/worker.js?v=${APP_VERSION}`;
