/**
 * Consolidated logo fetching utilities
 *
 * Sources (in order of preference):
 * - TrustWallet Assets: Best coverage for popular tokens, free
 * - Alchemy: Good fallback for EVM tokens
 * - CoinGecko: Good fallback, may be rate limited on free tier
 */

import { getAddress } from "viem";

/** Chain config for logo sources */
export const CHAIN_LOGO_CONFIG: Record<
  string,
  {
    alchemyNetwork: string;
    trustwalletChain: string;
    coingeckoPlatform: string;
  }
> = {
  ethereum: {
    alchemyNetwork: "eth-mainnet",
    trustwalletChain: "ethereum",
    coingeckoPlatform: "ethereum",
  },
  base: {
    alchemyNetwork: "base-mainnet",
    trustwalletChain: "base",
    coingeckoPlatform: "base",
  },
  bsc: {
    alchemyNetwork: "bnb-mainnet",
    trustwalletChain: "smartchain",
    coingeckoPlatform: "binance-smart-chain",
  },
};

interface LogoFetchOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * EIP-55 checksum an Ethereum address
 * Trust Wallet requires properly checksummed addresses
 * FAIL-FAST: Throws if address format is invalid
 */
export function checksumAddress(address: string): string {
  return getAddress(address);
}

/**
 * Try to get logo from Trust Wallet Assets (GitHub hosted, free)
 * URL pattern: https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/{chain}/assets/{address}/logo.png
 *
 * IMPORTANT: Trust Wallet requires EIP-55 checksummed addresses
 */
export async function fetchTrustWalletLogo(
  contractAddress: string,
  chain: string,
  options: LogoFetchOptions = {},
): Promise<string | null> {
  const config = CHAIN_LOGO_CONFIG[chain];
  if (!config) return null;

  const { timeout = 2000 } = options;

  const checksummed = checksumAddress(contractAddress);
  const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${config.trustwalletChain}/assets/${checksummed}/logo.png`;

  // Use GET with range header (GitHub raw may not handle HEAD properly)
  const response = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    signal:
      options.signal !== undefined
        ? options.signal
        : AbortSignal.timeout(timeout),
  });

  // 200 or 206 (partial content) means the file exists
  if (response.ok || response.status === 206) {
    return url;
  }

  return null;
}

/**
 * Try to get logo from Alchemy API
 */
export async function fetchAlchemyLogo(
  contractAddress: string,
  chain: string,
  alchemyKey: string | undefined,
  options: LogoFetchOptions = {},
): Promise<string | null> {
  if (!alchemyKey) return null;

  const config = CHAIN_LOGO_CONFIG[chain];
  if (!config) return null;

  const { timeout = 5000 } = options;
  const url = `https://${config.alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenMetadata",
      params: [contractAddress],
    }),
    signal:
      options.signal !== undefined
        ? options.signal
        : AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { result?: { logo?: string } };
  if (data.result && data.result.logo) {
    return data.result.logo;
  }

  return null;
}

/**
 * Try to get logo from CoinGecko by contract address
 */
export async function fetchCoinGeckoLogo(
  contractAddress: string,
  chain: string,
  options: LogoFetchOptions = {},
): Promise<string | null> {
  const config = CHAIN_LOGO_CONFIG[chain];
  if (!config) return null;

  const { timeout = 3000 } = options;
  const apiKey = process.env.COINGECKO_API_KEY;
  const baseUrl = apiKey
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

  const url = `${baseUrl}/coins/${config.coingeckoPlatform}/contract/${contractAddress.toLowerCase()}`;
  const headers: HeadersInit = {};
  if (apiKey) {
    headers["X-Cg-Pro-Api-Key"] = apiKey;
  }

  const response = await fetch(url, {
    headers,
    signal:
      options.signal !== undefined
        ? options.signal
        : AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    image?: { small?: string; thumb?: string; large?: string };
  };
  if (data.image) {
    if (data.image.small) return data.image.small;
    if (data.image.thumb) return data.image.thumb;
    if (data.image.large) return data.image.large;
  }
  return null;
}

/**
 * Try multiple sources to find a logo for an EVM token
 * Order: TrustWallet (best coverage) -> Alchemy -> CoinGecko
 */
export async function fetchLogoFromMultipleSources(
  contractAddress: string,
  chain: string,
  alchemyKey: string | undefined,
  options: LogoFetchOptions = {},
): Promise<string | null> {
  // 1. Try TrustWallet first (free, best coverage for popular tokens)
  const trustWalletLogo = await fetchTrustWalletLogo(
    contractAddress,
    chain,
    options,
  );
  if (trustWalletLogo) {
    console.log(
      `[Logo Fetcher] Found logo from TrustWallet for ${contractAddress.slice(0, 10)}...`,
    );
    return trustWalletLogo;
  }

  // 2. Try Alchemy as fallback
  const alchemyLogo = await fetchAlchemyLogo(
    contractAddress,
    chain,
    alchemyKey,
    options,
  );
  if (alchemyLogo) {
    console.log(
      `[Logo Fetcher] Found logo from Alchemy for ${contractAddress.slice(0, 10)}...`,
    );
    return alchemyLogo;
  }

  // 3. Try CoinGecko (might be rate limited on free tier)
  const coinGeckoLogo = await fetchCoinGeckoLogo(
    contractAddress,
    chain,
    options,
  );
  if (coinGeckoLogo) {
    console.log(
      `[Logo Fetcher] Found logo from CoinGecko for ${contractAddress.slice(0, 10)}...`,
    );
    return coinGeckoLogo;
  }

  console.log(
    `[Logo Fetcher] No logo found for ${contractAddress.slice(0, 10)}... from any source`,
  );
  return null;
}

/**
 * Parallel fetch TrustWallet + Alchemy logos (optimized)
 * Returns first found or falls back to CoinGecko
 */
export async function fetchLogoParallel(
  contractAddress: string,
  chain: string,
  alchemyKey: string | undefined,
  options: LogoFetchOptions = {},
): Promise<string | null> {
  const config = CHAIN_LOGO_CONFIG[chain];
  if (!config) return null;

  // Fetch TrustWallet and Alchemy in parallel
  const [trustWalletLogo, alchemyLogo] = await Promise.all([
    fetchTrustWalletLogo(contractAddress, chain, options),
    fetchAlchemyLogo(contractAddress, chain, alchemyKey, options),
  ]);

  // Prefer TrustWallet (most reliable), then Alchemy
  if (trustWalletLogo) {
    console.log(
      `[Logo Fetcher] Found logo from TrustWallet for ${contractAddress.slice(0, 10)}...`,
    );
    return trustWalletLogo;
  }

  if (alchemyLogo) {
    console.log(
      `[Logo Fetcher] Found logo from Alchemy for ${contractAddress.slice(0, 10)}...`,
    );
    return alchemyLogo;
  }

  // Fall back to CoinGecko only if both failed
  const coinGeckoLogo = await fetchCoinGeckoLogo(
    contractAddress,
    chain,
    options,
  );
  if (coinGeckoLogo) {
    console.log(
      `[Logo Fetcher] Found logo from CoinGecko for ${contractAddress.slice(0, 10)}...`,
    );
    return coinGeckoLogo;
  }

  console.log(
    `[Logo Fetcher] No logo found for ${contractAddress.slice(0, 10)}... from any source`,
  );
  return null;
}
