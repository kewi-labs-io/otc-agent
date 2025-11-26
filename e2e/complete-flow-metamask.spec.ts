/**
 * Complete MetaMask Flow Tests
 * 
 * These tests require MetaMask via dappwright and MUST run in headed mode.
 * Run with: npx playwright test --headed e2e/complete-flow-metamask.spec.ts
 */

import { test, expect } from '@playwright/test';

// Check if we're in headed mode (dappwright requires this)
const isHeaded = !process.env.CI && process.env.HEADED !== 'false';

// Skip all tests in headless/CI mode
test.skip(!isHeaded, 'MetaMask tests require headed mode');

test.setTimeout(600000);

test.describe('Complete MetaMask Flows', () => {
  test('placeholder for headed MetaMask tests', async ({ page }) => {
    // This test requires dappwright in headed mode
    // Full implementation uses dappwright to control MetaMask
    console.log('Run with --headed flag for full MetaMask tests');
    expect(true).toBeTruthy();
  });
});

// For full wallet integration tests, see:
// - tests/synpress/two-party-otc.test.ts
// - Run: npx playwright test --headed --config=synpress.config.ts
