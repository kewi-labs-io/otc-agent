import { defineWalletSetup } from '@synthetixio/synpress';
import { Phantom } from '@synthetixio/synpress/playwright';
import { phantomTrader } from '../synpress/utils/wallets';

/**
 * Phantom wallet setup using Synpress's built-in Phantom class
 */

const setupPhantomWallet = defineWalletSetup(phantomTrader.password, async (context, walletPage) => {
  // Use Synpress's built-in Phantom class
  const phantom = new Phantom(context, walletPage, phantomTrader.password);
  
  // Import wallet using Synpress's built-in method
  await phantom.importWallet(phantomTrader.seedPhrase);
  
  console.log('✅ Phantom wallet imported');
});

export const phantomPassword = phantomTrader.password;
export const phantomSeedPhrase = phantomTrader.seedPhrase;

export default setupPhantomWallet;
