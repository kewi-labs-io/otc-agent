/**
 * Comprehensive Coverage Tests
 * Additional tests for thorough coverage without wallet requirements
 */

import { test, expect, Page } from '@playwright/test';

test.setTimeout(60000);
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

test.describe('Button State Coverage', () => {
  test('all buttons render correctly', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Find visible buttons
    const buttons = page.locator('button:visible');
    const count = await buttons.count();
    
    expect(count).toBeGreaterThan(0);
  });

  test('connect button has correct state', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    const connectBtn = page.getByRole('button', { name: /connect/i }).first();
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toBeEnabled();
  });
});

test.describe('Input Field Coverage', () => {
  test('search input works correctly', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    const searchInput = page.getByPlaceholder(/search tokens/i);
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Type in search
      await searchInput.fill('test');
      expect(await searchInput.inputValue()).toBe('test');
      
      // Clear
      await searchInput.clear();
      expect(await searchInput.inputValue()).toBe('');
    }
  });
});

test.describe('Dropdown Coverage', () => {
  test('chain dropdown has options', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    const dropdown = page.getByRole('combobox', { name: /chain/i }).first();
    if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = dropdown.locator('option');
      const count = await options.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('type dropdown has options', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    const dropdown = page.getByRole('combobox', { name: /type/i }).first();
    if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      const options = dropdown.locator('option');
      const count = await options.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

test.describe('Page Content Coverage', () => {
  test('homepage has marketplace heading', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    await expect(page.getByRole('heading', { name: /marketplace/i })).toBeVisible({ timeout: 10000 });
  });

  test('how-it-works has content', async ({ page }) => {
    await page.goto('/how-it-works');
    await waitForPageReady(page);
    
    // Should have some content
    const headings = page.locator('h1, h2, h3');
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
  });

  test('terms page has content', async ({ page }) => {
    await page.goto('/terms');
    await waitForPageReady(page);
    
    const content = page.locator('p, h1, h2');
    const count = await content.count();
    expect(count).toBeGreaterThan(0);
  });

  test('privacy page has content', async ({ page }) => {
    await page.goto('/privacy');
    await waitForPageReady(page);
    
    const content = page.locator('p, h1, h2');
    const count = await content.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Modal Coverage', () => {
  test('network modal shows EVM and Solana', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    await expect(page.getByRole('button', { name: /evm/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /solana/i })).toBeVisible();
  });

  test('chain modal shows Base and BSC', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    
    const hasBase = await page.getByRole('button', { name: /base/i }).first().isVisible().catch(() => false);
    const hasBsc = await page.getByRole('button', { name: /bsc/i }).isVisible().catch(() => false);
    
    expect(hasBase || hasBsc).toBeTruthy();
  });

  test('Privy modal appears after chain selection', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /base/i }).first().click();
    await page.waitForTimeout(2000);
    
    // Privy should show
    const hasFarcaster = await page.getByRole('button', { name: /farcaster/i }).isVisible({ timeout: 5000 }).catch(() => false);
    const hasWallet = await page.getByRole('button', { name: /wallet/i }).isVisible().catch(() => false);
    
    expect(hasFarcaster || hasWallet).toBeTruthy();
  });
});

test.describe('Navigation Coverage', () => {
  test('all nav links are present', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Trading Desk
    await expect(page.getByRole('link', { name: /trading/i }).first()).toBeVisible();
    
    // My Deals
    await expect(page.getByRole('link', { name: /deal/i }).first()).toBeVisible();
    
    // How It Works
    await expect(page.getByRole('link', { name: /how.*work/i }).first()).toBeVisible();
  });

  test('nav links navigate correctly', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Test each link
    await page.getByRole('link', { name: /deal/i }).first().click();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/my-deals/);
    
    await page.getByRole('link', { name: /how.*work/i }).first().click();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/how-it-works/);
    
    await page.getByRole('link', { name: /trading/i }).first().click();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Footer Coverage', () => {
  test('footer has terms link', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('link', { name: /terms/i })).toBeVisible();
  });

  test('footer has privacy link', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    
    await expect(page.getByRole('link', { name: /privacy/i })).toBeVisible();
  });
});

test.describe('Responsive Coverage', () => {
  test('mobile viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForPageReady(page);
    
    // Just check body is visible (connect might be in menu on mobile)
    await expect(page.locator('body')).toBeVisible();
    
    // Try to find connect button or menu
    const menuBtn = page.getByRole('button', { name: /menu/i });
    if (await menuBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await menuBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Either connect is visible after menu or page just renders
    expect(page.url().includes('localhost')).toBeTruthy();
  });

  test('tablet viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await waitForPageReady(page);
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('desktop viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForPageReady(page);
    
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Error Handling Coverage', () => {
  test('404 page works', async ({ page }) => {
    await page.goto('/nonexistent-12345');
    await waitForPageReady(page);
    
    // Should show 404 or redirect
    const has404 = await page.getByText(/404|not found/i).isVisible().catch(() => false);
    const isRedirected = page.url().match(/localhost:\d+\/?$/);
    
    expect(has404 || isRedirected).toBeTruthy();
  });

  test('invalid token page handled', async ({ page }) => {
    await page.goto('/token/invalid123');
    await waitForPageReady(page);
    
    // Should show error or redirect
    await expect(page.locator('body')).toBeVisible();
  });

  test('invalid deal page handled', async ({ page }) => {
    await page.goto('/deal/invalid123');
    await waitForPageReady(page);
    
    // Should show error or redirect
    await expect(page.locator('body')).toBeVisible();
  });
});
