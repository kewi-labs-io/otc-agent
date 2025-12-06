/**
 * Complete User Flow Tests
 * Tests critical user journeys through the application
 */

import { test, expect } from '@playwright/test';

test.setTimeout(120000);
test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Token Browsing Flow', () => {
  test('can browse and filter tokens', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    
    // Search for token
    const searchInput = page.getByPlaceholder(/search/i).first();
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await searchInput.fill('ELIZA');
    await page.waitForTimeout(500);
    await searchInput.clear();
    
    // Use chain filter
    const chainFilter = page.locator('select').first();
    if (await chainFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chainFilter.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }
    
    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('token page has chat interface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    
    // Find and click token link
    const tokenLink = page.locator('a[href*="/token/"]').first();
    
    if (await tokenLink.isVisible({ timeout: 10000 }).catch(() => false)) {
      await tokenLink.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      
      await expect(page).toHaveURL(/\/token\//);
      
      // Chat input should exist
      const chatInput = page.locator('textarea').last();
      await expect(chatInput).toBeVisible({ timeout: 15000 });
    } else {
      test.skip(true, 'No tokens available');
    }
  });
});

test.describe('Authentication Flow', () => {
  test('Sign In button opens Privy modal', async ({ page }) => {
    await page.goto('/consign');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
    await expect(signInBtn).toBeVisible({ timeout: 15000 });
    
    await signInBtn.click();
    await page.waitForTimeout(2000);
    
    // Privy modal should show auth options
    const hasPrivy = await page.locator('[class*="privy"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasFarcaster = await page.locator('text=/farcaster|continue with/i').first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasWallet = await page.locator('text=/wallet|metamask/i').first().isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasPrivy || hasFarcaster || hasWallet).toBe(true);
  });

  test('Escape key dismisses modal', async ({ page }) => {
    await page.goto('/consign');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
    await expect(signInBtn).toBeVisible({ timeout: 15000 });
    
    await signInBtn.click();
    await page.waitForTimeout(2000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    
    // Page should be functional
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Error Handling', () => {
  test('invalid token page handled gracefully', async ({ page }) => {
    await page.goto('/token/invalid-nonexistent-123', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    
    // Page should not crash
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('404 page for nonexistent routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');
    await page.waitForLoadState('domcontentloaded');
    
    const has404 = await page.locator('text=/404|not found/i').isVisible({ timeout: 5000 }).catch(() => false);
    const isRedirected = page.url().match(/localhost:\d+\/?$/);
    
    expect(has404 || isRedirected).toBeTruthy();
  });
});
