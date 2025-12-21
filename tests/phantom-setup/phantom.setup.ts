import { defineWalletSetup } from '@synthetixio/synpress';
import { Phantom } from '@synthetixio/synpress/playwright';

/**
 * Phantom wallet setup using Synpress's built-in Phantom class
 */

// Use the default seed phrase and password for testing
const defaultSeed = 'test test test test test test test test test test test junk';
const defaultPassword = 'Tester@1234';

export const phantomPassword = process.env.PHANTOM_PASSWORD || defaultPassword;
export const phantomSeedPhrase = process.env.PHANTOM_SEED_PHRASE || defaultSeed;

const setupPhantomWallet = defineWalletSetup(phantomPassword, async (context, walletPage) => {
  // Use Synpress's built-in Phantom class
  const phantom = new Phantom(context, walletPage, phantomPassword);
  
  // Import wallet using Synpress's built-in method
  await phantom.importWallet(phantomSeedPhrase);
  
  console.log('Phantom wallet imported');
});

export default setupPhantomWallet;
