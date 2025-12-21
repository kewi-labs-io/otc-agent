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
 * Check if wallet is already connected by looking for wallet indicator.
 */
async function isWalletConnected(page: Page): Promise<boolean> {
  const walletIndicator = page
    .locator('[data-testid="wallet-menu"], text=/0x[a-fA-F0-9]{4}\\.+[a-fA-F0-9]{4}/i')
    .first();

  return walletIndicator.isVisible({ timeout: 1500 }).catch(() => false);
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
    const walletIndicator = page
      .locator('[data-testid="wallet-menu"], text=/0x[a-fA-F0-9]{4}\\.+[a-fA-F0-9]{4}/i')
      .first();
    const text = await walletIndicator.textContent();
    return expectDefined(text, "wallet indicator text");
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

  // Verify wallet is now connected
  const walletIndicator = page
    .locator('[data-testid="wallet-menu"], text=/0x[a-fA-F0-9]{4}\\.+[a-fA-F0-9]{4}/i')
    .first();

  const connected = await walletIndicator.isVisible({ timeout: 10000 }).catch(() => false);
  if (!connected) {
    throw new Error("MetaMask wallet connection failed - wallet indicator not visible");
  }

  const text = await walletIndicator.textContent();
  return expectDefined(text, "wallet indicator text");
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

  // Verify wallet is now connected
  const walletIndicator = page
    .locator('[data-testid="wallet-menu"], text=/[a-zA-Z0-9]{4}\\.+[a-zA-Z0-9]{4}/i')
    .first();

  const connected = await walletIndicator.isVisible({ timeout: 10000 }).catch(() => false);
  if (!connected) {
    throw new Error("Phantom wallet connection failed - wallet indicator not visible");
  }
}

/**
 * Disconnect wallet if connected.
 */
export async function disconnectWallet(page: Page): Promise<void> {
  const walletMenu = page.getByTestId("wallet-menu");
  if (!(await walletMenu.isVisible({ timeout: 2000 }).catch(() => false))) {
    return; // Not connected
  }

  await walletMenu.click();
  await sleep(500);

  const disconnectButton = page.locator('button:has-text("Disconnect"), button:has-text("Sign Out")').first();
  if (await disconnectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await disconnectButton.click();
    await sleep(1000);
  }
}
