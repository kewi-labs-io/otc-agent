/**
 * Wallet Login Utilities for E2E Tests
 *
 * Handles connecting MetaMask and Phantom wallets via Privy.
 */

import type { BrowserContext, Page } from "@playwright/test";
import type { MetaMask, Phantom } from "@synthetixio/synpress/playwright";
import { sleep } from "../../test-utils";

/**
 * Wait for the app to be ready (page loaded and stable).
 */
export async function waitForAppReady(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.waitForLoadState("domcontentloaded");

  // Network idle can timeout with polling; use shorter timeout and ignore failure
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
    // Expected for pages with polling
  });

  await sleep(1000);
}

/**
 * Check if wallet is already connected.
 * Returns true ONLY if we have positive evidence of connection.
 * Conservative: returns false if uncertain (lets the connection flow proceed).
 */
async function isWalletConnected(page: Page): Promise<boolean> {
  // Wait a moment for the page to stabilize
  await sleep(1000);

  // First check if Sign In button is visible - if so, definitely NOT connected
  const signInButton = page.locator('button:has-text("Sign In")').first();
  const signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
  if (signInVisible) {
    return false;
  }

  // Check for explicit wallet indicator (positive evidence)
  const walletIndicator = page
    .locator('[data-testid="wallet-menu"], [data-testid="wallet-address"]')
    .first();
  if (await walletIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log("[isWalletConnected] Found wallet indicator - already connected");
    return true;
  }

  // Check for truncated wallet address displayed (0xf39F...2266 pattern)
  // Only match button elements to avoid false positives from contract addresses in text
  const walletAddressButton = page
    .locator("button")
    .filter({ hasText: /0x[a-fA-F0-9]{4}\.\.\.?[a-fA-F0-9]{4}/ })
    .first();
  if (await walletAddressButton.isVisible({ timeout: 500 }).catch(() => false)) {
    console.log("[isWalletConnected] Found wallet address button - already connected");
    return true;
  }

  // If no positive evidence, assume not connected (let connection flow proceed)
  return false;
}

/**
 * Open the Privy wallet connection flow.
 */
async function openPrivyConnectFlow(page: Page): Promise<void> {
  // Look for Sign In or Connect Wallet button
  const connectButton = page
    .locator('button:has-text("Sign In"), button:has-text("Connect Wallet")')
    .first();

  const connectVisible = await connectButton.isVisible({ timeout: 4000 }).catch(() => false);
  if (connectVisible) {
    console.log("[openPrivyConnectFlow] Clicking Sign In button");
    await connectButton.click();
    await sleep(1000);
  }

  // Look for "Continue with a wallet" in Privy modal
  const continueWithWallet = page.locator('button:has-text("Continue with a wallet")').first();
  const continueVisible = await continueWithWallet.isVisible({ timeout: 6000 }).catch(() => false);
  if (continueVisible) {
    console.log("[openPrivyConnectFlow] Clicking Continue with a wallet");
    await continueWithWallet.click();
    await sleep(1500);
  } else {
    console.log("[openPrivyConnectFlow] Continue with a wallet button not found");
  }
}

/**
 * Connect MetaMask wallet via Privy.
 * Returns the connected wallet address or throws on failure.
 */
export async function connectMetaMaskWallet(
  page: Page,
  _context: BrowserContext,
  metamask: MetaMask,
): Promise<string> {
  // Check if already connected
  if (await isWalletConnected(page)) {
    // Already connected - return success
    return "connected";
  }

  // Open Privy connect flow
  await openPrivyConnectFlow(page);

  // Select MetaMask - look in the wallet selection modal
  // Privy shows "MetaMask" as a list item, try multiple selectors
  const metamaskSelectors = [
    'button:has-text("MetaMask")',
    'div[role="button"]:has-text("MetaMask")',
    '[data-testid*="metamask"]',
    "text=/MetaMask/i",
  ];

  let metamaskClicked = false;
  for (const selector of metamaskSelectors) {
    const option = page.locator(selector).first();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click();
      metamaskClicked = true;
      console.log(`[connectMetaMaskWallet] Clicked MetaMask using selector: ${selector}`);
      await sleep(1500);
      break;
    }
  }

  if (!metamaskClicked) {
    console.log("[connectMetaMaskWallet] MetaMask button not found, trying to proceed anyway");
  }

  // Try to connect via MetaMask - this may timeout if no popup appears
  try {
    await metamask.connectToDapp();
  } catch {
    console.log("[connectMetaMaskWallet] connectToDapp failed, MetaMask may already be connected");
  }
  await sleep(1000);

  await metamask.confirmSignature().catch(() => {
    // Signature not required - continue
  });
  await sleep(1000);

  // Dismiss "Got it" button if visible
  const gotItButton = page.locator('button:has-text("Got it")').first();
  if (await gotItButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await gotItButton.click();
    await sleep(500);
  }

  // Verify wallet is now connected by checking Sign In button is gone
  await sleep(2000);

  // Wait for Sign In button to disappear (indicates successful connection)
  const signInButton = page.locator('button:has-text("Sign In")').first();
  const stillShowingSignIn = await signInButton.isVisible({ timeout: 5000 }).catch(() => false);

  if (stillShowingSignIn) {
    throw new Error("MetaMask wallet connection failed - Sign In button still visible");
  }

  // Connection successful
  return "connected";
}

/**
 * Connect Phantom wallet via Privy.
 * Throws on failure.
 */
export async function connectPhantomWallet(
  page: Page,
  context: BrowserContext,
  phantom: Phantom,
): Promise<void> {
  // Check if already connected
  if (await isWalletConnected(page)) {
    console.log("[connectPhantomWallet] Wallet already connected, skipping");
    return;
  }

  console.log("[connectPhantomWallet] Starting Phantom connection...");

  // Open Privy connect flow
  await openPrivyConnectFlow(page);

  // Select Phantom
  const phantomOption = page.locator('button:has-text("Phantom")').first();
  const phantomVisible = await phantomOption.isVisible({ timeout: 4000 }).catch(() => false);
  if (phantomVisible) {
    await phantomOption.click();
    await sleep(1000);
  }

  // Handle network selection if it appears
  const selectNetworkTitle = page.locator("text=Select network");
  if (await selectNetworkTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
    const phantomOptions = await page
      .locator('button:has-text("Phantom"), div[role="button"]:has-text("Phantom")')
      .all();
    if (phantomOptions.length >= 2) {
      await phantomOptions[1].click();
      await sleep(500);
    }
  }

  await phantom.connectToDapp();
  await sleep(1000);

  await phantom.confirmSignature().catch(() => {
    // Signature not required - continue
  });
  await sleep(1000);

  // Dismiss any promotional popups in Phantom extension windows
  // (e.g., "Monad Mainnet is live", "Earn 8% APY", etc.)
  const allPages = context.pages();
  for (const p of allPages) {
    // Try "Got it" button first (exact match to avoid false positives)
    const gotItBtn = p
      .locator("button")
      .filter({ hasText: /^Got it$/i })
      .first();
    if (await gotItBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await gotItBtn.click();
      await sleep(500);
    }

    // Try "Not now" or "Skip" buttons (exact match)
    const dismissBtn = p
      .locator("button")
      .filter({ hasText: /^(Not now|No thanks|Skip|Close|Dismiss)$/i })
      .first();
    if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await dismissBtn.click();
      await sleep(500);
    }
  }

  // Dismiss "Got it" button if visible on main page
  const gotItButton = page.locator('button:has-text("Got it")').first();
  if (await gotItButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await gotItButton.click();
    await sleep(500);
  }

  // Verify wallet is now connected by checking Sign In button is gone
  await sleep(2000);

  // Wait for Sign In button to disappear (indicates successful connection)
  const signInButton = page.locator('button:has-text("Sign In")').first();
  const stillShowingSignIn = await signInButton.isVisible({ timeout: 5000 }).catch(() => false);

  if (stillShowingSignIn) {
    throw new Error("Phantom wallet connection failed - Sign In button still visible");
  }
}

/**
 * Disconnect wallet if connected.
 */
export async function disconnectWallet(page: Page): Promise<void> {
  // Look for wallet menu or any clickable wallet indicator
  const walletMenu = page
    .locator('[data-testid="wallet-menu"], [data-testid="wallet-address"], button:has-text("0x")')
    .first();
  if (!(await walletMenu.isVisible({ timeout: 2000 }).catch(() => false))) {
    // Try looking for a user menu or settings menu
    const userMenu = page
      .locator('[data-testid="user-menu"], button:has-text("Account"), button:has-text("Settings")')
      .first();
    if (!(await userMenu.isVisible({ timeout: 2000 }).catch(() => false))) {
      return; // Not connected or no menu found
    }
    await userMenu.click();
  } else {
    await walletMenu.click();
  }
  await sleep(500);

  const disconnectButton = page
    .locator(
      'button:has-text("Disconnect"), button:has-text("Sign Out"), button:has-text("Log Out")',
    )
    .first();
  if (await disconnectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await disconnectButton.click();
    await sleep(1000);
  }
}
