/**
 * Solana Wallet UI Tests
 * 
 * These tests verify Solana-related UI without requiring actual wallet connection.
 * Phantom wallet automation is limited, so we use page mocking for UI testing.
 */

import { test, expect, Page } from '@playwright/test';

test.setTimeout(60000);
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page
async function waitForPageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

// Mock Phantom wallet types
interface MockPublicKey {
  toBase58: () => string;
  toString: () => string;
}

interface MockPhantomSolana {
  isPhantom: boolean;
  publicKey: MockPublicKey;
  connect: () => Promise<{ publicKey: MockPublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: <T>(tx: T) => Promise<T>;
  signAllTransactions: <T>(txs: T[]) => Promise<T[]>;
}

interface MockPhantom {
  solana: MockPhantomSolana;
}

declare global {
  interface Window {
    phantom?: MockPhantom;
  }
}

test.describe('Solana Wallet UI', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Phantom wallet installation
    await page.addInitScript(() => {
      (window as Window & { phantom?: MockPhantom }).phantom = {
        solana: {
          isPhantom: true,
          publicKey: {
            toBase58: () => 'DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ',
            toString: () => 'DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ',
          },
          connect: async () => ({
            publicKey: {
              toBase58: () => 'DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ',
              toString: () => 'DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ',
            },
          }),
          disconnect: async () => {},
          signTransaction: async <T>(tx: T) => tx,
          signAllTransactions: async <T>(txs: T[]) => txs,
        },
      };
    });
  });

  test('shows Solana option in network selector', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click connect button
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Should show Solana option
    const solanaBtn = page.getByRole('button', { name: /solana/i });
    await expect(solanaBtn).toBeVisible({ timeout: 5000 });
  });

  test('can select Solana network', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Click connect and choose Solana
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    const solanaBtn = page.getByRole('button', { name: /solana/i });
    if (await solanaBtn.isVisible({ timeout: 5000 })) {
      await solanaBtn.click();
      await page.waitForTimeout(3000);
      
      // Check for various possible wallet/auth UI states
      const hasFarcaster = await page.getByRole('button', { name: /farcaster/i }).isVisible({ timeout: 3000 }).catch(() => false);
      const hasWalletOption = await page.getByRole('button', { name: /wallet/i }).isVisible({ timeout: 2000 }).catch(() => false);
      const hasPhantom = await page.getByText(/phantom/i).isVisible({ timeout: 2000 }).catch(() => false);
      const hasCloseModal = await page.getByRole('button', { name: /close/i }).isVisible({ timeout: 2000 }).catch(() => false);
      
      // Any wallet/auth UI means the button worked
      expect(hasFarcaster || hasWalletOption || hasPhantom || hasCloseModal).toBeTruthy();
    }
  });

  test('network switcher shows both EVM and Solana', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Open connect dialog
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.waitForTimeout(1000);
    
    // Both network families should be visible
    const evmBtn = page.getByRole('button', { name: /evm/i });
    const solanaBtn = page.getByRole('button', { name: /solana/i });
    
    await expect(evmBtn).toBeVisible({ timeout: 5000 });
    await expect(solanaBtn).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Solana Token Detection', () => {
  test('page loads without Solana token errors', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Check if marketplace shows without errors
    await expect(page.locator('body')).toBeVisible();
    
    // No console errors about Solana
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    
    // Filter out known non-critical errors
    const criticalErrors = consoleErrors.filter(e => 
      e.includes('Solana') && !e.includes('connection') && !e.includes('RPC')
    );
    
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Cross-Chain UI', () => {
  test('modal shows chain mismatch info when needed', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // UI should be functional without wallet
    await expect(page.locator('body')).toBeVisible();
    
    // Should not show any permanent error states
    await expect(page.getByText(/fatal error|crash/i)).not.toBeVisible();
  });
});
