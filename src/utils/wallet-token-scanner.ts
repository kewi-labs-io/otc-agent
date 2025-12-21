/**
 * Wallet token scanner utilities
 * Scans user wallets for all tokens via backend APIs
 *
 * Strategy:
 * - Solana: Backend API using Helius
 */

import type { Chain } from "@/config/chains";

export interface ScannedToken {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  logoUrl?: string;
  chain: Chain;
  isRegistered: boolean;
  priceUsd?: number;
  balanceUsd?: number;
}

/**
 * Scan wallet for ERC20 tokens using backend API
 * Works for Base, BSC, and other EVM chains
 * Requires ALCHEMY_API_KEY in environment
 */
async function scanEvmTokens(
  address: string,
  chain: Chain,
  forceRefresh = false,
): Promise<ScannedToken[]> {
  const url = `/api/evm-balances?address=${address}&chain=${chain}${forceRefresh ? "&refresh=true" : ""}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000), // 60s timeout for initial load
  });

  if (!response.ok) {
    throw new Error(`EVM balances API returned ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`EVM balances error: ${data.error}`);
  }

  interface EvmToken {
    contractAddress: string;
    symbol: string;
    name: string;
    decimals: number;
    balance: string;
    logoUrl?: string;
    priceUsd?: number;
    balanceUsd?: number;
  }

  if (!data.tokens || !Array.isArray(data.tokens)) {
    throw new Error("EVM balances API returned invalid tokens array");
  }
  const tokens = data.tokens as EvmToken[];

  return tokens.map((t) => {
    if (!t.contractAddress) {
      throw new Error("Token missing contractAddress");
    }
    if (!t.symbol) {
      throw new Error(`Token ${t.contractAddress} missing symbol`);
    }
    if (!t.name) {
      throw new Error(`Token ${t.contractAddress} missing name`);
    }
    if (typeof t.decimals !== "number") {
      throw new Error(`Token ${t.contractAddress} missing or invalid decimals`);
    }
    return {
      address: t.contractAddress,
      symbol: t.symbol,
      name: t.name,
      balance: t.balance,
      decimals: t.decimals,
      logoUrl: t.logoUrl,
      chain,
      isRegistered: false,
      priceUsd: t.priceUsd,
      balanceUsd: t.balanceUsd,
    };
  });
}

/**
 * Scan wallet for all SPL tokens on Solana
 * Uses backend API which handles everything (balances + metadata + prices)
 */
async function scanSolanaTokens(
  address: string,
  forceRefresh = false,
): Promise<ScannedToken[]> {
  // Backend API does everything: balances, metadata, prices in optimized calls
  const url = `/api/solana-balances?address=${address}${forceRefresh ? "&refresh=true" : ""}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000), // 30s timeout
  });

  if (!response.ok) {
    throw new Error(`Solana balances API returned ${response.status}`);
  }

  const data = await response.json();

  interface SolanaToken {
    mint: string;
    amount: number;
    decimals: number;
    symbol?: string;
    name?: string;
    logoURI?: string | null;
    priceUsd?: number;
    balanceUsd?: number;
  }

  // FAIL-FAST: tokens array must exist
  if (!data.tokens || !Array.isArray(data.tokens)) {
    throw new Error(
      "Invalid response: tokens array is missing or not an array",
    );
  }
  const tokens = data.tokens as SolanaToken[];

  return tokens.map((t) => {
    // FAIL-FAST: Symbol and name are required - if missing, this indicates a data quality issue
    if (!t.symbol || typeof t.symbol !== "string") {
      throw new Error(`Solana token missing symbol for mint: ${t.mint}`);
    }
    if (!t.name || typeof t.name !== "string") {
      throw new Error(`Solana token missing name for mint: ${t.mint}`);
    }

    return {
      address: t.mint,
      symbol: t.symbol,
      name: t.name,
      balance: t.amount.toString(),
      decimals: t.decimals,
      // logoUrl is optional - use undefined if not present
      logoUrl: t.logoURI ?? undefined,
      chain: "solana" as const,
      isRegistered: false,
      priceUsd: t.priceUsd ?? 0, // priceUsd can legitimately be 0
      balanceUsd: t.balanceUsd ?? 0, // balanceUsd can legitimately be 0
    };
  });
}

/**
 * Get registered token addresses from database
 * Uses lightweight addresses endpoint for efficiency
 * Returns empty set on failure to allow scanner to continue
 */
async function getRegisteredAddresses(chain: Chain): Promise<Set<string>> {
  // Use lightweight addresses endpoint (smaller payload)
  const response = await fetch(`/api/tokens/addresses?chain=${chain}`);

  if (!response.ok) {
    throw new Error(`Token addresses API returned ${response.status}`);
  }

  const data = await response.json();

  if (!data.success || !data.addresses) {
    throw new Error("Token addresses API returned invalid response");
  }

  const registeredAddresses: Array<{ address: string }> = data.addresses;
  return new Set(
    registeredAddresses.map((t) =>
      // EVM addresses are case-insensitive, Solana addresses are case-sensitive
      chain === "solana" ? t.address : t.address.toLowerCase(),
    ),
  );
}

/**
 * Scan wallet for tokens on any supported chain
 * Returns tokens with balances, metadata, prices, and registration status
 */
export async function scanWalletTokens(
  address: string,
  chain: Chain,
  forceRefresh = false,
): Promise<ScannedToken[]> {
  if (!address) {
    throw new Error("Wallet address required");
  }

  // Start fetching registered addresses immediately
  const registeredAddressesPromise = getRegisteredAddresses(chain);

  let tokensPromise: Promise<ScannedToken[]>;

  if (chain === "solana") {
    tokensPromise = scanSolanaTokens(address, forceRefresh);
  } else if (chain === "ethereum" || chain === "base" || chain === "bsc") {
    // Use backend API for EVM chains (no publicClient needed)
    tokensPromise = scanEvmTokens(address, chain, forceRefresh);
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Wait for both
  const [registeredAddresses, tokens] = await Promise.all([
    registeredAddressesPromise,
    tokensPromise,
  ]);

  // Apply registration status
  return tokens.map((t) => ({
    ...t,
    isRegistered: registeredAddresses.has(t.address),
  }));
}

/**
 * Scan wallet on multiple chains simultaneously
 */
export async function scanWalletMultiChain(
  evmAddress?: string,
  solanaAddress?: string,
): Promise<Record<Chain, ScannedToken[]>> {
  const results: Record<string, ScannedToken[]> = {};

  const promises: Promise<void>[] = [];

  if (evmAddress) {
    promises.push(
      scanWalletTokens(evmAddress, "base").then((tokens) => {
        results.base = tokens;
      }),
    );
  }

  if (solanaAddress) {
    promises.push(
      scanWalletTokens(solanaAddress, "solana").then((tokens) => {
        results.solana = tokens;
      }),
    );
  }

  await Promise.all(promises);

  return results as Record<Chain, ScannedToken[]>;
}
