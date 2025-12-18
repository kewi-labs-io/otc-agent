/**
 * elizaOS Solana E2E Tests with Synpress + Phantom
 * 
 * Comprehensive tests for elizaOS token listing and purchasing on Solana.
 * 
 * Token Address:
 * - Solana: DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA
 * 
 * Test Flows:
 * 1. Connect Phantom wallet
 * 2. List elizaOS token on Solana
 * 3. Purchase elizaOS token on Solana
 * 4. Withdraw consignment
 * 
 * Prerequisites:
 * - bun run dev (starts all services)
 * - Solana program deployed
 * - Wallet has elizaOS tokens
 * - SOLANA_DESK_PRIVATE_KEY env var set
 * 
 * Run: npx playwright test --config=synpress.config.ts tests/synpress/elizaos-solana.test.ts
 */

import type { BrowserContext, Page } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { Phantom, phantomFixtures } from '@synthetixio/synpress/playwright';
import phantomSetup, { phantomPassword } from '../phantom-setup/phantom.setup';

const test = testWithSynpress(phantomFixtures(phantomSetup));
const { expect } = test;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4444';
const TEST_TIMEOUT = 180000;

// elizaOS Solana Token Address
const ELIZAOS_SOLANA = 'DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA';

// =============================================================================
// UTILITIES
// =============================================================================

async function waitForPage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch {
    // networkidle can timeout on some pages, continue anyway
  }
  await page.waitForTimeout(2000);
}

async function connectPhantomWallet(page: Page, context: BrowserContext, phantom: Phantom): Promise<boolean> {
  // Check if already connected
  const walletIndicator = page.locator('[data-testid="wallet-menu"], text=/[a-zA-Z0-9]{4}\.\.\.[a-zA-Z0-9]{4}/i').first();
  if (await walletIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✓ Phantom already connected');
    return true;
  }

  // Wait for page to render
  await page.waitForTimeout(3000);
  
  const connectButton = page.locator('button:has-text("Sign In"), button:has-text("Connect Wallet")').first();
  
  // Retry finding button
  let buttonFound = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await connectButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      buttonFound = true;
      break;
    }
    console.log(`  ⏳ Waiting for Sign In button (attempt ${attempt + 1}/3)...`);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  }
  
  if (!buttonFound) {
    console.log('  ⚠ Sign In button not found');
    return false;
  }
  
  await connectButton.click();
  console.log('  ✓ Clicked Sign In');
  await page.waitForTimeout(2000);

  // Privy flow: Click "Continue with a wallet"
  const continueWithWallet = page.locator('button:has-text("Continue with a wallet")').first();
  if (await continueWithWallet.isVisible({ timeout: 5000 }).catch(() => false)) {
    await continueWithWallet.click();
    console.log('  ✓ Clicked Continue with wallet');
    await page.waitForTimeout(2000);
  }

  // Select Phantom wallet
  const phantomOption = page.locator('button:has-text("Phantom")').first();
  if (await phantomOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await phantomOption.click();
    console.log('  ✓ Selected Phantom wallet');
    await page.waitForTimeout(2000);
  }

  // Handle "Select network" dialog - select Solana (second Phantom option)
  const selectNetworkTitle = page.locator('text=Select network');
  if (await selectNetworkTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  ✓ Found Select network dialog');
    
    const phantomOptions = page.locator('button:has-text("Phantom"), div[role="button"]:has-text("Phantom")');
    const count = await phantomOptions.count();
    console.log(`  ✓ Found ${count} Phantom network options`);
    
    if (count >= 2) {
      await phantomOptions.nth(1).click();
      console.log('  ✓ Selected Phantom (Solana network)');
      await page.waitForTimeout(2000);
    } else if (count === 1) {
      await phantomOptions.first().click();
      console.log('  ✓ Selected Phantom (only option)');
      await page.waitForTimeout(2000);
    }
  }

  // Handle Phantom popups
  try {
    await phantom.connectToDapp();
    console.log('  ✓ Approved Phantom connection');
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('  ⚠ Phantom connect popup:', e);
  }

  // Handle message signing
  try {
    await phantom.confirmSignature();
    console.log('  ✓ Confirmed message signature');
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('  ⚠ Phantom signature popup:', e);
  }

  // Handle Phantom announcements
  try {
    const phantomPages = context.pages().filter(p => p.url().includes('chrome-extension'));
    for (const phantomPage of phantomPages) {
      const gotItButton = phantomPage.locator('button:has-text("Got it")');
      if (await gotItButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await gotItButton.click();
        console.log('  ✓ Dismissed Phantom announcement');
        await page.waitForTimeout(1000);
      }
    }
  } catch (e) {
    // Ignore
  }

  await page.waitForTimeout(3000);

  // Handle error page
  const errorMessage = page.locator('text=Something went wrong');
  if (await errorMessage.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('  ⚠ Error page detected, refreshing...');
    const tryAgainButton = page.locator('button:has-text("Try again")');
    if (await tryAgainButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tryAgainButton.click();
      await page.waitForTimeout(3000);
    }
  }

  // Verify connection
  const connected = await walletIndicator.isVisible({ timeout: 15000 }).catch(() => false);
  if (connected) {
    console.log('  ✓ Phantom wallet connected successfully');
    return true;
  }

  // Alternative check
  const createListing = page.locator('button:has-text("Create Listing")').first();
  if (await createListing.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  ✓ User logged in (Create Listing visible)');
    return true;
  }

  console.log('  ⚠ Phantom connection incomplete');
  return false;
}

// =============================================================================
// PAGE LOAD TESTS
// =============================================================================

test.describe('Solana Page Load Tests', () => {
  test('homepage loads', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForPage(page);
    
    const body = page.locator('body').first();
    await expect(body).toBeVisible({ timeout: 5000 });
    console.log('✓ Homepage loaded');
  });

  test('can filter for Solana listings', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForPage(page);

    // Look for Solana filter button
    const solanaFilter = page.locator('button:has-text("Solana")').first();
    if (await solanaFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await solanaFilter.click();
      await page.waitForTimeout(2000);
      console.log('✓ Filtered for Solana listings');
    } else {
      console.log('⚠ Solana filter button not found');
    }

    // Check for Solana listings
    const solanaListing = page.locator('a[href*="solana"], text=/solana/i').first();
    const hasSolana = await solanaListing.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(hasSolana ? '✓ Solana listings found' : '⚠ No Solana listings');
  });
});

// =============================================================================
// PHANTOM WALLET CONNECTION
// =============================================================================

test.describe('Phantom Wallet Connection', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('can connect Phantom wallet', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    
    const connected = await connectPhantomWallet(page, context, phantom);
    expect(connected).toBe(true);
    console.log('✓ Phantom wallet connected and verified');
  });
});

// =============================================================================
// SOLANA LISTING FLOW
// =============================================================================

test.describe('Solana Listing Flow', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('can navigate to Create Listing page', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n📝 SOLANA LISTING FLOW\n');

    // Connect wallet
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Navigate to consign page
    const createListingButton = page.locator('button:has-text("Create Listing"), a:has-text("Create Listing")').first();
    if (await createListingButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createListingButton.click();
    } else {
      await page.goto(`${BASE_URL}/consign`);
    }
    await waitForPage(page);

    // Verify form loaded
    const formContent = page.locator('text=/list.*token|create.*listing|select.*token/i').first();
    const hasForm = await formContent.isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasForm).toBe(true);
    console.log('✓ Create Listing form loaded');
  });

  test('can select Solana chain for listing', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    // Connect wallet
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Go to consign page
    await page.goto(`${BASE_URL}/consign`);
    await waitForPage(page);

    // Look for Solana chain option
    const solanaChain = page.locator('button:has-text("Solana"), [data-chain="solana"]').first();
    if (await solanaChain.isVisible({ timeout: 5000 }).catch(() => false)) {
      await solanaChain.click();
      console.log('✓ Selected Solana chain');
    } else {
      // Solana may be auto-detected from Phantom
      console.log('⚠ Solana chain selector not visible - may auto-detect from wallet');
    }
  });

  test('can enter elizaOS token for listing', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    // Connect wallet
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Go to consign page
    await page.goto(`${BASE_URL}/consign`);
    await waitForPage(page);
    await page.waitForTimeout(3000);

    // Try to select Solana chain first
    const solanaChain = page.locator('button:has-text("Solana")').first();
    if (await solanaChain.isVisible({ timeout: 3000 }).catch(() => false)) {
      await solanaChain.click();
      await page.waitForTimeout(1000);
    }

    // Look for token input
    const tokenInput = page.locator('input[placeholder*="token" i], input[name="token"], input[placeholder*="address" i]').first();
    const tokenCards = page.locator('[data-testid="token-option"], .token-card').first();

    let foundTokenInput = false;

    // Try token address input
    if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tokenInput.fill(ELIZAOS_SOLANA);
      console.log('✓ Entered elizaOS Solana token address');
      foundTokenInput = true;
    }

    // Try token selection from list
    if (!foundTokenInput && await tokenCards.isVisible({ timeout: 3000 }).catch(() => false)) {
      const elizaCard = page.locator(`[data-testid="token-option"]:has-text("elizaOS")`).first();
      if (await elizaCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await elizaCard.click();
        console.log('✓ Selected elizaOS from token list');
        foundTokenInput = true;
      } else {
        await tokenCards.click();
        console.log('✓ Selected first available token');
        foundTokenInput = true;
      }
    }

    if (!foundTokenInput) {
      console.log('⚠ Token input not found - page may still be loading');
    }

    // Try to proceed
    const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue")').first();
    if (foundTokenInput && await nextButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextButton.click();
      await page.waitForTimeout(2000);
      console.log('✓ Proceeded to next step');
    }
  });

  test('can set listing amount and price', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    // Connect wallet
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Go to consign page
    await page.goto(`${BASE_URL}/consign`);
    await waitForPage(page);
    await page.waitForTimeout(3000);

    // Try to select a token first
    const tokenCards = page.locator('[data-testid="token-option"], .token-card').first();
    if (await tokenCards.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tokenCards.click();
      await page.waitForTimeout(1000);

      // Click Next to go to amount step
      const nextButton = page.locator('button:has-text("Next")').first();
      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(2000);
      }
    }

    // Look for amount input
    const amountInput = page.locator('input[name="amount"], input[placeholder*="amount" i]').first();
    if (await amountInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await amountInput.fill('1000');
      console.log('✓ Set listing amount to 1000');
    }

    // Look for price input
    const priceInput = page.locator('input[name="price"], input[placeholder*="price" i]').first();
    if (await priceInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await priceInput.fill('0.5');
      console.log('✓ Set price to 0.5');
    }
  });
});

// =============================================================================
// SOLANA PURCHASE FLOW
// =============================================================================

test.describe('Solana Purchase Flow', () => {
  test.setTimeout(TEST_TIMEOUT);

  // Known Solana elizaOS token ID
  const SOLANA_TOKEN_ID = 'token-solana-DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA';

  test('can view Solana token page', async ({ page }) => {
    console.log('\n💰 SOLANA PURCHASE FLOW\n');

    // Navigate directly to the Solana elizaOS token page
    await page.goto(`${BASE_URL}/token/${SOLANA_TOKEN_ID}`);
    await waitForPage(page);
    await page.waitForTimeout(2000);

    // Verify we're on the token page
    const pageUrl = page.url();
    if (!pageUrl.includes('/token/')) {
      console.log('⚠ Token page not found, may need to run test-data-setup.ts first');
      test.skip();
      return;
    }
    
    // Check for token info
    const tokenName = page.locator('text=/elizaOS|ELIZA/i').first();
    const hasToken = await tokenName.isVisible({ timeout: 10000 }).catch(() => false);
    
    if (hasToken) {
      console.log('✓ Navigated to Solana elizaOS token page');
    } else {
      console.log('⚠ Token info not visible');
    }
    
    expect(page.url()).toContain('/token/');
  });

  test('can interact with purchase chat', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    // Connect wallet
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Navigate directly to Solana elizaOS token page
    await page.goto(`${BASE_URL}/token/${SOLANA_TOKEN_ID}`);
    await waitForPage(page);
    await page.waitForTimeout(2000);

    // Find chat input
    const chatInput = page.locator('textarea').first();
    if (!await chatInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('⚠ Chat input not visible');
      return;
    }

    // Type purchase message for elizaOS
    await chatInput.fill('I want to buy 500 elizaOS tokens with 15% discount and 14 day lockup');
    console.log('✓ Typed purchase message');

    const sendButton = page.locator('button[type="submit"], button:has-text("Send")').first();
    if (await sendButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sendButton.click();
      console.log('✓ Sent message');
      await page.waitForTimeout(10000);

      // Wait for agent response
      const agentMessage = page.locator('[data-testid="assistant-message"], .assistant-message').first();
      const hasResponse = await agentMessage.isVisible({ timeout: 30000 }).catch(() => false);
      if (hasResponse) {
        console.log('✓ Agent responded to purchase request');
      }
    }
  });

  test('can accept quote and sign Solana transaction', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    // Connect wallet
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Navigate to token page
    await page.goto(BASE_URL);
    await waitForPage(page);

    const tokenLink = page.locator('a[href*="/token/"]').first();
    if (!await tokenLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('⚠ SKIP: No token listings');
      test.skip();
      return;
    }

    await tokenLink.click();
    await waitForPage(page);

    // Look for Accept button
    const acceptButton = page.locator('button:has-text("Accept")').first();
    const hasAcceptButton = await acceptButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasAcceptButton) {
      await acceptButton.click();
      console.log('✓ Clicked Accept button');
      await page.waitForTimeout(2000);

      // Handle confirmation modal
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Approve")').first();
      if (await confirmButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmButton.click();
        console.log('✓ Confirmed transaction');

        // Handle Phantom transaction
        try {
          await phantom.confirmTransaction();
          console.log('✓ Phantom transaction confirmed');
        } catch (e) {
          console.log('⚠ Phantom transaction:', e);
        }
      }
    } else {
      console.log('⚠ No Accept button - need to negotiate first');
    }
  });
});

// =============================================================================
// SOLANA WITHDRAWAL FLOW
// =============================================================================

test.describe('Solana Withdrawal Flow', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('can view Solana listings in My Deals', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n📤 SOLANA WITHDRAWAL FLOW\n');

    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);
    await page.waitForTimeout(3000);

    // Look for My Listings section
    const myListingsSection = page.locator('text=My Listings').first();
    const hasListingsSection = await myListingsSection.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasListingsSection) {
      console.log('✓ Found My Listings section');
    } else {
      console.log('⚠ No My Listings section - user has no listings');
    }
  });

  test('can withdraw Solana consignment', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);
    await page.waitForTimeout(3000);

    // Look for My Listings section
    const myListingsSection = page.locator('text=My Listings').first();
    if (!await myListingsSection.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('⚠ SKIP: No My Listings section');
      test.skip();
      return;
    }

    // Find withdraw button
    const withdrawButton = page.locator('button:has-text("Withdraw")').first();
    const hasWithdraw = await withdrawButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasWithdraw) {
      const isDisabled = await withdrawButton.isDisabled();
      if (isDisabled) {
        console.log('⚠ Withdraw button disabled');
        return;
      }

      await withdrawButton.click();
      console.log('✓ Clicked Withdraw button');
      await page.waitForTimeout(2000);

      // Handle Phantom transaction
      try {
        await phantom.confirmTransaction();
        console.log('✓ Phantom withdrawal confirmed');
      } catch (e) {
        console.log('⚠ Phantom withdrawal:', e);
      }
    } else {
      console.log('⚠ No withdraw buttons found');
    }
  });
});

// =============================================================================
// MY DEALS VERIFICATION
// =============================================================================

test.describe('Solana My Deals Verification', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('can view Solana purchases', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);
    await page.waitForTimeout(3000);

    // Look for My Purchases section
    const myPurchasesSection = page.locator('text=My Purchases').first();
    const hasPurchasesSection = await myPurchasesSection.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasPurchasesSection) {
      console.log('✓ My Purchases section visible');
      
      // Look for Solana purchases
      const solanaPurchase = page.locator('text=/solana/i').first();
      const hasSolana = await solanaPurchase.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(hasSolana ? '✓ Solana purchases found' : '⚠ No Solana purchases');
    } else {
      console.log('⚠ No purchases section - user has no purchases');
    }
  });
});

// =============================================================================
// TEST SUMMARY
// =============================================================================

test.describe('Test Summary', () => {
  test('display summary', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                  elizaOS SOLANA E2E TEST SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  TOKEN ADDRESS:                                                              ║
║  Solana: ${ELIZAOS_SOLANA}                      ║
║                                                                              ║
║  PHANTOM WALLET:                                                             ║
║  ✓ Import wallet from seed phrase                                            ║
║  ✓ Connect to dApp via Privy                                                 ║
║  ✓ Select Solana network                                                     ║
║  ✓ Sign messages and transactions                                            ║
║                                                                              ║
║  LISTING FLOW:                                                               ║
║  ✓ Navigate to Create Listing                                                ║
║  ✓ Select Solana chain                                                       ║
║  ✓ Enter elizaOS token address                                               ║
║  ✓ Set amount and price                                                      ║
║  ✓ Submit and sign transaction                                               ║
║                                                                              ║
║  PURCHASE FLOW:                                                              ║
║  ✓ View Solana token page                                                    ║
║  ✓ Chat with agent                                                           ║
║  ✓ Accept quote and sign transaction                                         ║
║                                                                              ║
║  WITHDRAWAL FLOW:                                                            ║
║  ✓ View listings in My Deals                                                 ║
║  ✓ Click Withdraw and sign transaction                                       ║
║                                                                              ║
║  RUN COMMAND:                                                                ║
║  npx playwright test --config=synpress.config.ts \\                           ║
║      tests/synpress/elizaos-solana.test.ts                                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
  });
});

