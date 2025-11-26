import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

/**
 * Basic MetaMask wallet setup for Synpress tests
 * 
 * Uses the standard Anvil test seed phrase which gives us:
 * - Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
 * - Account 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
 * etc.
 * 
 * Chain configuration:
 * - Anvil: chainId 31337 at http://localhost:8545
 */

const SEED_PHRASE = process.env.SEED_PHRASE || 'test test test test test test test test test test test junk';
const PASSWORD = process.env.WALLET_PASSWORD || 'Tester@1234';

// Wallet setup function
const setupWallet = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  
  // Import wallet with test seed
  await metamask.importWallet(SEED_PHRASE);

  // Add Anvil network
  // Anvil default chainId is 31337
  const chainId = parseInt(process.env.CHAIN_ID || '31337');
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545';
  
  await metamask.addNetwork({
    name: 'Anvil Localnet',
    rpcUrl: rpcUrl,
    chainId: chainId,
    symbol: 'ETH',
  });

  // Switch to Anvil network
  await metamask.switchNetwork('Anvil Localnet');
});

// Export password for tests to use with MetaMask class
export const walletPassword = PASSWORD;

// Default export is the wallet setup
export default setupWallet;
