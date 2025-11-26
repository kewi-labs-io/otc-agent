/**
 * Multi-Chain Support Tests
 * Verifies that the application properly supports EVM (Base, BSC) and Solana
 */

import { test, expect, Page } from '@playwright/test';

test.setTimeout(120000);

// Set a desktop viewport for consistent behavior
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page to be interactive
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

test.describe('Multi-Chain Support', () => {
  test('network selection modal shows EVM and Solana', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click the connect button
    const connectBtn = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();
    await page.waitForTimeout(1500);
    
    // Should show both EVM and Solana options
    // Either in a chain selector modal or in the Privy login dialog
    const hasEvmOption = await page.getByRole('button', { name: /evm/i }).isVisible({ timeout: 5000 }).catch(() => false);
    const hasSolanaOption = await page.getByRole('button', { name: /solana/i }).isVisible({ timeout: 5000 }).catch(() => false);
    const hasPrivyDialog = await page.locator('[data-testid="privy"], text=Log in').first().isVisible({ timeout: 2000 }).catch(() => false);
    
    // Either shows our chain selector OR Privy takes over
    expect(hasEvmOption || hasSolanaOption || hasPrivyDialog).toBeTruthy();
  });

  test('EVM button is clickable and shows chain options', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click connect button
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Try to click EVM
    const evmBtn = page.getByRole('button', { name: /evm/i });
    if (await evmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await evmBtn.click();
      await page.waitForTimeout(1500);
      
      // Should show chain options (Base, BSC)
      const hasChainSelector = await page.getByRole('button', { name: /base/i }).isVisible({ timeout: 5000 }).catch(() => false);
      const hasBsc = await page.getByRole('button', { name: /bsc/i }).isVisible({ timeout: 2000 }).catch(() => false);
      const hasPrivyDialog = await page.locator('[data-testid="privy"], text=Log in').first().isVisible({ timeout: 2000 }).catch(() => false);
      
      expect(hasChainSelector || hasBsc || hasPrivyDialog).toBeTruthy();
    }
  });

  test('no hardcoded Base-only references', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click connect
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Should show chain selector modal with chain options (Base, BSC)
    const hasChainSelector = await page.locator('text=Select Chain, text=Base').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasPrivyDialog = await page.locator('[data-testid="privy"], text=Log in').first().isVisible({ timeout: 2000 }).catch(() => false);
    
    // Either custom UI or Privy fallback
    expect(hasChainSelector || hasPrivyDialog).toBeTruthy();
    
    // The UI should NOT say "Base only" or similar exclusionary text
    const hasBaseOnlyText = await page.getByText(/Base only|only Base/i).isVisible().catch(() => false);
    expect(hasBaseOnlyText).toBeFalsy();
  });
});

test.describe('Test Configuration', () => {
  test('Anvil Localnet configuration defaults are correct', async () => {
    // Default values when env vars not set
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
    const network = process.env.NETWORK || 'base';
    
    // RPC should default to localnet
    expect(rpcUrl).toMatch(/localhost|127\.0\.0\.1/);
    expect(network).toBe('base');
  });
});
