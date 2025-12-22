import { defineWalletSetup } from "@synthetixio/synpress";
import { MetaMask } from "@synthetixio/synpress/playwright";

/**
 * Seller/Consigner wallet setup for two-party OTC testing
 * This wallet will create consignments and receive payments
 */

// Use the default Anvil seed phrase and password
const defaultSeed = "test test test test test test test test test test test junk";
const defaultPassword = "Tester@1234";

const SELLER_SEED = process.env.SELLER_SEED_PHRASE || defaultSeed;
const PASSWORD = process.env.WALLET_PASSWORD || defaultPassword;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337", 10);

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  // Wait for page to be fully loaded in CI
  await walletPage.waitForLoadState("domcontentloaded");

  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SELLER_SEED);

  await metamask.addNetwork({
    name: "Anvil Localnet",
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    symbol: "ETH",
  });
});

export const sellerSetup = {
  walletPassword: PASSWORD,
  seedPhrase: SELLER_SEED,
};
