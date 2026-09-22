import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a production build served by `vite preview`, so
// what is tested is what gets deployed (minified bundle, real Web Workers, real WASM).
export default defineConfig({
    testDir: './e2e',
    // The app saturates every core with its worker pool: run tests one at a time.
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
        permissions: ['clipboard-read', 'clipboard-write'],
        ...devices['Desktop Chrome'],
    },
    webServer: {
        command: 'npm run build && npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 180_000,
    },
    projects: [{ name: 'chromium' }],
});
