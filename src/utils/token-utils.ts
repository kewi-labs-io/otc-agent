/**
 * Token ID Utilities
 *
 * Token ID format: "token-{chain}-{address}"
 * Examples: "token-base-0x1234...", "token-solana-So11111..."
 */

import type { Chain, ChainFamily } from "@/config/chains";

/** Valid chain identifiers */
const VALID_CHAINS = new Set<Chain>(["ethereum", "base", "bsc", "solana"]);

/** Chain to family mapping */
const CHAIN_FAMILY: Record<Chain, ChainFamily> = {
  ethereum: "evm",
  base: "evm",
  bsc: "evm",
  solana: "solana",
};

export interface ParsedTokenId {
  chain: Chain;
  address: string;
}

/** Check if value is a valid Chain */
export function isValidChain(value: string): value is Chain {
  return VALID_CHAINS.has(value as Chain);
}

/**
 * Split token ID into parts, validating basic structure
 * Returns [prefix, chain, ...addressParts] or throws
 */
function splitTokenId(tokenId: string): string[] {
  if (!tokenId) throw new Error("Token ID is required");
  const parts = tokenId.split("-");
  if (parts.length < 3) {
    throw new Error(
      `Invalid token ID format: "${tokenId}". Expected "token-{chain}-{address}"`,
    );
  }
  return parts;
}

/**
 * Parse a token ID into chain and address
 * @throws if tokenId is empty, malformed, or has invalid chain
 */
export function parseTokenId(tokenId: string): ParsedTokenId {
  const parts = splitTokenId(tokenId);

  if (parts[0] !== "token") {
    throw new Error(`Invalid token ID prefix: "${parts[0]}". Expected "token"`);
  }

  const chainStr = parts[1];
  if (!isValidChain(chainStr)) {
    throw new Error(
      `Invalid chain: "${chainStr}". Valid: ${[...VALID_CHAINS].join(", ")}`,
    );
  }

  const address = parts.slice(2).join("-");
  if (!address) throw new Error(`Missing address in token ID: "${tokenId}"`);

  return { chain: chainStr, address };
}

/**
 * Get chain family (evm or solana) for a token ID
 * Returns null if tokenId is empty or invalid
 */
export function getChainFamily(tokenId: string): ChainFamily | null {
  if (!tokenId) return null;

  // Quick check via string matching (most common cases)
  if (tokenId.includes("-solana-")) return "solana";
  if (
    tokenId.includes("-ethereum-") ||
    tokenId.includes("-base-") ||
    tokenId.includes("-bsc-")
  ) {
    return "evm";
  }

  // Fallback: parse and lookup
  const parts = tokenId.split("-");
  const chain = parts[1];
  return chain && isValidChain(chain) ? CHAIN_FAMILY[chain] : null;
}

/** Extract chain string from token ID (no validation) */
export function extractChainFromTokenId(tokenId: string): string {
  return splitTokenId(tokenId)[1];
}

/** Extract address from token ID (no validation) */
export function extractAddressFromTokenId(tokenId: string): string {
  return splitTokenId(tokenId).slice(2).join("-");
}

/** Build a token ID from components */
export function buildTokenId(chain: Chain, address: string): string {
  if (!chain) throw new Error("Chain is required");
  if (!address) throw new Error("Address is required");
  if (!isValidChain(chain)) {
    throw new Error(
      `Invalid chain: "${chain}". Valid: ${[...VALID_CHAINS].join(", ")}`,
    );
  }
  return `token-${chain}-${address}`;
}

/** Check if token is on EVM chain */
export function isEvmToken(tokenId: string): boolean {
  return getChainFamily(tokenId) === "evm";
}

/** Check if token is on Solana */
export function isSolanaToken(tokenId: string): boolean {
  return getChainFamily(tokenId) === "solana";
}
