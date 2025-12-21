import { defineConfig, devices } from '@playwright/test';

const OTC_DESK_PORT = parseInt(process.env.OTC_DESK_PORT || '4444');
// Use IPv4 loopback explicitly to avoid localhost IPv6 (::1) issues in Chromium
const BASE_URL = `http://127.0.0.1:${OTC_DESK_PORT}`;
const IS_DARWIN = process.platform === 'darwin';
const USE_CHROME_CHANNEL =
  process.env.SYNPRESS_BROWSER_CHANNEL === 'chrome' ||
  (!IS_DARWIN && Boolean(process.env.CI));

/**
 * Synpress + Playwright configuration for E2E tests with real wallet interactions
 *
 * These tests perform REAL on-chain transactions and verify contract state:
 * - EVM: MetaMask + Anvil (local) or Base (testnet/mainnet)
 * - Solana: Phantom + solana-test-validator (local) or Solana mainnet
 *
 * Test Files:
 * - evm.e2e.test.ts: Full EVM lifecycle (list → buy → claim → withdraw)
 * - solana.e2e.test.ts: Full Solana lifecycle with on-chain verification
 *
 * Prerequisites:
 * - Anvil running: `anvil --host 127.0.0.1 --port 8545`
 * - Solana validator: `solana-test-validator` (optional, for Solana tests)
 * - Contracts deployed: `cd contracts && forge script scripts/DeployElizaOTC.s.sol --broadcast`
 * - Next.js running: `bun run dev`
 * - Synpress cache: `npx synpress`
 *
 * Run Commands:
 * - All tests:     npx playwright test --config=synpress.config.ts
 * - EVM only:      npx playwright test --config=synpress.config.ts tests/synpress/evm.e2e.test.ts
 * - Solana only:   npx playwright test --config=synpress.config.ts tests/synpress/solana.e2e.test.ts
 *
 * Environment:
 * - TEST_ENV=local (default) | testnet | mainnet
 */
export default defineConfig({
  testDir: './tests/synpress',
  testMatch: /.*\.(test|spec)\.ts$/,
  
  // Bring up/down real infrastructure for wallet E2E runs
  globalSetup: './tests/synpress/playwright-global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',

  // Run tests serially - wallet tests need isolation
  fullyParallel: false,
  workers: 1,
  
  // Longer timeouts for wallet interactions
  timeout: 180000,
  expect: {
    timeout: 30000,
  },
  
  forbidOnly: !!process.env.CI,
  retries: 0, // No retries for wallet tests - each retry resets wallet state
  
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Longer timeouts for wallet operations
    actionTimeout: 60000,
    navigationTimeout: 60000,
    
    // Headed mode required for wallet extensions
    headless: false,
  },
  
  projects: [
    {
      name: 'chromium-synpress',
      use: { 
        ...devices['Desktop Chrome'],
        // On macOS, Playwright's Chrome channel does not reliably load unpacked extensions
        // (MetaMask/Phantom) even when `--load-extension` is provided. Prefer bundled
        // Chromium unless explicitly requested.
        channel: USE_CHROME_CHANNEL ? 'chrome' : undefined,
        launchOptions: {
          headless: false,
          args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--allow-insecure-localhost',
          ],
        },
      },
    },
  ],
  
  // Don't auto-start server - must be running already with contracts deployed
  webServer: undefined,
});
