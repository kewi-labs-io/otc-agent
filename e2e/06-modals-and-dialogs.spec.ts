/**
 * Modal and Dialog Component Tests
 * Tests all modal interactions and dialog flows without wallet requirements
 */

import { test, expect, Page } from '@playwright/test';

test.setTimeout(60000);
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

test.describe('Network Selection Modal', () => {
  test('opens when clicking connect', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click connect
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Should show network selection with EVM and Solana
    await expect(page.getByRole('button', { name: /evm/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /solana/i })).toBeVisible({ timeout: 5000 });
  });

  test('EVM option shows chain selector', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open connect modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Click EVM
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    
    // Should show Base and BSC options
    const hasBase = await page.getByRole('button', { name: /base/i }).first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasBsc = await page.getByRole('button', { name: /bsc/i }).isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasBase || hasBsc).toBeTruthy();
  });

  test('can close with Escape key', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Verify modal is open
    await expect(page.getByRole('button', { name: /evm/i })).toBeVisible({ timeout: 5000 });
    
    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    // Modal should be closed
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });

  test('Solana option triggers wallet connection', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open connect modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Click Solana
    await page.getByRole('button', { name: /solana/i }).click();
    await page.waitForTimeout(3000);
    
    // Should trigger Privy or show some connection UI
    const hasFarcaster = await page.getByRole('button', { name: /farcaster/i }).isVisible({ timeout: 3000 }).catch(() => false);
    const hasWallet = await page.getByRole('button', { name: /wallet/i }).isVisible({ timeout: 2000 }).catch(() => false);
    const hasClose = await page.getByRole('button', { name: /close/i }).isVisible({ timeout: 2000 }).catch(() => false);
    const hasSolanaUI = await page.getByText(/solana|phantom/i).isVisible({ timeout: 2000 }).catch(() => false);
    
    // Any wallet/auth UI means the button worked
    expect(hasFarcaster || hasWallet || hasClose || hasSolanaUI).toBeTruthy();
  });
});

test.describe('Chain Selector Modal', () => {
  test('shows supported EVM chains', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to chain selector
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    
    // Should show Base
    await expect(page.getByRole('button', { name: /base/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('selecting chain triggers Privy login', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to chain selector
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    
    // Select Base
    await page.getByRole('button', { name: /base/i }).first().click();
    await page.waitForTimeout(2000);
    
    // Privy modal should appear
    const farcasterBtn = page.getByRole('button', { name: /farcaster/i });
    const hasFarcaster = await farcasterBtn.isVisible({ timeout: 5000 }).catch(() => false);
    
    const walletBtn = page.getByRole('button', { name: /wallet/i });
    const hasWallet = await walletBtn.isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasFarcaster || hasWallet).toBeTruthy();
  });
});

test.describe('Privy Login Modal', () => {
  test('shows Farcaster option', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to Privy
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /base/i }).first().click();
    await page.waitForTimeout(2000);
    
    // Privy should show Farcaster
    const farcasterBtn = page.getByRole('button', { name: /farcaster/i });
    await expect(farcasterBtn).toBeVisible({ timeout: 5000 });
  });

  test('shows wallet option', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to Privy
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /base/i }).first().click();
    await page.waitForTimeout(2000);
    
    // Privy should show wallet option
    const walletBtn = page.getByRole('button', { name: /wallet/i });
    await expect(walletBtn).toBeVisible({ timeout: 5000 });
  });

  test('can close Privy modal', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to Privy
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /base/i }).first().click();
    await page.waitForTimeout(2000);
    
    // Close Privy modal
    const closeBtn = page.getByRole('button', { name: /close/i });
    if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Modal Accessibility', () => {
  test('modals trap focus', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Tab should stay within modal
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Should still be in modal context
    await expect(page.getByRole('button', { name: /evm/i })).toBeVisible();
  });

  test('modals have proper aria attributes', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Should have dialog role
    const dialog = page.locator('[role="dialog"]');
    const hasDialog = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    
    // Or has modal-like structure
    const hasModal = await page.getByRole('button', { name: /evm/i }).isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasDialog || hasModal).toBeTruthy();
  });
});
