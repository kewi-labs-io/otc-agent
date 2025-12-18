import { defineWalletSetup } from '@synthetixio/synpress';
import { Phantom } from '@synthetixio/synpress/playwright';

/**
 * Phantom wallet setup using Synpress's built-in Phantom class
 */

const SEED_PHRASE = process.env.PHANTOM_SEED_PHRASE || 'test test test test test test test test test test test junk';
const PASSWORD = process.env.PHANTOM_PASSWORD || 'Tester@1234';

const setupPhantomWallet = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  // Use Synpress's built-in Phantom class
  const phantom = new Phantom(context, walletPage, PASSWORD);
  
  // Import wallet using Synpress's built-in method
  await phantom.importWallet(SEED_PHRASE);
  
  console.log('✅ Phantom wallet imported');
});

export const phantomPassword = PASSWORD;
export const phantomSeedPhrase = SEED_PHRASE;

export default setupPhantomWallet;
