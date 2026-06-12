import { defineConfig, devices } from '@playwright/test';

// Smoke-level E2E: drives the Svelte windows in a plain browser via the Vite dev server.
// Native calls are guarded by `'__TAURI_INTERNALS__' in window`, so the UI runs (degraded:
// no IPC/resize/tray). Full Tauri integration is verified manually / on a Windows runner.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
