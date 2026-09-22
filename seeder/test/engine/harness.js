// Runs the real worker chain (public/workers/worker.js -> api.js -> seeder.js ->
// api.wasm) headlessly in Node, inside a `vm` context shaped like a Web Worker.
//
// The context gets exactly what the browser gives a worker and nothing else:
// `self`, `location`, `postMessage`, `addEventListener`, `importScripts`, plus
// the platform globals Emscripten needs. Defining `WorkerGlobalScope` makes the
// Emscripten loader take its worker code path, and `INIT { module }` hands it a
// precompiled WebAssembly.Module exactly as QueueManager does, so nothing is
// fetched. Every message therefore goes through the app's own marshaling code
// (seeder.js) - tests exercise the contract QueueManager relies on, not a copy.
//
// Typed arrays: the context is given the outer realm's constructors so results
// (Int32Array, Uint8ClampedArray, ...) are ordinary instances in the test file.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..', '..');          // seeder/ (the Vite app)
export const REPO_ROOT = path.resolve(APP_ROOT, '..');            // repository root
export const WORKERS_DIR = path.join(APP_ROOT, 'public', 'workers');
export const PUBLIC_DIR = path.join(APP_ROOT, 'public');

const compiledModules = new Map();
// Compile api.wasm once per process (per directory), like the browser pool does.
export function compileWasm(workersDir = WORKERS_DIR) {
    if (!compiledModules.has(workersDir)) {
        const bytes = fs.readFileSync(path.join(workersDir, 'api.wasm'));
        compiledModules.set(workersDir, WebAssembly.compile(bytes));
    }
    return compiledModules.get(workersDir);
}

const REALM_GLOBALS = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextDecoder, TextEncoder, performance, URL, URLSearchParams, WebAssembly, Response,
    ArrayBuffer, SharedArrayBuffer, DataView, Uint8Array, Uint8ClampedArray, Int8Array,
    Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
    BigInt64Array, BigUint64Array,
};

// Low level: a worker-shaped vm context with worker.js already evaluated.
// `onMessage(message, transfer)` receives everything the worker posts.
export function createWorkerContext({ workersDir = WORKERS_DIR, cacheBust = 'test', onMessage }) {
    const listeners = [];
    const context = {
        ...REALM_GLOBALS,
        location: {
            search: `?v=${cacheBust}`,
            href: `http://localhost/workers/worker.js?v=${cacheBust}`,
        },
        WorkerGlobalScope: function WorkerGlobalScope() { },
        postMessage: (message, transfer) => onMessage(message, transfer),
        addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
        removeEventListener: (type, fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        },
        importScripts: (...urls) => {
            for (const url of urls) {
                const file = url.split('?')[0];
                vm.runInContext(fs.readFileSync(path.join(workersDir, file), 'utf8'), context, { filename: file });
            }
        },
        // Only used when INIT carries no module: the loader then fetches api.wasm itself.
        fetch: async (url) => {
            const file = String(url).split('?')[0].split('/').pop();
            return new Response(fs.readFileSync(path.join(workersDir, file)), {
                headers: { 'Content-Type': 'application/wasm' },
            });
        },
    };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(workersDir, 'worker.js'), 'utf8'), context, { filename: 'worker.js' });
    return {
        context,
        dispatch: (data) => { for (const fn of [...listeners]) fn({ data }); },
        listenerCount: () => listeners.length,
    };
}

// High level: a worker you can talk to with the real message protocol.
//   const w = await createWorkerHarness();          // INIT sent, DONE_LOADING awaited
//   const reply = await w.call('GET_SPAWN', { mcVersion: 35, seed: '123' }); // -> DONE_GET_SPAWN message
export async function createWorkerHarness({ workersDir = WORKERS_DIR, cacheBust = 'test', init = true, module } = {}) {
    const messages = [];
    const waiters = [];
    const transfers = new WeakMap();   // message -> transfer list passed to postMessage
    const worker = createWorkerContext({
        workersDir, cacheBust,
        onMessage: (message, transfer) => {
            if (transfer) transfers.set(message, transfer);
            messages.push(message);
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i].kind === message.kind) {
                    const [waiter] = waiters.splice(i, 1);
                    messages.splice(messages.indexOf(message), 1);
                    waiter.resolve(message);
                }
            }
        },
    });

    const harness = {
        workersDir,
        messages,
        get context() { return worker.context; },
        get seeder() { return worker.context.seeder; },
        get Module() { return worker.context.Module; },
        listenerCount: worker.listenerCount,
        transferOf: (message) => transfers.get(message),
        sendRaw: (message) => worker.dispatch(message),
        send: (kind, data) => worker.dispatch(data === undefined ? { kind } : { kind, data }),
        // Resolves with the next message of `kind` (consuming it), or rejects on timeout.
        next: (kind, timeoutMs = 60_000) => {
            const i = messages.findIndex((m) => m.kind === kind);
            if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
            return new Promise((resolve, reject) => {
                const waiter = { kind, resolve };
                waiters.push(waiter);
                setTimeout(() => {
                    const w = waiters.indexOf(waiter);
                    if (w >= 0) { waiters.splice(w, 1); reject(new Error(`timed out waiting for ${kind}`)); }
                }, timeoutMs).unref?.();
            });
        },
        // Remove and return every buffered message of `kind`.
        drain: (kind) => {
            const out = messages.filter((m) => m.kind === kind);
            for (const m of out) messages.splice(messages.indexOf(m), 1);
            return out;
        },
        clear: () => { messages.length = 0; },
        // Post a request and await its reply (default: DONE_<kind>).
        call: async (kind, data, replyKind = `DONE_${kind}`) => {
            harness.send(kind, data);
            return harness.next(replyKind);
        },
        init: async (mod) => {
            worker.dispatch({ kind: 'INIT', module: mod === undefined ? await compileWasm(workersDir) : mod });
            return harness.next('DONE_LOADING');
        },
    };

    if (init) await harness.init(module);
    return harness;
}

// The app's Seeder class (seeder.js) bound to a live WASM instance, for direct calls.
export async function loadSeeder(options) {
    const harness = await createWorkerHarness(options);
    return harness.seeder;
}

// A `Worker` constructor backed by the vm harness, for driving QueueManager in
// Node: replies are delivered asynchronously like real worker messages.
export function makeFakeWorkerClass({ workersDir = WORKERS_DIR } = {}) {
    return class VmWorker {
        static instances = [];
        constructor(url) {
            VmWorker.instances.push(this);
            this.url = url;
            this.terminated = false;
            this.listeners = [];
            this.onmessage = null;
            this.inner = createWorkerContext({
                workersDir,
                cacheBust: new URLSearchParams(String(url).split('?')[1] || '').get('v') || 'test',
                onMessage: (message) => {
                    setTimeout(() => {
                        if (this.terminated) return;
                        const event = { data: message };
                        for (const fn of [...this.listeners]) fn(event);
                        this.onmessage?.(event);
                    }, 0);
                },
            });
        }
        postMessage(message) {
            if (this.terminated) return;
            setTimeout(() => { if (!this.terminated) this.inner.dispatch(message); }, 0);
        }
        addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); }
        removeEventListener(type, fn) { this.listeners = this.listeners.filter((f) => f !== fn); }
        terminate() { this.terminated = true; }
    };
}

// Helpers shared by the engine tests.
export const sha1 = async (typed) => {
    const { createHash } = await import('node:crypto');
    return createHash('sha1').update(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)).digest('hex').slice(0, 16);
};
