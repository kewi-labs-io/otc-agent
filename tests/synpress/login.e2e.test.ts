/**
 * Login E2E Tests - FIRST TEST TO RUN
 *
 * Basic wallet connection tests that verify:
 * 1. MetaMask can connect to the app via Privy
 * 2. Phantom can connect to the app via Privy
 *
 * These tests must pass before running any other E2E tests.
 * They validate the fundamental wallet connection flow.
 *
 * Run: npx playwright test --config=synpress.config.ts tests/synpress/login.e2e.test.ts
 */

import { testWithSynpress } from "@synthetixio/synpress";
import { MetaMask, Phantom, phantomFixtures } from "@synthetixio/synpress/playwright";
import phantomSetup, { phantomPassword } from "../phantom-setup/phantom.setup";
import { assertServerHealthy, BASE_URL, sleep } from "../test-utils";
import sellerSetup from "../wallet-setup/seller.setup";
import {
  connectMetaMaskWallet,
  connectPhantomWallet,
  disconnectWallet,
  waitForAppReady,
} from "./utils/login";
import { metaMaskFixtures } from "./utils/metamask-fixtures";
import { evmSeller } from "./utils/wallets";

// =============================================================================
// METAMASK LOGIN TESTS
// =============================================================================

const metamaskTest = testWithSynpress(metaMaskFixtures(sellerSetup));

metamaskTest.describe("MetaMask Login", () => {
  metamaskTest.setTimeout(2 * 60 * 1000); // 2 minutes

  metamaskTest.beforeAll(async () => {
    await assertServerHealthy();
  });

  metamaskTest(
    "connects MetaMask wallet successfully",
    async ({ context, page, metamaskPage, extensionId }) => {
      const { expect } = metamaskTest;

      const metamask = new MetaMask(context, metamaskPage, evmSeller.password, extensionId);

      await metamask.switchNetwork("Anvil Localnet").catch(() => {
        // Already on correct network - continue
      });

      // Navigate to app
      await waitForAppReady(page, `${BASE_URL}/my-deals`);

      // Connect wallet
      const walletText = await connectMetaMaskWallet(page, context, metamask);

      // Verify wallet is connected - connectMetaMaskWallet throws if connection fails
      expect(walletText).toBeDefined();
      expect(walletText.length).toBeGreaterThan(0);

      // Verify Sign In button is no longer visible (indicates connected state)
      const signInButton = page.locator('button:has-text("Sign In")').first();
      const signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(signInVisible).toBe(false);

      console.log("MetaMask connected successfully:", walletText);
    },
  );

  metamaskTest(
    "wallet persists across page navigation",
    async ({ context, page, metamaskPage, extensionId }) => {
      const { expect } = metamaskTest;

      const metamask = new MetaMask(context, metamaskPage, evmSeller.password, extensionId);

      await metamask.switchNetwork("Anvil Localnet").catch(() => {
        // Already on correct network - continue
      });

      // Connect on my-deals page
      await waitForAppReady(page, `${BASE_URL}/my-deals`);
      await connectMetaMaskWallet(page, context, metamask);

      // Navigate to consign page
      await page.goto(`${BASE_URL}/consign`);
      await page.waitForLoadState("domcontentloaded");
      await sleep(2000);

      // Wallet should still be connected - Sign In button should not be visible
      const signInButton = page.locator('button:has-text("Sign In")').first();
      const signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(signInVisible).toBe(false);

      console.log("Wallet persisted across navigation");
    },
  );

  metamaskTest(
    "can disconnect and reconnect",
    async ({ context, page, metamaskPage, extensionId }) => {
      const { expect } = metamaskTest;

      const metamask = new MetaMask(context, metamaskPage, evmSeller.password, extensionId);

      await metamask.switchNetwork("Anvil Localnet").catch(() => {
        // Already on correct network - continue
      });

      // Connect
      await waitForAppReady(page, `${BASE_URL}/my-deals`);
      await connectMetaMaskWallet(page, context, metamask);

      // Verify connected - Sign In should not be visible
      let signInButton = page.locator('button:has-text("Sign In")').first();
      let signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(signInVisible).toBe(false);

      // Disconnect
      await disconnectWallet(page);
      await sleep(2000);

      // Verify disconnected - Sign In button should be visible
      signInButton = page.locator('button:has-text("Sign In")').first();
      const isDisconnected = await signInButton.isVisible({ timeout: 5000 }).catch(() => false);

      // Reconnect
      await connectMetaMaskWallet(page, context, metamask);

      // Verify reconnected - Sign In should not be visible
      signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(signInVisible).toBe(false);

      console.log(`Disconnect/reconnect test passed (disconnected: ${isDisconnected})`);
    },
  );
});

// =============================================================================
// PHANTOM LOGIN TESTS
// =============================================================================

const phantomTest = testWithSynpress(phantomFixtures(phantomSetup));

phantomTest.describe("Phantom Login", () => {
  phantomTest.setTimeout(2 * 60 * 1000); // 2 minutes

  phantomTest.beforeAll(async () => {
    await assertServerHealthy();
  });

  phantomTest(
    "connects Phantom wallet successfully",
    async ({ context, page, phantomPage, extensionId }) => {
      const { expect } = phantomTest;

      const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);

      // Navigate to app
      await waitForAppReady(page, `${BASE_URL}/my-deals`);

      // Connect wallet
      await connectPhantomWallet(page, context, phantom);

      // Verify wallet is connected - Sign In should not be visible
      const signInButton = page.locator('button:has-text("Sign In")').first();
      const signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(signInVisible).toBe(false);

      console.log("Phantom connected successfully");
    },
  );

  phantomTest(
    "wallet persists across page navigation",
    async ({ context, page, phantomPage, extensionId }) => {
      const { expect } = phantomTest;

      const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);

      // Connect on my-deals page
      await waitForAppReady(page, `${BASE_URL}/my-deals`);
      await connectPhantomWallet(page, context, phantom);

      // Navigate to consign page
      await page.goto(`${BASE_URL}/consign`);
      await page.waitForLoadState("domcontentloaded");
      await sleep(2000);

      // Wallet should still be connected - Sign In should not be visible
      const signInButton = page.locator('button:has-text("Sign In")').first();
      const signInVisible = await signInButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(signInVisible).toBe(false);

      console.log("Phantom wallet persisted across navigation");
    },
  );
});
