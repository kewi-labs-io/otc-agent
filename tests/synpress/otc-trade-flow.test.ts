/**
 * Synpress tests for TheDesk OTC trading flows
 * Tests wallet connection and order creation with REAL MetaMask interactions
 * 
 * NOTE: These tests FAIL when the expected UI elements don't exist.
 * No silent passes - if something's wrong, you'll know.
 * 
 * Prerequisites:
 * - Dev server running: bun run dev
 * - Anvil running: bun run rpc:dev
 * 
 * Run with: npx playwright test --config=synpress.config.ts tests/synpress/otc-trade-flow.test.ts
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { walletPassword } from '../../test/wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

// Helper to connect wallet - reused across tests
async function connectWallet(
  page: ReturnType<typeof test.info>['page'] extends infer P ? P : never,
  metamask: MetaMask
) {
  // Check if already connected (wallet address visible)
  const alreadyConnected = await page.locator('text=/0x[a-fA-F0-9]{4}/i').isVisible({ timeout: 2000 }).catch(() => false);
  if (alreadyConnected) {
    console.log('Wallet already connected, skipping connection flow');
    return;
  }

  // Click connect button
  const connectButton = page.locator('button:has-text("Connect")').first();
  await expect(connectButton).toBeVisible({ timeout: 10000 });
  await connectButton.click();
  await page.waitForTimeout(1000);

  // Select EVM network
  const evmButton = page.locator('button:has-text("EVM")');
  if (await evmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await evmButton.click();
    await page.waitForTimeout(1000);
  }
  
  // Select Base chain
  const baseButton = page.locator('button:has-text("Base")');
  if (await baseButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await baseButton.click();
    await page.waitForTimeout(1000);
  }

  // Handle MetaMask connection popup
  try {
    await metamask.connectToDapp();
  } catch {
    // Connection might already be approved
    console.log('MetaMask connection may already be approved');
  }
  
  await page.waitForTimeout(2000);
}

test.describe('TheDesk OTC Trading - Real Wallet Tests', () => {
  
  test('should connect wallet and verify address displayed', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await connectWallet(page, metamask);

    // MUST show connected wallet address
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}/i')).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to consign page and show token form', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    await connectWallet(page, metamask);

    // Navigate to consign page
    await page.goto('/consign');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    // MUST show token listing form
    await expect(page.locator('text=/List Your Tokens|Token Selection/i').first()).toBeVisible({ timeout: 15000 });
  });

  test('should show my-deals page with purchase/listings tabs', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    await connectWallet(page, metamask);

    // Navigate to my-deals
    await page.goto('/my-deals');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    // MUST show tabs
    await expect(page.locator('button:has-text("Purchases"), button:has-text("My Purchases")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button:has-text("Listings"), button:has-text("My Listings")').first()).toBeVisible({ timeout: 15000 });
  });

  test.skip('full order flow: create offer → approve → claim', async ({ context, page, metamaskPage, extensionId }) => {
    /**
     * SKIPPED: This test requires:
     * 1. Deployed contracts with test tokens
     * 2. Backend running with agent
     * 3. Pre-funded test wallet
     * 
     * Enable when running full integration tests with:
     *   bun run dev:full && bun run test:synpress
     */
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    await connectWallet(page, metamask);

    // Find a token listing
    const tokenLink = page.locator('a[href*="/token/"]').first();
    await expect(tokenLink).toBeVisible({ timeout: 10000 });
    await tokenLink.click();
    await page.waitForLoadState('domcontentloaded');
    
    // Chat with agent to get quote
    const chatInput = page.locator('[data-testid="chat-input"], textarea[placeholder*="message"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill('I want 1000 tokens with 10% discount');
    
    const sendButton = page.locator('[data-testid="send-button"], button:has-text("Send")').first();
    await expect(sendButton).toBeVisible({ timeout: 5000 });
    await sendButton.click();
    
    // Wait for agent response with quote
    await expect(page.locator('[data-testid="agent-message"]')).toBeVisible({ timeout: 30000 });
    
    // Accept the quote - MUST find accept button
    const acceptButton = page.locator('button:has-text("Accept"), [data-testid="accept-offer"]').first();
    await expect(acceptButton).toBeVisible({ timeout: 15000 });
    await acceptButton.click();
    
    // Confirm in modal
    const confirmButton = page.locator('[data-testid="confirm-amount-button"], button:has-text("Confirm")').first();
    await expect(confirmButton).toBeVisible({ timeout: 5000 });
    await confirmButton.click();
    
    // Sign transaction in MetaMask
    await metamask.confirmTransaction();
    await page.waitForTimeout(5000);
    
    // Verify success
    await expect(page.locator('text=/success|complete|created/i')).toBeVisible({ timeout: 15000 });
  });
});
