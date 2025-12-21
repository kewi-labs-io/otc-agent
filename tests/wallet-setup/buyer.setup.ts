import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';
import { evmBuyer } from '../synpress/utils/wallets';

/**
 * Buyer wallet setup for two-party OTC testing
 * Uses a different seed phrase than the seller to simulate real trading
 */

// Buyer uses Anvil account #1 (different from seller which uses #0)
export default defineWalletSetup(evmBuyer.password, async (context, walletPage) => {
  // Wait for page to be fully loaded in CI
  await walletPage.waitForLoadState('domcontentloaded');
  
  const metamask = new MetaMask(context, walletPage, evmBuyer.password);
  await metamask.importWallet(evmBuyer.seedPhrase);

  const chainId = evmBuyer.chainId;
  const rpcUrl = evmBuyer.rpcUrl;

  await metamask.addNetwork({
    name: 'Anvil Localnet',
    rpcUrl: rpcUrl,
    chainId: chainId,
    symbol: 'ETH',
  });
});

export const buyerSetup = {
  walletPassword: evmBuyer.password,
  seedPhrase: evmBuyer.seedPhrase,
};

