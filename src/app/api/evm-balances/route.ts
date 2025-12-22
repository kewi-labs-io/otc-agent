import crypto from "node:crypto";
import { head, put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";
import { type Address, createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { getEvmConfig } from "@/config/contracts";
import { getNetwork, LOCAL_DEFAULTS } from "@/config/env";
import { agentRuntime } from "@/lib/agent-runtime";
import { validationErrorResponse } from "@/lib/validation/helpers";
import type { TokenBalance } from "@/types/api";
import {
  EvmBalancesResponseSchema,
  GetEvmBalancesQuerySchema,
} from "@/types/validation/api-schemas";
import { checksumAddress } from "@/utils/address-utils";

// TokenBalance type imported from @/types/api

// Metadata cache (permanent - token metadata doesn't change)
// logoCheckedAt: timestamp when we last tried to find a logo
// If logoUrl is undefined and logoCheckedAt is recent, skip re-checking
interface CachedTokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  logoCheckedAt?: number; // Unix timestamp - if set and no logoUrl, means we checked and found nothing
}

// How long to wait before retrying logo fetch for tokens without logos (24 hours)
const LOGO_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Bulk metadata cache - stores all known metadata per chain in one key
interface BulkMetadataCache {
  metadata: Record<string, CachedTokenMetadata>;
}

async function getBulkMetadataCache(chain: string): Promise<Record<string, CachedTokenMetadata>> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<BulkMetadataCache>(`evm-metadata-bulk:${chain}`);
  if (!cached || !cached.metadata) {
    return {};
  }
  return cached.metadata;
}

async function setBulkMetadataCache(
  chain: string,
  metadata: Record<string, CachedTokenMetadata>,
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`evm-metadata-bulk:${chain}`, { metadata });
}

// Price cache TTL: 15 minutes
const PRICE_CACHE_TTL_MS = 15 * 60 * 1000;

// Wallet balance cache TTL: 15 minutes
const WALLET_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedWalletBalances {
  tokens: TokenBalance[];
  cachedAt: number;
}

async function getCachedWalletBalances(
  chain: string,
  address: string,
): Promise<TokenBalance[] | null> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<CachedWalletBalances>(
    `evm-wallet:${chain}:${address.toLowerCase()}`,
  );
  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= WALLET_CACHE_TTL_MS) return null;
  console.log(`[EVM Balances] Using cached wallet data (${cached.tokens.length} tokens)`);
  return cached.tokens;
}

async function setCachedWalletBalances(
  chain: string,
  address: string,
  tokens: TokenBalance[],
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`evm-wallet:${chain}:${address.toLowerCase()}`, {
    tokens,
    cachedAt: Date.now(),
  });
}

/**
 * Check if blob storage is available (BLOB_READ_WRITE_TOKEN is set)
 */
function isBlobStorageAvailable(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Cache an image URL to Vercel Blob storage
 * Returns the cached blob URL, or the original URL if caching fails/unavailable
 */
async function cacheImageToBlob(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;

  // Skip if already a blob URL
  if (imageUrl.includes("blob.vercel-storage.com")) {
    return imageUrl;
  }

  // If blob storage isn't configured, return original URL
  if (!isBlobStorageAvailable()) {
    return imageUrl;
  }

  // FAIL-FAST: Image caching must succeed
  const urlHash = crypto.createHash("md5").update(imageUrl).digest("hex");
  const extension = getExtensionFromUrl(imageUrl);
  if (!extension) {
    throw new Error(`Unable to determine extension for URL: ${imageUrl}`);
  }
  const blobPath = `token-images/${urlHash}.${extension}`;

  // Check if already cached in blob storage
  const existing = await head(blobPath);
  if (existing) {
    return existing.url;
  }

  // Download image
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "OTC-Desk/1.0" },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Image download failed: ${imageUrl} (status: ${response.status})`);
  }

  // content-type header is optional - default to image/png if not provided
  const contentTypeHeader = response.headers.get("content-type");
  const contentType = contentTypeHeader !== null ? contentTypeHeader : "image/png";
  const imageBuffer = await response.arrayBuffer();

  const blob = await put(blobPath, imageBuffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}

function getExtensionFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
  if (match) {
    const ext = match[1].toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      return ext;
    }
  }
  return null;
}

// Minimum thresholds to filter obvious dust
// Very permissive - we want to show new tokens without prices
const MIN_TOKEN_BALANCE = 1; // At least 1 token (human-readable)
const MIN_VALUE_USD = 0.001; // $0.001 minimum if we have a price (basically nothing)

// Chain configs
const CHAIN_CONFIG: Record<
  string,
  {
    alchemyNetwork: string;
    coingeckoPlatform: string;
    trustwalletChain: string;
  }
> = {
  ethereum: {
    alchemyNetwork: "eth-mainnet",
    coingeckoPlatform: "ethereum",
    trustwalletChain: "ethereum",
  },
  base: {
    alchemyNetwork: "base-mainnet",
    coingeckoPlatform: "base",
    trustwalletChain: "base",
  },
  bsc: {
    alchemyNetwork: "bnb-mainnet",
    coingeckoPlatform: "binance-smart-chain",
    trustwalletChain: "smartchain",
  },
};

// ============================================================================
// Local (Anvil) balance support
// ============================================================================

const LOCAL_ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

async function fetchLocalWalletBalances(walletAddress: string): Promise<TokenBalance[]> {
  const deployment = getEvmConfig();

  const candidates = [
    deployment.contracts.elizaToken,
    deployment.contracts.usdcToken,
    deployment.contracts.usdc,
  ].filter((v): v is string => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v));

  const tokenAddresses = Array.from(new Set(candidates.map((a) => checksumAddress(a))));

  const account = checksumAddress(walletAddress) as Address;

  const client = createPublicClient({
    chain: foundry,
    transport: http(LOCAL_DEFAULTS.evmRpc),
  });

  // Type assertion to bypass viem's strict authorizationList requirement
  const readContract = client.readContract as <T>(params: {
    address: Address;
    abi: typeof LOCAL_ERC20_ABI;
    functionName: string;
    args?: readonly [Address];
  }) => Promise<T>;

  const tokens: TokenBalance[] = [];
  for (const tokenAddress of tokenAddresses) {
    const token = tokenAddress as Address;
    const [balance, decimals, symbol, name] = await Promise.all([
      readContract<bigint>({
        address: token,
        abi: LOCAL_ERC20_ABI,
        functionName: "balanceOf",
        args: [account],
      }),
      readContract<number>({
        address: token,
        abi: LOCAL_ERC20_ABI,
        functionName: "decimals",
      }),
      readContract<string>({
        address: token,
        abi: LOCAL_ERC20_ABI,
        functionName: "symbol",
      }),
      readContract<string>({
        address: token,
        abi: LOCAL_ERC20_ABI,
        functionName: "name",
      }),
    ]);

    // Only include non-zero balances (UI also filters dust, but this keeps responses small)
    if (balance === 0n) continue;

    tokens.push({
      contractAddress: token,
      symbol,
      name,
      decimals,
      balance: balance.toString(),
      priceUsd: 0,
      balanceUsd: 0,
      logoUrl: undefined,
    });
  }

  return tokens;
}

/**
 * Try to get logo from Trust Wallet Assets (GitHub hosted, free)
 * URL pattern: https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/{chain}/assets/{address}/logo.png
 *
 * IMPORTANT: Trust Wallet requires EIP-55 checksummed addresses
 */
async function fetchTrustWalletLogo(
  contractAddress: string,
  chain: string,
): Promise<string | null> {
  const config = CHAIN_CONFIG[chain];
  if (!config) return null;

  // Trust Wallet REQUIRES checksummed addresses - without this, URLs 404
  const checksummed = checksumAddress(contractAddress);
  const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${config.trustwalletChain}/assets/${checksummed}/logo.png`;

  // Use GET with range header instead of HEAD (GitHub raw may not handle HEAD properly)
  const response = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" }, // Only fetch first byte to check existence
    signal: AbortSignal.timeout(2000),
  });

  // 200 or 206 (partial content) means the file exists
  if (response.ok || response.status === 206) {
    return url;
  }

  return null;
}

/**
 * Try to get logo from CoinGecko by contract address
 */
async function fetchCoinGeckoLogo(contractAddress: string, chain: string): Promise<string | null> {
  const config = CHAIN_CONFIG[chain];
  if (!config) return null;

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
    signal: AbortSignal.timeout(3000),
  });

  if (response.ok) {
    const data = await response.json();
    // CoinGecko returns image.small, image.thumb, or image.large
    // Image is optional, so check existence before accessing
    if (data.image && typeof data.image === "object") {
      // Try multiple image size options (prefer small, then thumb, then large)
      const imageUrl = data.image.small ?? data.image.thumb ?? data.image.large;
      if (typeof imageUrl === "string") {
        return imageUrl;
      }
    }
  }

  return null;
}

/**
 * Try multiple sources to find a logo for a token
 * Order: Trust Wallet (best coverage) -> Alchemy -> CoinGecko
 */
async function fetchLogoFromMultipleSources(
  contractAddress: string,
  chain: string,
  alchemyUrl: string,
): Promise<string | null> {
  // 1. Try Trust Wallet Assets first (free, GitHub hosted, best coverage - 100% for popular tokens)
  const trustWalletLogo = await fetchTrustWalletLogo(contractAddress, chain);
  if (trustWalletLogo) {
    console.log(
      `[EVM Balances] Found logo from TrustWallet for ${contractAddress.slice(0, 10)}...`,
    );
    return trustWalletLogo;
  }

  // 2. Try Alchemy as fallback (if URL provided)
  if (alchemyUrl) {
    const metaRes = await fetch(alchemyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getTokenMetadata",
        params: [contractAddress],
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (metaRes.ok) {
      const data = await metaRes.json();
      if (data.result?.logo) {
        console.log(
          `[EVM Balances] Found logo from Alchemy for ${contractAddress.slice(0, 10)}...`,
        );
        return data.result.logo;
      }
    }
  }

  // 3. Try CoinGecko (might be rate limited on free tier)
  const coinGeckoLogo = await fetchCoinGeckoLogo(contractAddress, chain);
  if (coinGeckoLogo) {
    console.log(`[EVM Balances] Found logo from CoinGecko for ${contractAddress.slice(0, 10)}...`);
    return coinGeckoLogo;
  }

  console.log(
    `[EVM Balances] No logo found for ${contractAddress.slice(0, 10)}... from any source`,
  );
  return null;
}

// Bulk price cache - stores all prices per chain in one key
interface BulkPriceCache {
  prices: Record<string, number>;
  cachedAt: number;
}

async function getBulkPriceCache(chain: string): Promise<Record<string, number>> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<BulkPriceCache>(`evm-prices-bulk:${chain}`);
  if (!cached) return {};
  if (Date.now() - cached.cachedAt >= PRICE_CACHE_TTL_MS) return {};
  console.log(`[EVM Balances] Using cached prices (${Object.keys(cached.prices).length} tokens)`);
  return cached.prices;
}

async function setBulkPriceCache(chain: string, prices: Record<string, number>): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`evm-prices-bulk:${chain}`, {
    prices,
    cachedAt: Date.now(),
  });
}

/**
 * Fetch token balances using Alchemy's getTokenBalances + cached metadata
 *
 * Optimized for maximum parallelism:
 * 1. Single bulk cache read at start
 * 2. Parallel metadata + logo fetches for new tokens
 * 3. Smart logo retry (skip tokens checked within 24h)
 * 4. Single bulk cache write at end
 */
async function fetchAlchemyBalances(
  address: string,
  chain: string,
  apiKey: string,
): Promise<TokenBalance[]> {
  const config = CHAIN_CONFIG[chain];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  const url = `https://${config.alchemyNetwork}.g.alchemy.com/v2/${apiKey}`;

  // Step 1: Get balances + bulk cache in parallel
  const [balancesResponse, bulkCache] = await Promise.all([
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getTokenBalances",
        params: [address, "erc20"],
      }),
      signal: AbortSignal.timeout(10000),
    }),
    getBulkMetadataCache(chain),
  ]);

  if (!balancesResponse.ok) {
    throw new Error(`Alchemy getTokenBalances failed: ${balancesResponse.status}`);
  }

  const balancesData = await balancesResponse.json();

  // FAIL-FAST: Alchemy API errors must be handled
  if (balancesData.error) {
    // error exists (checked above), but message might be missing
    const errorMsg = balancesData.error.message;
    if (typeof errorMsg !== "string") {
      throw new Error("Alchemy API returned error without message");
    }
    throw new Error(`Alchemy API error: ${errorMsg}`);
  }

  // FAIL-FAST: Result structure must be valid
  if (!balancesData.result) {
    throw new Error("Alchemy API returned no result field");
  }
  if (!balancesData.result.tokenBalances) {
    throw new Error("Alchemy API returned invalid token balances data - missing tokenBalances");
  }
  const tokenBalances = balancesData.result.tokenBalances;

  // Filter non-zero balances
  const nonZeroBalances = tokenBalances.filter((t: { tokenBalance: string }) => {
    const bal = t.tokenBalance;
    return bal && bal !== "0x0" && bal !== "0x" && BigInt(bal) > 0n;
  });

  console.log(`[EVM Balances] Found ${nonZeroBalances.length} tokens with balance > 0`);

  if (nonZeroBalances.length === 0) return [];

  // Step 2: Categorize tokens by what they need
  const cachedMetadata: Record<string, CachedTokenMetadata> = {
    ...bulkCache,
  };
  const needsMetadata: string[] = [];
  const needsLogoRetry: string[] = [];
  const now = Date.now();

  interface TokenBalanceData {
    contractAddress: string;
    tokenBalance: string;
  }

  for (const t of nonZeroBalances) {
    const tokenData = t as TokenBalanceData;
    const addr = tokenData.contractAddress.toLowerCase();
    const cached = cachedMetadata[addr];

    if (!cached) {
      // Token not in cache - need full metadata fetch
      needsMetadata.push(addr);
    } else if (!cached.logoUrl) {
      // Token in cache but missing logo - check if we should retry
      const lastCheck = cached.logoCheckedAt || 0;
      if (now - lastCheck > LOGO_RETRY_INTERVAL_MS) {
        // Been more than 24h since we last checked, retry
        needsLogoRetry.push(addr);
      }
      // Otherwise skip - we checked recently and found nothing
    }
  }

  console.log(
    `[EVM Balances] ${Object.keys(cachedMetadata).length} cached, ${needsMetadata.length} need metadata, ${needsLogoRetry.length} eligible for logo retry`,
  );

  // Step 3: Fetch metadata + logos for new tokens in PARALLEL
  // Batch into chunks to avoid overwhelming APIs
  const PARALLEL_BATCH_SIZE = 20;
  let cacheUpdated = false;

  if (needsMetadata.length > 0) {
    // Process in parallel batches
    for (let i = 0; i < needsMetadata.length; i += PARALLEL_BATCH_SIZE) {
      const batch = needsMetadata.slice(i, i + PARALLEL_BATCH_SIZE);

      const metadataResults = await Promise.all(
        batch.map(async (contractAddress) => {
          // Fetch Alchemy metadata + TrustWallet logo in parallel
          const [alchemyMeta, trustWalletLogo] = await Promise.all([
            // Alchemy metadata
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "alchemy_getTokenMetadata",
                params: [contractAddress],
              }),
              signal: AbortSignal.timeout(5000),
            }).then((r) => {
              if (!r.ok) {
                throw new Error(`Alchemy metadata fetch failed: ${r.status}`);
              }
              return r.json();
            }),
            // TrustWallet logo (most reliable source)
            fetchTrustWalletLogo(contractAddress, chain),
          ]);

          // FAIL-FAST: Alchemy metadata must exist
          if (!alchemyMeta) {
            throw new Error(`Alchemy metadata fetch returned null for ${contractAddress}`);
          }
          if (!alchemyMeta.result) {
            throw new Error(`Alchemy metadata fetch returned no result for ${contractAddress}`);
          }
          const result = alchemyMeta.result;
          if (!result.symbol) {
            throw new Error(`Token ${contractAddress} missing symbol`);
          }
          if (!result.name) {
            throw new Error(`Token ${contractAddress} missing name`);
          }
          if (typeof result.decimals !== "number") {
            throw new Error(`Token ${contractAddress} missing decimals`);
          }
          const symbol = result.symbol;
          const name = result.name;
          const decimals = result.decimals;

          // Use TrustWallet logo first, then Alchemy
          const logoUrl = trustWalletLogo || result.logo || undefined;

          // If still no logo, try CoinGecko
          const finalLogoUrl = logoUrl || (await fetchCoinGeckoLogo(contractAddress, chain));

          return {
            contractAddress,
            metadata: {
              symbol,
              name,
              decimals,
              logoUrl: finalLogoUrl,
              logoCheckedAt: now, // Mark when we checked
            } as CachedTokenMetadata,
          };
        }),
      );

      for (const { contractAddress, metadata } of metadataResults) {
        cachedMetadata[contractAddress] = metadata;
      }
      cacheUpdated = true;
    }
  }

  // Step 4: Retry logos for tokens that were checked > 24h ago (limited batch)
  const MAX_LOGO_RETRY = 10;
  const tokensToRetry = needsLogoRetry.slice(0, MAX_LOGO_RETRY);

  if (tokensToRetry.length > 0) {
    console.log(`[EVM Balances] Retrying logo fetch for ${tokensToRetry.length} tokens`);

    const logoResults = await Promise.all(
      tokensToRetry.map(async (contractAddress) => {
        // Try TrustWallet first (best coverage)
        let logo = await fetchTrustWalletLogo(contractAddress, chain);
        if (!logo) {
          logo = await fetchCoinGeckoLogo(contractAddress, chain);
        }
        return { contractAddress, logo };
      }),
    );

    for (const { contractAddress, logo } of logoResults) {
      if (cachedMetadata[contractAddress]) {
        cachedMetadata[contractAddress] = {
          ...cachedMetadata[contractAddress],
          // logo is optional - use undefined if not found
          logoUrl: logo ?? undefined,
          logoCheckedAt: now, // Update check time even if not found
        };
        cacheUpdated = true;
      }
    }
  }

  // Step 5: Blob cache for logos (parallel, non-blocking for response)
  if (isBlobStorageAvailable()) {
    const logoUrls = Object.values(cachedMetadata)
      .map((m) => m.logoUrl)
      .filter((u): u is string => !!u && !u.includes("blob.vercel-storage.com"));

    if (logoUrls.length > 0) {
      // Fire-and-forget blob caching - don't block response
      Promise.all(
        logoUrls.map(async (originalUrl) => {
          const urlHash = crypto.createHash("md5").update(originalUrl).digest("hex");
          // FAIL-FAST: Extension must be determinable for blob storage
          const extension = getExtensionFromUrl(originalUrl);
          if (!extension) {
            throw new Error(`Unable to determine extension for URL: ${originalUrl}`);
          }
          const blobPath = `token-images/${urlHash}.${extension}`;
          const existing = await head(blobPath);

          if (existing) {
            return { originalUrl, blobUrl: existing.url };
          }
          const cachedUrl = await cacheImageToBlob(originalUrl);
          return { originalUrl, blobUrl: cachedUrl };
        }),
      ).then((blobResults) => {
        const blobUrlMap: Record<string, string> = {};
        for (const { originalUrl, blobUrl } of blobResults) {
          if (blobUrl && blobUrl !== originalUrl) {
            blobUrlMap[originalUrl] = blobUrl;
          }
        }

        if (Object.keys(blobUrlMap).length > 0) {
          // Update metadata with blob URLs
          for (const [addr, metadata] of Object.entries(cachedMetadata)) {
            if (metadata.logoUrl && blobUrlMap[metadata.logoUrl]) {
              cachedMetadata[addr] = {
                ...metadata,
                logoUrl: blobUrlMap[metadata.logoUrl],
              };
            }
          }
          // Persist blob URLs to cache
          // Background cache write - don't await (non-critical)
          // Fail-fast: errors will propagate but won't block response
          setBulkMetadataCache(chain, cachedMetadata);
        }
      });
    }
  }

  // Step 6: Save updated cache (single write)
  if (cacheUpdated) {
    await setBulkMetadataCache(chain, cachedMetadata);
  }

  // Step 7: Build token list
  const tokens: TokenBalance[] = nonZeroBalances.map(
    (tokenData: { contractAddress: string; tokenBalance: string }) => {
      const contractAddress = tokenData.contractAddress.toLowerCase();
      const balance = BigInt(tokenData.tokenBalance).toString();
      // FAIL-FAST: Metadata should exist for all tokens (we fetched it above)
      const metadata = cachedMetadata[contractAddress];
      if (!metadata) {
        throw new Error(
          `Metadata missing for token ${contractAddress} - metadata fetch should have populated this`,
        );
      }

      return {
        contractAddress,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        balance,
        logoUrl: metadata.logoUrl,
      };
    },
  );

  return tokens;
}

/**
 * Fetch prices from DeFiLlama (free, good coverage)
 */
async function fetchDeFiLlamaPrices(
  chain: string,
  addresses: string[],
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  // DeFiLlama chain identifiers
  const llamaChain = chain === "base" ? "base" : chain === "bsc" ? "bsc" : chain;

  // DeFiLlama accepts comma-separated list of chain:address
  const coins = addresses.map((a) => `${llamaChain}:${a}`).join(",");
  const url = `https://coins.llama.fi/prices/current/${coins}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!response.ok) {
    console.log("[EVM Balances] DeFiLlama API error:", response.status);
    return {};
  }

  interface DeFiLlamaPriceData {
    price?: number;
  }

  interface DeFiLlamaResponse {
    coins?: Record<string, DeFiLlamaPriceData>;
  }

  const data = (await response.json()) as DeFiLlamaResponse;
  const prices: Record<string, number> = {};

  // Response format: { coins: { "chain:address": { price: number, ... } } }
  if (data.coins) {
    for (const [key, priceData] of Object.entries(data.coins)) {
      const parts = key.split(":");
      // FAIL-FAST: Key must have chain:address format
      if (parts.length < 2) {
        console.warn(`[EVM Balances] Invalid DeFiLlama key format: ${key}`);
        continue;
      }
      const address = parts[1].toLowerCase();
      const price = priceData.price;
      if (typeof price === "number" && price > 0) {
        prices[address] = price;
      }
    }
  }

  console.log(`[EVM Balances] DeFiLlama returned ${Object.keys(prices).length} prices`);
  return prices;
}

/**
 * Fetch prices from CoinGecko (fallback)
 */
async function fetchCoinGeckoPrices(
  chain: string,
  addresses: string[],
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  const config = CHAIN_CONFIG[chain];
  if (!config) return {};

  const addressList = addresses.join(",");
  const apiKey = process.env.COINGECKO_API_KEY;

  const url = apiKey
    ? `https://pro-api.coingecko.com/api/v3/simple/token_price/${config.coingeckoPlatform}?contract_addresses=${addressList}&vs_currencies=usd`
    : `https://api.coingecko.com/api/v3/simple/token_price/${config.coingeckoPlatform}?contract_addresses=${addressList}&vs_currencies=usd`;

  const headers: HeadersInit = {};
  if (apiKey) {
    headers["X-Cg-Pro-Api-Key"] = apiKey;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) return {};

  interface CoinGeckoPriceData {
    usd?: number;
  }

  const data = (await response.json()) as Record<string, CoinGeckoPriceData>;
  const prices: Record<string, number> = {};

  for (const [address, priceData] of Object.entries(data)) {
    const usd = priceData.usd;
    if (typeof usd === "number") {
      prices[address.toLowerCase()] = usd;
    }
  }

  return prices;
}

/**
 * Fetch prices - try DeFiLlama first, then CoinGecko
 */
async function fetchPrices(chain: string, addresses: string[]): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  // Try DeFiLlama first (better coverage for newer tokens)
  const llamaPrices = await fetchDeFiLlamaPrices(chain, addresses);

  // Find addresses still missing prices
  const missingAddresses = addresses.filter((a) => !llamaPrices[a.toLowerCase()]);

  if (missingAddresses.length === 0) {
    return llamaPrices;
  }

  // Try CoinGecko for remaining
  const geckoprices = await fetchCoinGeckoPrices(chain, missingAddresses);

  return { ...llamaPrices, ...geckoprices };
}

/**
 * Upgrade logo URLs to blob-cached URLs for a list of tokens
 * If blob storage isn't available, returns tokens unchanged
 */
async function upgradeToBlobUrls(tokens: TokenBalance[]): Promise<TokenBalance[]> {
  // If blob storage isn't configured, skip upgrading
  if (!isBlobStorageAvailable()) {
    return tokens;
  }

  // Find tokens with non-blob logo URLs
  const tokensNeedingUpgrade = tokens.filter(
    (t) => t.logoUrl && !t.logoUrl.includes("blob.vercel-storage.com"),
  );

  if (tokensNeedingUpgrade.length === 0) {
    return tokens;
  }

  console.log(`[EVM Balances] Checking blob cache for ${tokensNeedingUpgrade.length} logo URLs`);

  // Check blob cache for all URLs in parallel
  const blobChecks = await Promise.all(
    tokensNeedingUpgrade.map(async (token) => {
      const originalUrl = token.logoUrl;
      if (!originalUrl) return { contractAddress: token.contractAddress, blobUrl: null };

      const urlHash = crypto.createHash("md5").update(originalUrl).digest("hex");
      // FAIL-FAST: Extension must be determinable for blob storage
      const extension = getExtensionFromUrl(originalUrl);
      if (!extension) {
        throw new Error(`Unable to determine extension for URL: ${originalUrl}`);
      }
      const blobPath = `token-images/${urlHash}.${extension}`;
      const existing = await head(blobPath);

      if (existing) {
        return {
          contractAddress: token.contractAddress,
          blobUrl: existing.url,
        };
      }

      // Try to cache the image now
      const cachedUrl = await cacheImageToBlob(originalUrl);
      return { contractAddress: token.contractAddress, blobUrl: cachedUrl };
    }),
  );

  // Build a map of contract address -> blob URL
  const blobUrlMap: Record<string, string> = {};
  for (const { contractAddress, blobUrl } of blobChecks) {
    if (blobUrl) {
      blobUrlMap[contractAddress.toLowerCase()] = blobUrl;
    }
  }

  console.log(`[EVM Balances] Found/cached ${Object.keys(blobUrlMap).length} blob URLs`);

  // Update tokens with blob URLs
  return tokens.map((token) => {
    const blobUrl = blobUrlMap[token.contractAddress.toLowerCase()];
    if (blobUrl) {
      return { ...token, logoUrl: blobUrl };
    }
    return token;
  });
}

/**
 * GET /api/evm-balances?address=0x...&chain=base&refresh=true
 * Fetches EVM token balances with logo enrichment
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const parseResult = GetEvmBalancesQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  const { address, chain } = query;
  const forceRefresh = searchParams.get("refresh") === "true";

  if (!CHAIN_CONFIG[chain]) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  // Local development: use Anvil RPC and known local deployments.
  // This avoids requiring Alchemy for local E2E and keeps token selection deterministic.
  if (getNetwork() === "local") {
    const tokens = await fetchLocalWalletBalances(address);
    return NextResponse.json({ tokens });
  }

  // Check wallet cache first (15 minute TTL) unless force refresh
  if (!forceRefresh) {
    const cachedTokens = await getCachedWalletBalances(chain, address);
    if (cachedTokens) {
      console.log(`[EVM Balances] Using cached wallet data (${cachedTokens.length} tokens)`);

      // Upgrade cached tokens to blob URLs if needed
      let upgradedTokens = await upgradeToBlobUrls(cachedTokens);

      // Enrich cached tokens missing logos (best-effort, limit 5 per request)
      const tokensNeedingLogos = upgradedTokens.filter((t) => !t.logoUrl);
      if (tokensNeedingLogos.length > 0) {
        console.log(
          `[EVM Balances] ${tokensNeedingLogos.length} cached tokens missing logos, enriching up to 5 (multi-source)`,
        );

        // FAIL-FAST: Alchemy key required for logo enrichment
        const alchemyKey =
          process.env.ALCHEMY_API_KEY !== undefined
            ? process.env.ALCHEMY_API_KEY
            : process.env.NEXT_PUBLIC_ALCHEMY_API_KEY !== undefined
              ? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
              : undefined;
        if (!alchemyKey) {
          // Skip logo enrichment if no key - not critical for cached tokens
          console.warn("[EVM Balances] No Alchemy key for logo enrichment");
        } else {
          const config = CHAIN_CONFIG[chain];
          const alchemyUrl = `https://${config.alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;

          // Limit to 5 tokens per request to keep response fast
          const toEnrich = tokensNeedingLogos.slice(0, 5);
          const logoResults = await Promise.all(
            toEnrich.map(async (token) => {
              // Use multi-source logo fetch (Alchemy -> TrustWallet -> CoinGecko)
              const logo = await fetchLogoFromMultipleSources(
                token.contractAddress,
                chain,
                alchemyUrl,
              );
              return { contractAddress: token.contractAddress, logo };
            }),
          );

          // Apply logos to tokens
          const logoMap: Record<string, string> = {};
          for (const { contractAddress, logo } of logoResults) {
            if (logo) {
              logoMap[contractAddress.toLowerCase()] = logo;
            }
          }

          if (Object.keys(logoMap).length > 0) {
            upgradedTokens = upgradedTokens.map((t) => {
              const logo = logoMap[t.contractAddress.toLowerCase()];
              if (logo) {
                return { ...t, logoUrl: logo };
              }
              return t;
            });
          }
        }
      }

      // If any tokens were upgraded, update the cache
      const hasUpgrades = upgradedTokens.some((t, i) => t.logoUrl !== cachedTokens[i].logoUrl);
      if (hasUpgrades) {
        console.log(
          `[EVM Balances] Updating wallet cache with ${upgradedTokens.filter((t) => t.logoUrl).length} logos`,
        );
        // Background cache write - don't await (non-critical)
        // Fail-fast: errors will propagate but won't block response
        setCachedWalletBalances(chain, address, upgradedTokens);
      }

      return NextResponse.json({ tokens: upgradedTokens });
    }
  } else {
    console.log("[EVM Balances] Force refresh requested");
  }

  // FAIL-FAST: Alchemy key is required for fetching balances
  // Alchemy key can come from either env var (check both)
  const alchemyKeyEnv = process.env.ALCHEMY_API_KEY;
  const alchemyKeyPublic = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  const alchemyKey = alchemyKeyEnv ?? alchemyKeyPublic;

  if (!alchemyKey) {
    throw new Error("ALCHEMY_API_KEY is required - add to .env");
  }

  console.log("[EVM Balances] Using Alchemy API");
  const tokens = await fetchAlchemyBalances(address, chain, alchemyKey);

  if (tokens.length === 0) {
    return NextResponse.json({ tokens: [] });
  }

  // Get bulk price cache (single fast lookup)
  const cachedPrices = await getBulkPriceCache(chain);
  const tokensNeedingPrices = tokens.filter((t) => !t.priceUsd);
  const uncachedAddresses: string[] = [];

  // Apply cached prices first
  for (const token of tokensNeedingPrices) {
    const cachedPrice = cachedPrices[token.contractAddress.toLowerCase()];
    if (cachedPrice !== undefined) {
      token.priceUsd = cachedPrice;
    } else {
      uncachedAddresses.push(token.contractAddress);
    }
  }

  console.log(
    `[EVM Balances] ${Object.keys(cachedPrices).length} prices cached, ${uncachedAddresses.length} need fetch`,
  );

  // Fetch uncached prices (DeFiLlama + CoinGecko)
  if (uncachedAddresses.length > 0) {
    const newPrices = await fetchPrices(chain, uncachedAddresses);
    for (const token of tokensNeedingPrices) {
      if (!token.priceUsd) {
        // Price is optional - tokens without prices are still valid
        const priceEntry = newPrices[token.contractAddress.toLowerCase()];
        const price = typeof priceEntry === "number" ? priceEntry : 0;
        token.priceUsd = price;
      }
    }

    // Merge new prices with cached and save (fire-and-forget)
    const allPrices = { ...cachedPrices };
    for (const [addr, price] of Object.entries(newPrices)) {
      if (price > 0) {
        allPrices[addr.toLowerCase()] = price;
      }
    }
    // Merge with existing to handle concurrent requests
    const existing = await getBulkPriceCache(chain);
    const merged = { ...existing, ...allPrices };
    await setBulkPriceCache(chain, merged);
  }

  // Calculate USD values
  for (const token of tokens) {
    if (!token.balanceUsd && token.priceUsd) {
      const humanBalance = Number(BigInt(token.balance)) / 10 ** token.decimals;
      token.balanceUsd = humanBalance * token.priceUsd;
    }
  }

  // Filter only obvious dust - show tokens without prices too
  const filteredTokens = tokens.filter((t) => {
    const humanBalance = Number(BigInt(t.balance)) / 10 ** t.decimals;
    // balanceUsd is optional - use 0 if not set
    const balanceUsd = typeof t.balanceUsd === "number" ? t.balanceUsd : 0;
    const hasPrice = t.priceUsd && t.priceUsd > 0;

    // If we have a price, use minimal USD filter
    if (hasPrice && balanceUsd < MIN_VALUE_USD) {
      return false;
    }
    // Always require at least 1 token
    return humanBalance >= MIN_TOKEN_BALANCE;
  });

  // Sort: priced tokens first (by USD value), then unpriced tokens (by balance)
  filteredTokens.sort((a, b) => {
    const aHasPrice = a.priceUsd && a.priceUsd > 0;
    const bHasPrice = b.priceUsd && b.priceUsd > 0;

    // Priced tokens come first
    if (aHasPrice && !bHasPrice) return -1;
    if (!aHasPrice && bHasPrice) return 1;

    // Both priced: sort by USD value
    if (aHasPrice && bHasPrice) {
      // balanceUsd is optional - use 0 if not set
      const aBalanceUsd = typeof a.balanceUsd === "number" ? a.balanceUsd : 0;
      const bBalanceUsd = typeof b.balanceUsd === "number" ? b.balanceUsd : 0;
      return bBalanceUsd - aBalanceUsd;
    }

    // Both unpriced: sort by token balance
    const aBalance = Number(BigInt(a.balance)) / 10 ** a.decimals;
    const bBalance = Number(BigInt(b.balance)) / 10 ** b.decimals;
    return bBalance - aBalance;
  });

  console.log(
    `[EVM Balances] ${tokens.length} total -> ${filteredTokens.length} after dust filter`,
  );

  // Cache the result for 15 minutes
  await setCachedWalletBalances(chain, address, filteredTokens);

  const response = { tokens: filteredTokens };
  const validatedResponse = EvmBalancesResponseSchema.parse(response);

  // Cache for 60 seconds - balances can change but short cache is fine for UX
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
