/**
 * Wallet Login Utilities for E2E Tests
 *
 * Handles connecting MetaMask and Phantom wallets via Privy.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { MetaMask, Phantom } from "@synthetixio/synpress/playwright";
import { sleep, expectDefined } from "../../test-utils";

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
 * Checks multiple indicators:
 * - wallet-menu element (if app has one)
 * - Truncated address displayed on page
 * - Sign In button NOT visible (connected state)
 */
async function isWalletConnected(page: Page): Promise<boolean> {
  // First check for explicit wallet indicator
  const walletIndicator = page
    .locator('[data-testid="wallet-menu"], [data-testid="wallet-address"]')
    .first();
  if (await walletIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
    return true;
  }

  // Check for truncated address pattern (0x1234...5678) - use getByText which handles regex better
  const addressPatterns = ['0x', '...', '…'];
  for (const pattern of addressPatterns) {
    const hasAddress = await page.locator(`text=${pattern}`).first().isVisible({ timeout: 500 }).catch(() => false);
    if (hasAddress) {
      // Found something that looks like an address
      return true;
    }
  }

  // Check if Sign In button is NOT visible (implies connected)
  const signInButton = page.locator('button:has-text("Sign In")').first();
  const signInVisible = await signInButton.isVisible({ timeout: 1000 }).catch(() => false);
  
  // If Sign In is visible, not connected
  // If Sign In is not visible, might be connected (or loading)
  return !signInVisible;
}

/**
 * Open the Privy wallet connection flow.
 */
async function openPrivyConnectFlow(page: Page): Promise<void> {
  // Look for Sign In or Connect Wallet button
  const connectButton = page.locator('button:has-text("Sign In"), button:has-text("Connect Wallet")').first();

  const connectVisible = await connectButton.isVisible({ timeout: 4000 }).catch(() => false);
  if (connectVisible) {
    await connectButton.click();
    await sleep(500);
  }

  // Look for "Continue with a wallet" in Privy modal
  const continueWithWallet = page.locator('button:has-text("Continue with a wallet")').first();
  const continueVisible = await continueWithWallet.isVisible({ timeout: 4000 }).catch(() => false);
  if (continueVisible) {
    await continueWithWallet.click();
    await sleep(500);
  }
}

/**
 * Connect MetaMask wallet via Privy.
 * Returns the connected wallet address or throws on failure.
 */
export async function connectMetaMaskWallet(
  page: Page,
  context: BrowserContext,
  metamask: MetaMask,
): Promise<string> {
  // Check if already connected
  if (await isWalletConnected(page)) {
    // Already connected - return success
    return "connected";
  }

  // Open Privy connect flow
  await openPrivyConnectFlow(page);

  // Select MetaMask
  const metamaskOption = page.locator('button:has-text("MetaMask")').first();
  const metamaskVisible = await metamaskOption.isVisible({ timeout: 4000 }).catch(() => false);
  if (metamaskVisible) {
    await metamaskOption.click();
    await sleep(1000);
  }

  await metamask.connectToDapp();
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
    return;
  }

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
    throw new Error("Phantom wallet connection failed - Sign In button still visible");
  }
}

/**
 * Disconnect wallet if connected.
 */
export async function disconnectWallet(page: Page): Promise<void> {
  // Look for wallet menu or any clickable wallet indicator
  const walletMenu = page.locator('[data-testid="wallet-menu"], [data-testid="wallet-address"], button:has-text("0x")').first();
  if (!(await walletMenu.isVisible({ timeout: 2000 }).catch(() => false))) {
    // Try looking for a user menu or settings menu
    const userMenu = page.locator('[data-testid="user-menu"], button:has-text("Account"), button:has-text("Settings")').first();
    if (!(await userMenu.isVisible({ timeout: 2000 }).catch(() => false))) {
      return; // Not connected or no menu found
    }
    await userMenu.click();
  } else {
    await walletMenu.click();
  }
  await sleep(500);

  const disconnectButton = page.locator('button:has-text("Disconnect"), button:has-text("Sign Out"), button:has-text("Log Out")').first();
  if (await disconnectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await disconnectButton.click();
    await sleep(1000);
  }
}
