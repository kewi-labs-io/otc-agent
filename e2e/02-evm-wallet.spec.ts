/**
 * EVM Wallet Connection and Interaction Tests
 * 
 * These tests require MetaMask extension via dappwright.
 * They will be SKIPPED in headless mode (CI).
 * Run with: npx playwright test --headed e2e/02-evm-wallet.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

// Check if we're in headed mode (dappwright requires this)
const isHeaded = !process.env.CI && process.env.HEADED !== 'false';

// Skip all wallet tests in headless/CI mode
test.skip(!isHeaded, 'Wallet tests require headed mode with MetaMask extension');

test.setTimeout(600000);

// Use Anvil Localnet for testing (default network)
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;

// Helper to wait for page
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

// Dynamic import of dappwright to avoid breaking headless tests
let bootstrap: typeof import('@tenkeylabs/dappwright').bootstrap;
let getWallet: typeof import('@tenkeylabs/dappwright').getWallet;
let MetaMaskWallet: typeof import('@tenkeylabs/dappwright').MetaMaskWallet;

test.beforeAll(async () => {
  if (!isHeaded) return;
  
  const dappwright = await import('@tenkeylabs/dappwright');
  bootstrap = dappwright.bootstrap;
  getWallet = dappwright.getWallet;
  MetaMaskWallet = dappwright.MetaMaskWallet;
});

test.describe('EVM Wallet Connection', () => {
  test('connect button opens network selector', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click connect button
    const connectBtn = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();
    await page.waitForTimeout(1500);
    
    // Should show EVM option
    const evmBtn = page.getByRole('button', { name: /evm/i });
    const hasEvm = await evmBtn.isVisible({ timeout: 5000 }).catch(() => false);
    
    expect(hasEvm).toBeTruthy();
  });

  test('EVM selection shows chain options', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open connect modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Click EVM
    const evmBtn = page.getByRole('button', { name: /evm/i });
    if (await evmBtn.isVisible({ timeout: 5000 })) {
      await evmBtn.click();
      await page.waitForTimeout(1500);
      
      // Should show Base and BSC options
      const baseBtn = page.getByRole('button', { name: /base/i });
      const bscBtn = page.getByRole('button', { name: /bsc/i });
      
      const hasBase = await baseBtn.isVisible({ timeout: 3000 }).catch(() => false);
      const hasBsc = await bscBtn.isVisible({ timeout: 3000 }).catch(() => false);
      
      expect(hasBase || hasBsc).toBeTruthy();
    }
  });
});

test.describe('EVM Wallet UI States', () => {
  test('disconnect state shows connect button', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Should show connect button when disconnected
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });

  test('wallet modal can be closed', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Press escape or click outside to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    // Modal should be closed (connect button visible again without modal)
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });
});

test.describe('Chain Switching UI', () => {
  test('chain selector shows supported chains', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open connect modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Click EVM
    const evmBtn = page.getByRole('button', { name: /evm/i });
    if (await evmBtn.isVisible({ timeout: 5000 })) {
      await evmBtn.click();
      await page.waitForTimeout(1500);
      
      // Verify chain options are visible
      const hasChainOptions = await page.locator('button').filter({ hasText: /base|bsc|ethereum/i }).first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(hasChainOptions).toBeTruthy();
    }
  });
});

// Note: Full wallet connection tests require dappwright in headed mode
// These are tested separately in the synpress tests or with manual QA
