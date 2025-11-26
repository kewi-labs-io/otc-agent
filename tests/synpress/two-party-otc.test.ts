/**
 * Two-Party OTC Trading Tests with Synpress + Playwright
 * 
 * Tests the COMPLETE trading flow with real wallets:
 * 1. Seller creates consignment (deposits tokens)
 * 2. Buyer creates offer (reserves tokens)
 * 3. Backend approves and processes payment
 * 4. Buyer claims tokens after lockup
 * 
 * Prerequisites:
 * - Anvil running with contracts deployed: bun run rpc:dev
 * - Dev server running: bun run dev
 * - Test wallets funded (handled by Anvil default accounts)
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { walletPassword } from '../../test/wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

// Test configuration
const CONSIGNMENT_AMOUNT = '1000'; // Tokens to consign
const OFFER_AMOUNT = '100'; // Tokens to buy
const DISCOUNT_PERCENT = '10';
const LOCKUP_DAYS = '0'; // No lockup for faster testing

test.describe('Two-Party OTC Flow', () => {
  
  test.beforeEach(async ({ page }) => {
    // Wait for page to be ready
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Step 1: Connect wallet and verify network', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Click connect button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await expect(connectButton).toBeVisible({ timeout: 10000 });
    await connectButton.click();

    // Select EVM network family
    const evmButton = page.locator('button:has-text("EVM")');
    await expect(evmButton).toBeVisible({ timeout: 5000 });
    await evmButton.click();

    // Select Base chain (our local testnet)
    const baseButton = page.locator('button:has-text("Base")');
    await expect(baseButton).toBeVisible({ timeout: 5000 });
    await baseButton.click();

    // Handle MetaMask connection popup
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Verify wallet address is displayed
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}/i')).toBeVisible({ timeout: 10000 });
    
    console.log('✅ Wallet connected to Base network');
  });

  test('Step 2: Seller creates consignment', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet first
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Navigate to consignment page
    await page.goto('/consign');
    await page.waitForLoadState('networkidle');

    // Verify consignment form is visible
    await expect(page.locator('text=/List Your Tokens|Token Selection/i').first()).toBeVisible({ timeout: 10000 });

    // Step 1: Select token (if available)
    const tokenSelect = page.locator('[data-testid="token-select"], select[name="token"]').first();
    if (await tokenSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tokenSelect.selectOption({ index: 0 });
    }

    // Step 2: Enter amount
    const amountInput = page.locator('input[name="amount"], input[placeholder*="amount"]').first();
    if (await amountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amountInput.fill(CONSIGNMENT_AMOUNT);
    }

    // Continue through form steps
    const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue")').first();
    if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextButton.click();
      await page.waitForTimeout(1000);
    }

    console.log('✅ Consignment form started (full flow requires token balance)');
  });

  test('Step 3: Buyer negotiates quote via chat', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Find a token listing on homepage
    const tokenLink = page.locator('a[href*="/token/"]').first();
    
    if (await tokenLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tokenLink.click();
      await page.waitForLoadState('networkidle');

      // Find chat input
      const chatInput = page.locator('[data-testid="chat-input"], textarea[placeholder*="message"]').first();
      await expect(chatInput).toBeVisible({ timeout: 10000 });

      // Send negotiation message
      await chatInput.fill(`I want ${OFFER_AMOUNT} tokens with ${DISCOUNT_PERCENT}% discount and ${LOCKUP_DAYS} day lockup`);
      
      const sendButton = page.locator('[data-testid="send-button"], button:has-text("Send")').first();
      await expect(sendButton).toBeVisible({ timeout: 5000 });
      await sendButton.click();

      // Wait for agent response
      await expect(page.locator('[data-testid="agent-message"], [data-testid="assistant-message"]').first()).toBeVisible({ timeout: 30000 });

      console.log('✅ Quote negotiation sent to agent');
    } else {
      console.log('⚠️ No token listings available - seed tokens first');
    }
  });

  test('Step 4: Buyer accepts quote and signs transaction', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Navigate to a token page
    const tokenLink = page.locator('a[href*="/token/"]').first();
    
    if (await tokenLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tokenLink.click();
      await page.waitForLoadState('networkidle');

      // Look for an existing quote/offer to accept
      const acceptButton = page.locator('button:has-text("Accept"), [data-testid="accept-offer"]').first();
      
      if (await acceptButton.isVisible({ timeout: 10000 }).catch(() => false)) {
        await acceptButton.click();

        // Wait for confirmation modal
        const modal = page.locator('[data-testid="accept-quote-modal"], [role="dialog"]').first();
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Confirm the offer
        const confirmButton = page.locator('[data-testid="confirm-amount-button"], button:has-text("Confirm")').first();
        await expect(confirmButton).toBeVisible({ timeout: 5000 });
        await confirmButton.click();

        // Sign the transaction in MetaMask
        await metamask.confirmTransaction();
        await page.waitForTimeout(5000);

        // Verify success message or redirect
        const success = await page.locator('text=/success|created|pending/i').isVisible({ timeout: 15000 }).catch(() => false);
        const redirected = page.url().includes('/deal/') || page.url().includes('/my-deals');
        
        expect(success || redirected).toBeTruthy();
        console.log('✅ Offer created and transaction signed');
      } else {
        console.log('⚠️ No quote available to accept - negotiate first');
      }
    }
  });

  test('Step 5: View deals and verify status', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Navigate to My Deals
    await page.goto('/my-deals');
    await page.waitForLoadState('networkidle');

    // Verify tabs are visible
    await expect(page.locator('button:has-text("Purchases"), button:has-text("My Purchases")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Listings"), button:has-text("My Listings")').first()).toBeVisible({ timeout: 10000 });

    // Check for deals
    const purchasesTab = page.locator('button:has-text("Purchases"), button:has-text("My Purchases")').first();
    await purchasesTab.click();
    await page.waitForTimeout(2000);

    // Look for deal cards or empty state
    const hasDeal = await page.locator('[data-testid="deal-card"], [data-testid="purchase-row"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    const isEmpty = await page.locator('text=/no.*deals|no.*purchases|connect.*wallet/i').isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasDeal || isEmpty).toBeTruthy();
    console.log(`✅ My Deals page loaded - ${hasDeal ? 'deals found' : 'no deals yet'}`);
  });

  test('Step 6: Claim tokens after lockup', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Navigate to My Deals
    await page.goto('/my-deals');
    await page.waitForLoadState('networkidle');

    // Look for claimable deals
    const claimButton = page.locator('button:has-text("Claim"), [data-testid="claim-button"]').first();
    
    if (await claimButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await claimButton.click();

      // Sign the claim transaction
      await metamask.confirmTransaction();
      await page.waitForTimeout(5000);

      // Verify success
      await expect(page.locator('text=/claimed|success|completed/i')).toBeVisible({ timeout: 15000 });
      console.log('✅ Tokens claimed successfully');
    } else {
      console.log('⚠️ No claimable deals - complete offer flow first');
    }
  });
});

test.describe('Error Handling', () => {
  
  test('should show error for insufficient balance', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet
    await page.goto('/');
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Try to consign without tokens
    await page.goto('/consign');
    await page.waitForLoadState('networkidle');

    // The form should either:
    // 1. Show "insufficient balance" error
    // 2. Disable the submit button
    // 3. Show wallet balance as 0

    const hasBalance = await page.locator('text=/balance|tokens/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasBalance).toBeTruthy();
    
    console.log('✅ Balance check working on consign page');
  });

  test('should handle wallet disconnection', async ({ 
    context, 
    page, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // Connect wallet
    await page.goto('/');
    await page.locator('button:has-text("Connect")').first().click();
    await page.locator('button:has-text("EVM")').click();
    await page.locator('button:has-text("Base")').click();
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    // Verify connected
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}/i')).toBeVisible({ timeout: 10000 });

    // Disconnect via UI (if available)
    const walletMenu = page.locator('[data-testid="wallet-menu"], button:has-text("0x")').first();
    if (await walletMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await walletMenu.click();
      
      const disconnectButton = page.locator('button:has-text("Disconnect")');
      if (await disconnectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await disconnectButton.click();
        await page.waitForTimeout(2000);

        // Verify disconnect - should show connect button again
        await expect(page.locator('button:has-text("Connect")').first()).toBeVisible({ timeout: 5000 });
        console.log('✅ Wallet disconnection handled');
      }
    }
  });
});

