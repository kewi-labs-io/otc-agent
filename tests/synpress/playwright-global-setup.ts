/**
 * Playwright Global Setup for Synpress Tests
 *
 * Wraps the main global-setup.ts with Synpress-specific configuration.
 * Forces local network settings for deterministic E2E testing.
 */

import globalSetup from "../global-setup";

export default async function playwrightGlobalSetup(): Promise<void> {
  // Synpress wallet tests are typically run per-chain in CI.
  // Default to skipping Solana infra unless explicitly enabled.
  if (!process.env.E2E_START_SOLANA) {
    process.env.E2E_START_SOLANA = "false";
  }

  // Force local RPC defaults for on-chain assertions
  process.env.NEXT_PUBLIC_NETWORK = "local";
  process.env.NETWORK = "local";
  process.env.NEXT_PUBLIC_RPC_URL = "http://127.0.0.1:8545";
  process.env.CHAIN_ID = "31337";

  // Vitest-style global setup returns a teardown function.
  // Playwright uses a dedicated globalTeardown, so we ignore the return value.
  await globalSetup();
}
