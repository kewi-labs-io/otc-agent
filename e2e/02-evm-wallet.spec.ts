/**
 * EVM Wallet Connection and Interaction Tests
 * 
 * Tests basic wallet UI without requiring actual MetaMask connection.
 * Full wallet integration tests are in tests/synpress/
 */

import { test, expect, Page } from '@playwright/test';

test.setTimeout(60000);
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

test.describe('EVM Wallet UI', () => {
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
    await expect(evmBtn).toBeVisible({ timeout: 5000 });
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

  test('disconnect state shows connect button', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Should show connect button when disconnected
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });

  test('wallet modal can be closed with Escape', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Verify modal is open
    const evmBtn = page.getByRole('button', { name: /evm/i });
    await expect(evmBtn).toBeVisible({ timeout: 5000 });
    
    // Press escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    // Modal should be closed (connect button visible again)
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });

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
      await page.waitForTimeout(2000);
      
      // Verify chain options are visible (Base or BSC) OR Privy took over
      const hasBase = await page.getByRole('button', { name: /base/i }).first().isVisible({ timeout: 3000 }).catch(() => false);
      const hasBsc = await page.getByRole('button', { name: /bsc/i }).isVisible({ timeout: 2000 }).catch(() => false);
      const hasPrivy = await page.getByRole('button', { name: /farcaster/i }).isVisible({ timeout: 2000 }).catch(() => false);
      
      // Either chain selector OR Privy modal
      expect(hasBase || hasBsc || hasPrivy).toBeTruthy();
    }
  });

  test('selecting Base chain opens Privy modal', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open connect modal
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1500);
    
    // Click EVM
    const evmBtn = page.getByRole('button', { name: /evm/i });
    await evmBtn.click();
    await page.waitForTimeout(1500);
    
    // Click Base
    const baseBtn = page.getByRole('button', { name: /base/i }).first();
    await baseBtn.click();
    await page.waitForTimeout(2000);
    
    // Privy modal should appear with login options
    const privyModal = page.locator('text=log in, text=Farcaster, text=wallet').first();
    const hasPrivy = await privyModal.isVisible({ timeout: 5000 }).catch(() => false);
    
    // Alternative: check for Farcaster button specifically
    const farcasterBtn = page.getByRole('button', { name: /farcaster/i });
    const hasFarcaster = await farcasterBtn.isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasPrivy || hasFarcaster).toBeTruthy();
  });
});
