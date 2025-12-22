/**
 * EVM E2E Tests - Additional EVM-specific scenarios
 *
 * This file contains additional EVM test scenarios beyond the full-flow test.
 * For the complete lifecycle test, see full-flow.e2e.test.ts
 *
 * Scenarios:
 * - Consignment withdrawal without purchase
 * - Multiple offers on same consignment
 * - Invalid quote rejection
 *
 * Run: npx playwright test --config=synpress.config.ts tests/synpress/evm.e2e.test.ts
 */

import { testWithSynpress } from "@synthetixio/synpress";
import { MetaMask } from "@synthetixio/synpress/playwright";
import { getAddress } from "viem";
import { assertServerHealthy, BASE_URL, log, sleep } from "../test-utils";
import sellerSetup from "../wallet-setup/seller.setup";
import { connectMetaMaskWallet, waitForAppReady } from "./utils/login";
import { metaMaskFixtures } from "./utils/metamask-fixtures";
import {
  evmClient,
  getConsignment,
  getConsignmentCount,
  getErc20Balance,
  loadEvmDeployment,
} from "./utils/onchain";
import { confirmMetaMaskTransaction } from "./utils/wallet-confirm";
import { evmSeller } from "./utils/wallets";

const test = testWithSynpress(metaMaskFixtures(sellerSetup));
const { expect } = test;

const TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// EVM ADDITIONAL TEST SCENARIOS
// =============================================================================

test.describe("EVM Additional Scenarios", () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test.beforeAll(async () => {
    await assertServerHealthy();
  });

  test("can create and immediately withdraw consignment", async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    const metamask = new MetaMask(context, metamaskPage, evmSeller.password, extensionId);

    // Setup
    log("EVM-Withdraw", "Setting up withdrawal test...");

    const deployment = loadEvmDeployment();
    const code = await evmClient.getCode({ address: deployment.otc });
    if (!code || code === "0x") {
      throw new Error(`OTC contract not deployed at ${deployment.otc}`);
    }

    const walletAddress = getAddress(evmSeller.address);
    const initialNextConsignmentId = await getConsignmentCount(deployment.otc);
    const tokenBalanceBefore = await getErc20Balance(deployment.token, walletAddress);

    // Connect wallet - switch to Anvil network
    await metamask.switchNetwork("Anvil Localnet").catch(() => {
      // Already on network - continue
    });

    await waitForAppReady(page, `${BASE_URL}/my-deals`);
    await connectMetaMaskWallet(page, context, metamask);
    await sleep(2000);

    const walletIndicator = page.getByTestId("wallet-menu");
    await expect(walletIndicator).toBeVisible({ timeout: 30000 });

    // Create small consignment
    log("EVM-Withdraw", "Creating consignment...");
    await page.goto(`${BASE_URL}/consign`);
    await waitForAppReady(page, `${BASE_URL}/consign`);

    const tokenList = page.locator('[data-testid^="token-row-"]');
    await expect(tokenList.first()).toBeVisible({ timeout: 60000 });
    await tokenList.first().click();

    await page.getByTestId("consign-amount-input").fill("500");

    // Set fixed terms
    const discountRange = page.getByTestId("consign-discount-range");
    const sliders = discountRange.locator('input[type="range"]');
    await sliders.nth(0).evaluate((el) => {
      (el as HTMLInputElement).value = "5";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sliders.nth(1).evaluate((el) => {
      (el as HTMLInputElement).value = "5";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await page.getByTestId("consign-review-button").click();
    await expect(page.getByTestId("consign-create-button")).toBeEnabled({ timeout: 60000 });
    await page.getByTestId("consign-create-button").click();

    // Approve transactions - expect exactly 2 transactions (approve + createConsignment)
    const firstConfirm = await confirmMetaMaskTransaction(page, context, metamask, {
      maxRetries: 5,
      timeout: 45000,
    });
    if (!firstConfirm) {
      throw new Error("First transaction confirmation failed");
    }

    const secondConfirm = await confirmMetaMaskTransaction(page, context, metamask, {
      maxRetries: 3,
      timeout: 30000,
    });
    if (!secondConfirm) {
      log("EVM-Withdraw", "Second transaction not found - may be combined");
    }

    await expect(page.getByTestId("consign-view-my-listings")).toBeVisible({ timeout: 180000 });

    // Verify consignment created
    const nextConsignmentId = await getConsignmentCount(deployment.otc);
    expect(nextConsignmentId).toBe(initialNextConsignmentId + 1n);

    const consignmentId = nextConsignmentId - 1n;
    log("EVM-Withdraw", `Consignment #${consignmentId} created`);

    // Immediately withdraw
    log("EVM-Withdraw", "Withdrawing immediately...");
    await page.goto(`${BASE_URL}/my-deals`);
    await waitForAppReady(page, `${BASE_URL}/my-deals`);

    const withdrawButton = page.getByTestId(
      `consignment-withdraw-base-${consignmentId.toString()}`,
    );
    await expect(withdrawButton).toBeVisible({ timeout: 60000 });
    await withdrawButton.click();

    const withdrawConfirm = await confirmMetaMaskTransaction(page, context, metamask, {
      maxRetries: 5,
      timeout: 45000,
    });
    if (!withdrawConfirm) {
      throw new Error("Withdraw transaction confirmation failed");
    }

    // Verify withdrawal
    await expect
      .poll(
        async () => {
          const c = await getConsignment(deployment.otc, consignmentId);
          return !c.isActive;
        },
        { timeout: 60000 },
      )
      .toBe(true);

    const tokenBalanceAfter = await getErc20Balance(deployment.token, walletAddress);
    expect(tokenBalanceAfter).toBe(tokenBalanceBefore);

    log("EVM-Withdraw", "Withdrawal test passed - tokens returned");
  });

  test("verifies on-chain contract deployment", async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    log("EVM-Contract", "Verifying contract deployment...");

    const deployment = loadEvmDeployment();

    // OTC contract
    const otcCode = await evmClient.getCode({ address: deployment.otc });
    expect(otcCode).toBeDefined();
    expect(otcCode).not.toBe("0x");
    log("EVM-Contract", `OTC deployed at ${deployment.otc}`);

    // Token contract
    const tokenCode = await evmClient.getCode({ address: deployment.token });
    expect(tokenCode).toBeDefined();
    expect(tokenCode).not.toBe("0x");
    log("EVM-Contract", `Token deployed at ${deployment.token}`);

    // USDC contract
    const usdcCode = await evmClient.getCode({ address: deployment.usdc });
    expect(usdcCode).toBeDefined();
    expect(usdcCode).not.toBe("0x");
    log("EVM-Contract", `USDC deployed at ${deployment.usdc}`);

    // Verify seller has tokens
    const walletAddress = getAddress(evmSeller.address);
    const balance = await getErc20Balance(deployment.token, walletAddress);
    expect(balance).toBeGreaterThan(0n);
    log("EVM-Contract", `Seller token balance: ${balance}`);

    log("EVM-Contract", "Contract verification passed");
  });
});
