/**
 * Consolidated address validation utilities
 */

import { getAddress } from "viem";

/**
 * Check if address looks like a Solana address (base58, 32-44 chars)
 * Solana addresses are base58 encoded, typically 32-44 characters
 * They don't contain 0, I, O, l characters
 */
export function isSolanaAddress(address: string): boolean {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Check if address looks like an EVM address (0x followed by 40 hex chars)
 */
export function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if a string is any valid blockchain address (EVM or Solana)
 * Useful for detecting when a user has pasted an address into a search field
 */
export function isContractAddress(address: string): boolean {
  return isSolanaAddress(address) || isEvmAddress(address);
}

/**
 * Detect chain from address format
 * Returns 'solana', 'evm', or null if unrecognized
 */
export function detectChainFromAddress(
  address: string,
): "solana" | "evm" | null {
  if (isSolanaAddress(address)) return "solana";
  if (isEvmAddress(address)) return "evm";
  return null;
}

/**
 * EIP-55 checksum an Ethereum address using viem
 * FAIL-FAST: Throws if address format is invalid
 */
export function checksumAddress(address: string): string {
  return getAddress(address);
}

/**
 * Normalize EVM address to lowercase
 */
export function normalizeEvmAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Normalize any address (EVM or Solana)
 * - EVM: lowercase (case-insensitive addresses)
 * - Solana: preserve case (case-sensitive)
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (isEvmAddress(trimmed)) {
    return trimmed.toLowerCase();
  }
  // Solana addresses are case-sensitive, keep as-is
  return trimmed;
}

/**
 * Validate and normalize address for a specific chain
 * Returns normalized address or null if invalid
 */
export function validateAndNormalizeAddress(
  address: string,
  chain: "solana" | "ethereum" | "base" | "bsc",
): string | null {
  if (chain === "solana") {
    return isSolanaAddress(address) ? address : null;
  }

  // EVM chains
  if (!isEvmAddress(address)) return null;
  return normalizeEvmAddress(address);
}
