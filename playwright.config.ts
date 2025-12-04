import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT) : 4444;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright configuration for E2E tests
 * App runs on port 4444 (OTC Desk)
 *
 * For local: Start the dev server manually with `bun run dev`
 * For CI: The workflow starts the server before running tests
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  testIgnore: [
    '**/node_modules/**',
    '**/contracts/lib/**',
    '**/contracts/test/**',
    '**/tests/**',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Server must be started manually before running tests (bun run dev)
  // In CI, the workflow starts the server before running tests
  webServer: undefined,
});

