import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';
import { evmSeller } from '../synpress/utils/wallets';

/**
 * Seller/Consigner wallet setup for two-party OTC testing
 * This wallet will create consignments and receive payments
 */

// Seller uses a different derivation path or a specific key
// For Anvil, account #0 is: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export default defineWalletSetup(evmSeller.password, async (context, walletPage) => {
  // Wait for page to be fully loaded in CI
  await walletPage.waitForLoadState('domcontentloaded');
  
  const metamask = new MetaMask(context, walletPage, evmSeller.password);
  await metamask.importWallet(evmSeller.seedPhrase);

  const chainId = evmSeller.chainId;
  const rpcUrl = evmSeller.rpcUrl;

  await metamask.addNetwork({
    name: 'Anvil Localnet',
    rpcUrl: rpcUrl,
    chainId: chainId,
    symbol: 'ETH',
  });
});

export const sellerSetup = {
  walletPassword: evmSeller.password,
  seedPhrase: evmSeller.seedPhrase,
};

