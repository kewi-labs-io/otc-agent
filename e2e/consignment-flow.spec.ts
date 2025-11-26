/**
 * Consignment Flow Tests
 * 
 * These tests require MetaMask via dappwright and MUST run in headed mode.
 * Run with: npx playwright test --headed e2e/consignment-flow.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

// Check if we're in headed mode (dappwright requires this)
const isHeaded = !process.env.CI && process.env.HEADED !== 'false';

// Skip wallet tests in headless/CI mode
test.skip(!isHeaded, 'Consignment flow tests require headed mode with MetaMask');

test.setTimeout(120000);
test.use({ viewport: { width: 1280, height: 720 } });

// Helper
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

test.describe('Consignment Flow', () => {
  test('placeholder for headed consignment tests', async ({ page }) => {
    // This test requires dappwright in headed mode
    console.log('Run with --headed flag for full consignment flow tests');
    expect(true).toBeTruthy();
  });
});

// For full consignment flow tests with wallet, see tests/synpress/
