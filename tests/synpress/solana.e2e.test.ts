/**
 * Solana E2E Tests - Additional Solana-specific scenarios
 *
 * This file contains additional Solana test scenarios beyond the full-flow test.
 * For the complete lifecycle test, see full-flow.e2e.test.ts
 *
 * Scenarios:
 * - Solana deployment verification
 * - Withdrawal from existing consignment
 *
 * Run: npx playwright test --config=synpress.config.ts tests/synpress/solana.e2e.test.ts
 */

import { testWithSynpress } from "@synthetixio/synpress";
import { Phantom, phantomFixtures } from "@synthetixio/synpress/playwright";

import phantomSetup, { phantomPassword } from "../phantom-setup/phantom.setup";
import { assertServerHealthy, BASE_URL, log, sleep } from "../test-utils";
import { connectPhantomWallet, waitForAppReady } from "./utils/login";
import {
  getSolanaDesk,
  getSolanaTokenBalance,
  getSolBalance,
  loadSolanaDeployment,
  solanaConnection,
} from "./utils/onchain";
import { confirmPhantomTransaction } from "./utils/wallet-confirm";
import { phantomTrader } from "./utils/wallets";

const test = testWithSynpress(phantomFixtures(phantomSetup));
const { expect } = test;

const TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// SOLANA ADDITIONAL TEST SCENARIOS
// =============================================================================

test.describe("Solana Additional Scenarios", () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test.beforeAll(async () => {
    await assertServerHealthy();
  });

  test("verifies Solana deployment and desk state", async ({
    _context,
    _page,
    _phantomPage,
    _extensionId,
  }) => {
    log("Solana-Verify", "Verifying Solana deployment...");

    // Load Solana deployment - required for Solana tests
    const deployment = loadSolanaDeployment();

    const connection = solanaConnection();

    const version = await connection.getVersion();
    log("Solana-Verify", `Validator version: ${version["solana-core"]}`);

    // Verify program is deployed
    const programInfo = await connection.getAccountInfo(
      new (await import("@solana/web3.js")).PublicKey(deployment.programId),
    );
    if (!programInfo) {
      log("Solana-Verify", "Program not deployed - skipping");
      test.skip();
      return;
    }
    expect(programInfo.executable).toBe(true);
    log("Solana-Verify", `Program deployed at ${deployment.programId}`);

    // Verify desk is initialized
    const desk = await getSolanaDesk(deployment.desk);
    expect(desk).toBeDefined();
    expect(desk.owner).toBeDefined();
    expect(desk.agent).toBeDefined();
    expect(typeof desk.nextConsignmentId).toBe("bigint");
    expect(typeof desk.nextOfferId).toBe("bigint");

    log("Solana-Verify", `Desk: ${deployment.desk}`);
    log("Solana-Verify", `  Owner: ${desk.owner}`);
    log("Solana-Verify", `  Agent: ${desk.agent}`);
    log("Solana-Verify", `  Next Consignment ID: ${desk.nextConsignmentId}`);
    log("Solana-Verify", `  Next Offer ID: ${desk.nextOfferId}`);
    log("Solana-Verify", `  Paused: ${desk.paused}`);

    // Verify wallet balance
    const solBalance = await getSolBalance(phantomTrader.address);
    log("Solana-Verify", `Wallet SOL balance: ${solBalance}`);

    // Use dynamic test token from deployment (created during Solana setup)
    const tokenMint = deployment.tokenMint;
    const tokenBalance = tokenMint
      ? await getSolanaTokenBalance(phantomTrader.address, tokenMint)
      : 0;
    log("Solana-Verify", `Wallet token balance: ${tokenBalance}`);

    log("Solana-Verify", "Deployment verification passed");
  });

  test("can withdraw from existing Solana consignment", async ({
    context,
    page,
    phantomPage,
    extensionId,
  }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    log("Solana-Withdraw", "Testing withdrawal from existing consignment...");

    // Load Solana deployment and verify validator - fail fast if not available
    const deployment = loadSolanaDeployment();
    const connection = solanaConnection();
    await connection.getVersion();

    // Connect wallet
    await waitForAppReady(page, `${BASE_URL}/my-deals`);
    await connectPhantomWallet(page, context, phantom);
    await sleep(3000);

    // Find any enabled withdraw button
    const withdrawButtons = page.locator('button:has-text("Withdraw"):not([disabled])');
    const count = await withdrawButtons.count();

    if (count === 0) {
      log("Solana-Withdraw", "No enabled withdraw buttons found - skipping");
      test.skip();
      return;
    }

    log("Solana-Withdraw", `Found ${count} withdraw buttons`);

    // Use dynamic test token from deployment (created during Solana setup)
    const tokenMint = deployment.tokenMint;
    const initialBalance = tokenMint
      ? await getSolanaTokenBalance(phantomTrader.address, tokenMint)
      : 0;
    log("Solana-Withdraw", `Initial token balance: ${initialBalance}`);

    // Click first withdraw button
    await withdrawButtons.first().click();
    log("Solana-Withdraw", "Clicked withdraw");

    const withdrawConfirm = await confirmPhantomTransaction(page, context, phantom, {
      maxRetries: 5,
      timeout: 45000,
    });
    if (!withdrawConfirm) {
      throw new Error("Withdraw transaction confirmation failed");
    }
    log("Solana-Withdraw", "Withdraw transaction confirmed");

    // Wait for transaction to complete
    await sleep(10000);

    const finalBalance = tokenMint
      ? await getSolanaTokenBalance(phantomTrader.address, tokenMint)
      : 0;
    log("Solana-Withdraw", `Final token balance: ${finalBalance}`);

    // Balance should not decrease (tokens returned)
    expect(finalBalance).toBeGreaterThanOrEqual(initialBalance);

    log("Solana-Withdraw", "Withdrawal test passed");
  });

  test("displays Solana consignments in my-deals page", async ({
    context,
    page,
    phantomPage,
    extensionId,
  }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);

    log("Solana-UI", "Checking Solana consignments display...");

    loadSolanaDeployment();
    const connection = solanaConnection();
    await connection.getVersion();

    // Connect wallet
    await waitForAppReady(page, `${BASE_URL}/my-deals`);
    await connectPhantomWallet(page, context, phantom);
    await sleep(3000);

    // Page should load without errors
    const pageTitle = page.locator("h1, h2").first();
    await expect(pageTitle).toBeVisible({ timeout: 10000 });

    // Check for consignment rows or empty state
    const consignmentRows = page.locator('[data-testid*="consignment-row"]');
    const emptyState = page.locator("text=/no consignments|no deals|empty/i");

    const hasConsignments = (await consignmentRows.count()) > 0;
    const hasEmptyState = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);

    log("Solana-UI", `Consignments found: ${await consignmentRows.count()}`);
    log("Solana-UI", `Empty state visible: ${hasEmptyState}`);

    // Should show either consignments or empty state
    expect(hasConsignments || hasEmptyState).toBe(true);

    log("Solana-UI", "UI display test passed");
  });
});
