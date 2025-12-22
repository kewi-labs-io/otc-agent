/**
 * E2E Test Environment Configuration
 *
 * Defines network settings for local, testnet, and mainnet E2E tests.
 * Use TEST_ENV environment variable to select the environment.
 *
 * Usage:
 *   TEST_ENV=local npx playwright test ...
 *   TEST_ENV=testnet npx playwright test ...
 *   TEST_ENV=mainnet npx playwright test ...
 */

import type { EnvConfig, EvmConfig, SolanaConfig, TestEnv } from "@/types";

export type { TestEnv, EvmConfig, SolanaConfig, EnvConfig };

/**
 * Environment configurations
 */
export const envConfigs: Record<TestEnv, EnvConfig> = {
  /**
   * LOCAL: Uses Anvil for EVM and solana-test-validator for Solana
   * Mock tokens deployed by test setup scripts
   */
  local: {
    evm: {
      rpc: "http://127.0.0.1:8545",
      chainId: 31337,
      chainName: "Anvil Localnet",
      blockExplorer: "",
    },
    solana: {
      rpc: "http://127.0.0.1:8899",
      cluster: "localnet",
      explorer: "",
    },
    appUrl: "http://localhost:4444",
  },

  /**
   * TESTNET: Uses Base Sepolia for EVM and Solana Devnet
   * Use faucet tokens for testing
   */
  testnet: {
    evm: {
      rpc: "https://sepolia.base.org",
      chainId: 84532,
      chainName: "Base Sepolia",
      blockExplorer: "https://sepolia.basescan.org",
    },
    solana: {
      rpc: "https://api.devnet.solana.com",
      cluster: "devnet",
      explorer: "https://explorer.solana.com?cluster=devnet",
    },
    appUrl: process.env.TESTNET_APP_URL || "https://staging.otc.example.com",
  },

  /**
   * MAINNET: Uses Base Mainnet for EVM and Solana Mainnet
   * CAUTION: Uses real tokens - be careful
   */
  mainnet: {
    evm: {
      rpc: "https://mainnet.base.org",
      chainId: 8453,
      chainName: "Base",
      blockExplorer: "https://basescan.org",
    },
    solana: {
      rpc: "https://api.mainnet-beta.solana.com",
      cluster: "mainnet-beta",
      explorer: "https://explorer.solana.com",
    },
    appUrl: process.env.MAINNET_APP_URL || "https://otc.example.com",
  },
};

/**
 * Get current test environment from TEST_ENV env var
 * Defaults to 'local'
 */
export function getTestEnv(): TestEnv {
  const env = process.env.TEST_ENV as TestEnv | undefined;
  if (env && env in envConfigs) {
    return env;
  }
  return "local";
}

/**
 * Get configuration for current test environment
 */
export function getEnvConfig(): EnvConfig {
  return envConfigs[getTestEnv()];
}

/**
 * Token addresses per environment
 */
export const tokenAddressesByEnv: Record<TestEnv, { evmEliza: string; solanaEliza: string }> = {
  local: {
    // These are populated by deployment scripts
    evmEliza: process.env.EVM_ELIZA_ADDRESS || "",
    solanaEliza: process.env.SOLANA_ELIZA_ADDRESS || "",
  },
  testnet: {
    // Testnet/devnet token addresses
    evmEliza: "0x...", // Base Sepolia test token
    solanaEliza: "...", // Solana devnet test token
  },
  mainnet: {
    // Production token addresses
    evmEliza: "0xea17df5cf6d172224892b5477a16acb111182478",
    solanaEliza: "DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA",
  },
};

/**
 * Check if we should skip tests for current environment
 * Useful for skipping mainnet tests in CI
 */
export function shouldSkipForEnv(skipEnvs: TestEnv[]): boolean {
  return skipEnvs.includes(getTestEnv());
}

/**
 * Log current test environment
 */
export function logTestEnv(): void {
  const env = getTestEnv();
  const config = getEnvConfig();
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  TEST ENVIRONMENT: ${env.toUpperCase().padEnd(38)}║
╠════════════════════════════════════════════════════════════╣
║  EVM:    ${config.evm.chainName.padEnd(48)}║
║  RPC:    ${config.evm.rpc.padEnd(48).slice(0, 48)}║
║  Solana: ${config.solana.cluster.padEnd(48)}║
║  RPC:    ${config.solana.rpc.padEnd(48).slice(0, 48)}║
║  App:    ${config.appUrl.padEnd(48).slice(0, 48)}║
╚════════════════════════════════════════════════════════════╝
  `);
}
