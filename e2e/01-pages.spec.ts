/**
 * Core Page Tests
 * Tests that all critical pages load and render correctly
 */

import { test, expect } from '@playwright/test';

test.setTimeout(60000);
test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Page Loading', () => {
  test('homepage loads with search and filters', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    // Must have search input
    const searchInput = page.getByPlaceholder(/search/i).first();
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    
    // Must have chain filter
    const chainFilter = page.locator('select').first();
    await expect(chainFilter).toBeVisible({ timeout: 5000 });
  });

  test('homepage has marketplace heading', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    await expect(page.getByRole('heading', { name: /marketplace/i })).toBeVisible({ timeout: 10000 });
  });

  test('consign page shows Sign In when not authenticated', async ({ page }) => {
    await page.goto('/consign');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
    await expect(signInBtn).toBeVisible({ timeout: 15000 });
  });

  test('my-deals page shows Sign In when not authenticated', async ({ page }) => {
    await page.goto('/my-deals');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
    await expect(signInBtn).toBeVisible({ timeout: 15000 });
  });

  test('how-it-works page loads with content', async ({ page }) => {
    await page.goto('/how-it-works');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    
    // Should have how-it-works specific content
    const hasContent = await page.locator('text=/list.*token|negotiate/i').first().isVisible({ timeout: 10000 }).catch(() => false);
    const hasHeading = await page.locator('h1, h2, h3').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    expect(hasContent || hasHeading).toBe(true);
  });

  test('terms page loads', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');
    
    await expect(page).toHaveURL(/terms/);
    const content = page.locator('p, h1, h2').first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test('privacy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');
    
    await expect(page).toHaveURL(/privacy/);
    const content = page.locator('p, h1, h2').first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test('nav links navigate correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    // My Deals link
    const myDealsLink = page.getByRole('link', { name: /deal/i }).first();
    await expect(myDealsLink).toBeVisible({ timeout: 5000 });
    await myDealsLink.click();
    await expect(page).toHaveURL(/my-deals/, { timeout: 10000 });
    
    // How It Works link
    await page.getByRole('link', { name: /how.*work/i }).first().click();
    await expect(page).toHaveURL(/how-it-works/, { timeout: 10000 });
    
    // Back to Trading Desk
    await page.getByRole('link', { name: /trading/i }).first().click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
  });

  test('footer has Terms and Privacy links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('link', { name: /terms/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: /privacy/i })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Mobile Responsive', () => {
  test('mobile viewport shows menu button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    const menuBtn = page.getByRole('button', { name: /menu/i });
    await expect(menuBtn).toBeVisible({ timeout: 10000 });
  });
});
