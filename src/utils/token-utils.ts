/**
 * Token ID Utilities
 *
 * Centralized functions for parsing and validating token IDs.
 * Token ID format: "token-{chain}-{address}"
 *
 * Examples:
 * - "token-base-0x1234..."
 * - "token-solana-So11111111111111111111111111111111111111112"
 * - "token-ethereum-0xdAC17F958D2ee523a2206206994597C13D831ec7"
 */

import type { Chain, ChainFamily } from "@/config/chains";

/**
 * Valid chain identifiers for token IDs
 */
const VALID_CHAINS: readonly Chain[] = [
  "ethereum",
  "base",
  "bsc",
  "solana",
] as const;

/**
 * Mapping from Chain to ChainFamily
 */
const CHAIN_TO_FAMILY: Record<Chain, ChainFamily> = {
  ethereum: "evm",
  base: "evm",
  bsc: "evm",
  solana: "solana",
};

/**
 * Result of parsing a token ID
 */
export interface ParsedTokenId {
  chain: Chain;
  address: string;
}

/**
 * Validates that a string is a valid Chain type
 */
export function isValidChain(value: string): value is Chain {
  return VALID_CHAINS.includes(value as Chain);
}

/**
 * Parse a token ID and extract chain and address.
 *
 * Token ID format: "token-{chain}-{address}"
 *
 * @param tokenId - The token ID to parse (e.g., "token-base-0x1234...")
 * @returns Parsed chain and address
 * @throws Error if tokenId is empty, malformed, or has invalid chain
 *
 * @example
 * ```ts
 * const { chain, address } = parseTokenId("token-base-0x1234...");
 * // chain: "base", address: "0x1234..."
 * ```
 */
export function parseTokenId(tokenId: string): ParsedTokenId {
  if (!tokenId) {
    throw new Error("Token ID is required");
  }

  const parts = tokenId.split("-");

  // Must have at least 3 parts: "token", chain, and address
  // Address may contain dashes (unlikely but handled)
  if (parts.length < 3) {
    throw new Error(
      `Invalid token ID format: "${tokenId}". Expected "token-{chain}-{address}"`,
    );
  }

  // Validate prefix
  if (parts[0] !== "token") {
    throw new Error(
      `Invalid token ID prefix: "${parts[0]}". Expected "token"`,
    );
  }

  const chainStr = parts[1];

  // Validate chain is a known Chain type
  if (!isValidChain(chainStr)) {
    throw new Error(
      `Invalid chain in token ID: "${chainStr}". Valid chains: ${VALID_CHAINS.join(", ")}`,
    );
  }

  // Address is everything after the chain (handles addresses with dashes)
  const address = parts.slice(2).join("-");

  if (!address) {
    throw new Error(`Missing address in token ID: "${tokenId}"`);
  }

  return { chain: chainStr, address };
}

/**
 * Get the chain family (evm or solana) for a token ID.
 *
 * This is useful for determining which wallet/connection type is needed.
 *
 * @param tokenId - The token ID to check
 * @returns "evm" | "solana" if valid, null if tokenId is empty or invalid
 *
 * @example
 * ```ts
 * getChainFamily("token-base-0x1234...")    // "evm"
 * getChainFamily("token-solana-So111...")   // "solana"
 * getChainFamily("")                         // null
 * ```
 */
export function getChainFamily(tokenId: string): ChainFamily | null {
  if (!tokenId) {
    return null;
  }

  // Quick check using string includes for performance
  // This avoids full parsing when we just need the family
  if (tokenId.includes("-solana-")) {
    return "solana";
  }

  if (
    tokenId.includes("-ethereum-") ||
    tokenId.includes("-base-") ||
    tokenId.includes("-bsc-")
  ) {
    return "evm";
  }

  // Fallback to full parse for edge cases or validation
  const parts = tokenId.split("-");
  if (parts.length >= 2) {
    const chainStr = parts[1];
    if (isValidChain(chainStr)) {
      return CHAIN_TO_FAMILY[chainStr];
    }
  }

  return null;
}

/**
 * Extract the chain from a token ID without full validation.
 *
 * This is a looser version of parseTokenId that returns the chain string
 * even if it might not be in the canonical list. Useful for display purposes.
 *
 * @param tokenId - The token ID to extract chain from
 * @returns The chain string portion of the token ID
 * @throws Error if tokenId is empty or doesn't have enough parts
 *
 * @example
 * ```ts
 * extractChainFromTokenId("token-base-0x1234...")  // "base"
 * ```
 */
export function extractChainFromTokenId(tokenId: string): string {
  if (!tokenId) {
    throw new Error("Token ID is required");
  }

  const parts = tokenId.split("-");

  if (parts.length < 2) {
    throw new Error(
      `Invalid token ID format: "${tokenId}". Expected "token-{chain}-{address}"`,
    );
  }

  return parts[1];
}

/**
 * Extract the address from a token ID without full validation.
 *
 * This is a looser version of parseTokenId that returns the address string
 * even if the chain might not be in the canonical list.
 *
 * @param tokenId - The token ID to extract address from
 * @returns The address portion of the token ID
 * @throws Error if tokenId is empty or doesn't have enough parts
 *
 * @example
 * ```ts
 * extractAddressFromTokenId("token-base-0x1234...")  // "0x1234..."
 * ```
 */
export function extractAddressFromTokenId(tokenId: string): string {
  if (!tokenId) {
    throw new Error("Token ID is required");
  }

  const parts = tokenId.split("-");

  if (parts.length < 3) {
    throw new Error(
      `Invalid token ID format: "${tokenId}". Expected "token-{chain}-{address}"`,
    );
  }

  // Address is everything after the chain (handles addresses with dashes)
  return parts.slice(2).join("-");
}

/**
 * Build a token ID from chain and address components.
 *
 * @param chain - The chain identifier
 * @param address - The contract/mint address
 * @returns Formatted token ID
 *
 * @example
 * ```ts
 * buildTokenId("base", "0x1234...")  // "token-base-0x1234..."
 * ```
 */
export function buildTokenId(chain: Chain, address: string): string {
  if (!chain) {
    throw new Error("Chain is required");
  }
  if (!address) {
    throw new Error("Address is required");
  }
  if (!isValidChain(chain)) {
    throw new Error(
      `Invalid chain: "${chain}". Valid chains: ${VALID_CHAINS.join(", ")}`,
    );
  }

  return `token-${chain}-${address}`;
}

/**
 * Check if a token ID is for an EVM chain (ethereum, base, bsc)
 *
 * @param tokenId - The token ID to check
 * @returns true if the token is on an EVM chain
 */
export function isEvmToken(tokenId: string): boolean {
  return getChainFamily(tokenId) === "evm";
}

/**
 * Check if a token ID is for Solana
 *
 * @param tokenId - The token ID to check
 * @returns true if the token is on Solana
 */
export function isSolanaToken(tokenId: string): boolean {
  return getChainFamily(tokenId) === "solana";
}
