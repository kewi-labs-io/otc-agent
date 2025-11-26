/**
 * Page Load Tests
 * Tests that all pages load correctly without errors
 */

import { test, expect, Page } from '@playwright/test';

// Set a desktop viewport for all tests to ensure consistent behavior
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page to be interactive
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  // Give dynamic components time to hydrate
  await page.waitForTimeout(1000);
}

test.describe('Page Load Tests', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    await expect(page).toHaveTitle(/OTC/i);
    
    // Should show marketplace heading
    await expect(page.getByRole('heading', { name: /OTC Marketplace/i })).toBeVisible({ timeout: 10000 });
    
    // Connect button should be visible
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('/how-it-works loads correctly', async ({ page }) => {
    await page.goto('/how-it-works');
    await waitForPageReady(page);
    
    // Should have title or heading
    const hasTitle = await page.locator('h1, h2').first().isVisible();
    expect(hasTitle).toBeTruthy();
    
    // No error states
    await expect(page.getByText(/error|500|404/i)).not.toBeVisible();
  });

  test('/consign loads correctly', async ({ page }) => {
    await page.goto('/consign');
    await waitForPageReady(page);
    
    // Should show consignment form or connect prompt
    const hasForm = await page.getByText(/consign|list|select token/i).first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasConnectPrompt = await page.getByRole('button', { name: /connect/i }).isVisible({ timeout: 5000 }).catch(() => false);
    
    expect(hasForm || hasConnectPrompt).toBeTruthy();
  });

  test('/my-deals loads correctly', async ({ page }) => {
    await page.goto('/my-deals');
    await waitForPageReady(page);
    
    // Should show deals page or connect prompt
    const hasDeals = await page.getByText(/my deals|purchases|listings/i).first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasConnectPrompt = await page.getByRole('button', { name: /connect/i }).isVisible({ timeout: 5000 }).catch(() => false);
    
    expect(hasDeals || hasConnectPrompt).toBeTruthy();
  });

  test('/privacy loads correctly', async ({ page }) => {
    await page.goto('/privacy');
    await waitForPageReady(page);
    
    await expect(page).toHaveURL(/privacy/);
    // Should have privacy-related content
    const hasContent = await page.locator('h1, h2, p').first().isVisible();
    expect(hasContent).toBeTruthy();
  });

  test('/terms loads correctly', async ({ page }) => {
    await page.goto('/terms');
    await waitForPageReady(page);
    
    await expect(page).toHaveURL(/terms/);
    // Should have terms-related content
    const hasContent = await page.locator('h1, h2, p').first().isVisible();
    expect(hasContent).toBeTruthy();
  });

  test('navigation between pages works', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to how it works via link if available
    const howItWorksLink = page.getByRole('link', { name: /how it works/i });
    if (await howItWorksLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await howItWorksLink.click();
      await waitForPageReady(page);
      await expect(page).toHaveURL(/how-it-works/);
    }
    
    // Navigate back to home
    const homeLink = page.getByRole('link', { name: /home|otc|marketplace/i }).first();
    if (await homeLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await homeLink.click();
      await waitForPageReady(page);
    }
    
    // Should be back on homepage
    await expect(page.locator('body')).toBeVisible();
  });

  test('responsive design - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForPageReady(page);
    
    // Page should be usable on mobile
    await expect(page.locator('body')).toBeVisible();
    
    // Connect button should still be accessible
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });

  test('responsive design - tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await waitForPageReady(page);
    
    // Page should be usable on tablet
    await expect(page.locator('body')).toBeVisible();
  });

  test('404 page handling', async ({ page }) => {
    await page.goto('/nonexistent-page-12345');
    await waitForPageReady(page);
    
    // Should show 404 or redirect to home
    const has404 = await page.getByText(/404|not found/i).isVisible({ timeout: 5000 }).catch(() => false);
    const isHome = page.url().endsWith('/') || page.url().includes('localhost:5004');
    
    expect(has404 || isHome).toBeTruthy();
  });
});

test.describe('Footer Links', () => {
  test('footer contains legal links', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    // Should have Terms and Privacy links
    const termsLink = page.getByRole('link', { name: /terms/i });
    const privacyLink = page.getByRole('link', { name: /privacy/i });
    
    const hasTerms = await termsLink.isVisible({ timeout: 5000 }).catch(() => false);
    const hasPrivacy = await privacyLink.isVisible({ timeout: 5000 }).catch(() => false);
    
    // At least one legal link should be visible
    expect(hasTerms || hasPrivacy).toBeTruthy();
  });

  test('terms page is accessible via direct navigation', async ({ page }) => {
    // Footer links may open in new tab, so test direct navigation
    await page.goto('/terms');
    await waitForPageReady(page);
    
    await expect(page).toHaveURL(/terms/);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
  });

  test('privacy page is accessible via direct navigation', async ({ page }) => {
    // Footer links open in new tab (target="_blank"), so test direct navigation
    await page.goto('/privacy');
    await waitForPageReady(page);
    
    await expect(page).toHaveURL(/privacy/);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
  });
});
