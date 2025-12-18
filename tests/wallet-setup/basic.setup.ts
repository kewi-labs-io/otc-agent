import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

/**
 * Basic MetaMask wallet setup for Synpress tests
 */

const SEED_PHRASE = process.env.SEED_PHRASE || 'test test test test test test test test test test test junk';
const PASSWORD = process.env.WALLET_PASSWORD || 'Tester@1234';

const setupWallet = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  await walletPage.waitForLoadState('domcontentloaded');
  
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SEED_PHRASE);
  console.log('✅ Wallet imported');
});

export const walletPassword = PASSWORD;
export const seedPhrase = SEED_PHRASE;

export default setupWallet;
