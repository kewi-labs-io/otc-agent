import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

/**
 * Buyer wallet setup for two-party OTC testing
 * Uses a different seed phrase than the seller to simulate real trading
 */

// Buyer uses Anvil account #1 (different from seller which uses #0)
const BUYER_SEED = process.env.BUYER_SEED_PHRASE || 'test test test test test test test test test test test junk';
const PASSWORD = process.env.WALLET_PASSWORD || 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(BUYER_SEED);

  // Add Anvil network
  const chainId = parseInt(process.env.CHAIN_ID || '31337'); // Anvil default
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545';

  await metamask.addNetwork({
    name: 'Anvil Localnet',
    rpcUrl: rpcUrl,
    chainId: chainId,
    symbol: 'ETH',
  });
});

export const buyerSetup = {
  walletPassword: PASSWORD,
  seedPhrase: BUYER_SEED,
};
