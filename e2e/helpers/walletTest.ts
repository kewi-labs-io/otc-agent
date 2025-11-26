import { BrowserContext, test as baseTest } from "@playwright/test";
import dappwright, { Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";
import type { OfficialOptions } from "@tenkeylabs/dappwright";

// Use Anvil Localnet for testing (default network)
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;

let sharedContext: BrowserContext | undefined;
let sharedWallet: Dappwright | undefined;

// Extended options that include additional browser args
interface ExtendedOptions extends OfficialOptions {
  args?: string[];
}

export const test = baseTest.extend<{
  context: BrowserContext;
  wallet: Dappwright;
}>({
  // Provide a browser context that has the wallet extension loaded
  context: async ({}, use) => {
    if (!sharedContext) {
      const options: ExtendedOptions = {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        seed: "test test test test test test test test test test test junk",
        headless: false,
        // Speed up extension boot
        args: ["--disable-features=IsolateOrigins,site-per-process"],
      };
      const [wallet, _page, context] = await dappwright.bootstrap("", options);

      // Add Anvil Localnet network (primary test network)
      await wallet.addNetwork({
        networkName: "Anvil Localnet",
        rpc: RPC_URL,
        chainId: CHAIN_ID,
        symbol: "ETH",
      });

      // Ensure wallet is unlocked and on the right network
      await wallet.signin();
      await wallet.switchNetwork("Anvil Localnet");

      sharedContext = context;
      sharedWallet = wallet;
    }

    await use(sharedContext);
  },

  wallet: async ({}, use) => {
    if (!sharedWallet) throw new Error("Wallet not initialized");
    await use(sharedWallet);
  },
});

export const expect = baseTest.expect;


