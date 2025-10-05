import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests serially for blockchain state consistency
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker for blockchain tests
  reporter: 'html',
  timeout: 600000, // 10 minutes to allow wallet extension download on first run
  
  use: {
    baseURL: 'http://localhost:2222',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      testMatch: ['e2e/*.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bash scripts/test-playwright-start.sh',
    url: 'http://localhost:2222',
    reuseExistingServer: !process.env.CI,
    timeout: 240000,
    env: {
      NEXT_PUBLIC_E2E_TEST: '1',
      NODE_ENV: 'development',
    },
  },
});

