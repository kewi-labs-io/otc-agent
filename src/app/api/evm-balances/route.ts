import { NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { put, head } from "@vercel/blob";
import crypto from "crypto";

interface TokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  logoUrl?: string;
  priceUsd?: number;
  balanceUsd?: number;
}

// Metadata cache (permanent - token metadata doesn't change)
interface CachedTokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

// Bulk metadata cache - stores all known metadata per chain in one key
interface BulkMetadataCache {
  metadata: Record<string, CachedTokenMetadata>;
}

async function getBulkMetadataCache(
  chain: string,
): Promise<Record<string, CachedTokenMetadata>> {
  try {
    const runtime = await agentRuntime.getRuntime();
    const cached = await runtime.getCache<BulkMetadataCache>(
      `evm-metadata-bulk:${chain}`,
    );
    return cached?.metadata || {};
  } catch {
    return {};
  }
}

async function setBulkMetadataCache(
  chain: string,
  metadata: Record<string, CachedTokenMetadata>,
): Promise<void> {
  try {
    const runtime = await agentRuntime.getRuntime();
    await runtime.setCache(`evm-metadata-bulk:${chain}`, { metadata });
  } catch {
    // Ignore
  }
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
  try {
    const runtime = await agentRuntime.getRuntime();
    const cached = await runtime.getCache<CachedWalletBalances>(
      `evm-wallet:${chain}:${address.toLowerCase()}`,
    );
    if (!cached) return null;
    if (Date.now() - cached.cachedAt >= WALLET_CACHE_TTL_MS) return null;
    console.log(
      `[EVM Balances] Using cached wallet data (${cached.tokens.length} tokens)`,
    );
    return cached.tokens;
  } catch {
    return null;
  }
}

async function setCachedWalletBalances(
  chain: string,
  address: string,
  tokens: TokenBalance[],
): Promise<void> {
  try {
    const runtime = await agentRuntime.getRuntime();
    await runtime.setCache(`evm-wallet:${chain}:${address.toLowerCase()}`, {
      tokens,
      cachedAt: Date.now(),
    });
  } catch {
    // Ignore
  }
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
async function cacheImageToBlob(
  imageUrl: string | null,
): Promise<string | null> {
  if (!imageUrl) return null;

  // Skip if already a blob URL
  if (imageUrl.includes("blob.vercel-storage.com")) {
    return imageUrl;
  }

  // If blob storage isn't configured, return original URL
  if (!isBlobStorageAvailable()) {
    return imageUrl;
  }

  try {
    const urlHash = crypto.createHash("md5").update(imageUrl).digest("hex");
    const extension = getExtensionFromUrl(imageUrl) || "png";
    const blobPath = `token-images/${urlHash}.${extension}`;

    // Check if already cached in blob storage
    const existing = await head(blobPath).catch(() => null);
    if (existing) {
      return existing.url;
    }

    // Download image
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "OTC-Desk/1.0" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return imageUrl; // Return original on download failure
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const imageBuffer = await response.arrayBuffer();

    const blob = await put(blobPath, imageBuffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return blob.url;
  } catch (err) {
    console.log("[EVM Balances] Image caching failed, using original URL:", err);
    return imageUrl; // Return original URL as fallback
  }
}

function getExtensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (match) {
      const ext = match[1].toLowerCase();
      if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
        return ext;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Minimum thresholds to filter obvious dust
// Very permissive - we want to show new tokens without prices
const MIN_TOKEN_BALANCE = 1; // At least 1 token (human-readable)
const MIN_VALUE_USD = 0.001; // $0.001 minimum if we have a price (basically nothing)

// Chain configs
const CHAIN_CONFIG: Record<
  string,
  { alchemyNetwork: string; coingeckoPlatform: string }
> = {
  ethereum: {
    alchemyNetwork: "eth-mainnet",
    coingeckoPlatform: "ethereum",
  },
  base: {
    alchemyNetwork: "base-mainnet",
    coingeckoPlatform: "base",
  },
  bsc: {
    alchemyNetwork: "bnb-mainnet",
    coingeckoPlatform: "binance-smart-chain",
  },
};

// Bulk price cache - stores all prices per chain in one key
interface BulkPriceCache {
  prices: Record<string, number>;
  cachedAt: number;
}

async function getBulkPriceCache(
  chain: string,
): Promise<Record<string, number>> {
  try {
    const runtime = await agentRuntime.getRuntime();
    const cached = await runtime.getCache<BulkPriceCache>(
      `evm-prices-bulk:${chain}`,
    );
    if (!cached) return {};
    if (Date.now() - cached.cachedAt >= PRICE_CACHE_TTL_MS) return {};
    console.log(
      `[EVM Balances] Using cached prices (${Object.keys(cached.prices).length} tokens)`,
    );
    return cached.prices;
  } catch {
    return {};
  }
}

async function setBulkPriceCache(
  chain: string,
  prices: Record<string, number>,
): Promise<void> {
  try {
    const runtime = await agentRuntime.getRuntime();
    await runtime.setCache(`evm-prices-bulk:${chain}`, {
      prices,
      cachedAt: Date.now(),
    });
  } catch {
    // Ignore
  }
}

/**
 * Fetch token balances using Alchemy's getTokenBalances + cached metadata
 */
async function fetchAlchemyBalances(
  address: string,
  chain: string,
  apiKey: string,
): Promise<TokenBalance[]> {
  const config = CHAIN_CONFIG[chain];
  if (!config) return [];

  const url = `https://${config.alchemyNetwork}.g.alchemy.com/v2/${apiKey}`;

  try {
    // Step 1: Get all token balances (fast, single call)
    const balancesResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getTokenBalances",
        params: [address, "erc20"],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!balancesResponse.ok) {
      console.error(
        "[EVM Balances] getTokenBalances failed:",
        balancesResponse.status,
      );
      return [];
    }

    const balancesData = await balancesResponse.json();

    if (balancesData.error) {
      console.error(
        "[EVM Balances] Alchemy error:",
        balancesData.error.message,
      );
      return [];
    }

    const tokenBalances = balancesData.result?.tokenBalances || [];

    // Filter non-zero balances
    const nonZeroBalances = tokenBalances.filter(
      (t: { tokenBalance: string }) => {
        const bal = t.tokenBalance;
        return bal && bal !== "0x0" && bal !== "0x" && BigInt(bal) > 0n;
      },
    );

    console.log(
      `[EVM Balances] Found ${nonZeroBalances.length} tokens with balance > 0`,
    );

    if (nonZeroBalances.length === 0) return [];

    // Step 2: Get bulk metadata cache (single fast lookup)
    const bulkCache = await getBulkMetadataCache(chain);
    const cachedMetadata: Record<string, CachedTokenMetadata> = {
      ...bulkCache,
    };
    const needsMetadata: string[] = [];

    for (const t of nonZeroBalances) {
      const addr = (
        t as { contractAddress: string }
      ).contractAddress.toLowerCase();
      if (!cachedMetadata[addr]) {
        needsMetadata.push(addr);
      }
    }

    console.log(
      `[EVM Balances] ${Object.keys(cachedMetadata).length} cached, ${needsMetadata.length} need metadata`,
    );

    // Step 3: Fetch metadata for uncached tokens (parallel, fast)
    if (needsMetadata.length > 0) {
      const metadataResults = await Promise.all(
        needsMetadata.map(async (contractAddress) => {
          try {
            const metaRes = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "alchemy_getTokenMetadata",
                params: [contractAddress],
              }),
              signal: AbortSignal.timeout(5000),
            });

            if (metaRes.ok) {
              const metaData = await metaRes.json();
              const result = metaData.result || {};

              const metadata: CachedTokenMetadata = {
                symbol: result.symbol || "ERC20",
                name: result.name || "Unknown Token",
                decimals: result.decimals || 18,
                logoUrl: result.logo || undefined,
              };

              console.log(`[EVM Balances] Token ${result.symbol}: logo=${result.logo ? 'yes' : 'no'}`);
              return { contractAddress, metadata };
            }
          } catch {
            // Network/timeout errors when fetching metadata - use fallback
          }

          return {
            contractAddress,
            metadata: { symbol: "ERC20", name: "Unknown Token", decimals: 18 },
          };
        }),
      );

      for (const { contractAddress, metadata } of metadataResults) {
        cachedMetadata[contractAddress] = metadata;
      }

      // Update bulk cache with new metadata (merge with existing to handle concurrent requests)
      getBulkMetadataCache(chain)
        .then((existing) => {
          const merged = { ...existing, ...cachedMetadata };
          setBulkMetadataCache(chain, merged).catch((err) => {
            console.debug("[EVM Balances] Cache write failed (non-critical):", err);
          });
        })
        .catch((err) => {
          console.debug("[EVM Balances] Cache read failed (non-critical):", err);
        });
    }

    // Step 3.5: Check blob cache for all logo URLs and cache missing ones
    // Skip if blob storage isn't configured
    if (isBlobStorageAvailable()) {
      const logoUrls = Object.values(cachedMetadata)
        .map((m) => m.logoUrl)
        .filter((url): url is string => !!url && !url.includes("blob.vercel-storage.com"));

      const blobUrlMap: Record<string, string> = {};
      if (logoUrls.length > 0) {
        console.log(`[EVM Balances] Checking blob cache for ${logoUrls.length} logo URLs`);
        
        const blobChecks = await Promise.all(
          logoUrls.map(async (originalUrl) => {
            const urlHash = crypto.createHash("md5").update(originalUrl).digest("hex");
            const extension = getExtensionFromUrl(originalUrl) || "png";
            const blobPath = `token-images/${urlHash}.${extension}`;
            const existing = await head(blobPath).catch(() => null);
            
            if (existing) {
              return { originalUrl, blobUrl: existing.url };
            }
            
            // Try to cache the image now (with timeout to not slow down response too much)
            const cachedUrl = await cacheImageToBlob(originalUrl);
            return { originalUrl, blobUrl: cachedUrl };
          }),
        );

        for (const { originalUrl, blobUrl } of blobChecks) {
          if (blobUrl) {
            blobUrlMap[originalUrl] = blobUrl;
          }
        }
        
        console.log(`[EVM Balances] Found/cached ${Object.keys(blobUrlMap).length} blob URLs`);

        // Update metadata cache with blob URLs for faster future lookups
        let metadataUpdated = false;
        for (const [addr, metadata] of Object.entries(cachedMetadata)) {
          if (metadata.logoUrl && blobUrlMap[metadata.logoUrl]) {
            cachedMetadata[addr] = { ...metadata, logoUrl: blobUrlMap[metadata.logoUrl] };
            metadataUpdated = true;
          }
        }
        
        // Re-save metadata cache with blob URLs
        if (metadataUpdated) {
          getBulkMetadataCache(chain)
            .then((existing) => {
              const merged = { ...existing, ...cachedMetadata };
              setBulkMetadataCache(chain, merged).catch((err) => {
                console.debug("[EVM Balances] Blob cache write failed:", err);
              });
            })
            .catch((err) => {
              console.debug("[EVM Balances] Blob cache read failed:", err);
            });
        }
      }
    }

    // Step 4: Build token list (metadata already has blob-cached logo URLs)
    const tokens: TokenBalance[] = nonZeroBalances.map(
      (tokenData: { contractAddress: string; tokenBalance: string }) => {
        const contractAddress = tokenData.contractAddress.toLowerCase();
        const balance = BigInt(tokenData.tokenBalance).toString();
        const metadata = cachedMetadata[contractAddress] || {
          symbol: "ERC20",
          name: "Unknown",
          decimals: 18,
        };

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
  } catch (error) {
    console.error("[EVM Balances] Alchemy error:", error);
    return [];
  }
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
  const llamaChain =
    chain === "base" ? "base" : chain === "bsc" ? "bsc" : chain;

  try {
    // DeFiLlama accepts comma-separated list of chain:address
    const coins = addresses.map((a) => `${llamaChain}:${a}`).join(",");
    const url = `https://coins.llama.fi/prices/current/${coins}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      console.log("[EVM Balances] DeFiLlama API error:", response.status);
      return {};
    }

    const data = await response.json();
    const prices: Record<string, number> = {};

    // Response format: { coins: { "chain:address": { price: number, ... } } }
    if (data.coins) {
      for (const [key, priceData] of Object.entries(data.coins)) {
        const address = key.split(":")[1]?.toLowerCase();
        const price = (priceData as { price?: number })?.price;
        if (address && typeof price === "number" && price > 0) {
          prices[address] = price;
        }
      }
    }

    console.log(
      `[EVM Balances] DeFiLlama returned ${Object.keys(prices).length} prices`,
    );
    return prices;
  } catch (error) {
    console.error("[EVM Balances] DeFiLlama error:", error);
    return {};
  }
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

  try {
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

    const data = await response.json();
    const prices: Record<string, number> = {};

    for (const [address, priceData] of Object.entries(data)) {
      const usd = (priceData as { usd?: number })?.usd;
      if (typeof usd === "number") {
        prices[address.toLowerCase()] = usd;
      }
    }

    return prices;
  } catch {
    return {};
  }
}

/**
 * Fetch prices - try DeFiLlama first, then CoinGecko
 */
async function fetchPrices(
  chain: string,
  addresses: string[],
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  // Try DeFiLlama first (better coverage for newer tokens)
  const llamaPrices = await fetchDeFiLlamaPrices(chain, addresses);

  // Find addresses still missing prices
  const missingAddresses = addresses.filter(
    (a) => !llamaPrices[a.toLowerCase()],
  );

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
    (t) => t.logoUrl && !t.logoUrl.includes("blob.vercel-storage.com")
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
      const extension = getExtensionFromUrl(originalUrl) || "png";
      const blobPath = `token-images/${urlHash}.${extension}`;
      const existing = await head(blobPath).catch(() => null);

      if (existing) {
        return { contractAddress: token.contractAddress, blobUrl: existing.url };
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
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const chain = request.nextUrl.searchParams.get("chain") || "base";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  if (!CHAIN_CONFIG[chain]) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  try {
    // Check wallet cache first (15 minute TTL) unless force refresh
    if (!forceRefresh) {
      const cachedTokens = await getCachedWalletBalances(chain, address);
      if (cachedTokens) {
        // Upgrade cached tokens to blob URLs if needed
        const upgradedTokens = await upgradeToBlobUrls(cachedTokens);
        
        // If any tokens were upgraded, update the cache
        const hasUpgrades = upgradedTokens.some((t, i) => t.logoUrl !== cachedTokens[i].logoUrl);
        if (hasUpgrades) {
          setCachedWalletBalances(chain, address, upgradedTokens).catch((err) => {
            console.debug("[EVM Balances] Failed to update wallet cache:", err);
          });
        }
        
        return NextResponse.json({ tokens: upgradedTokens });
      }
    } else {
      console.log("[EVM Balances] Force refresh requested");
    }

    const alchemyKey =
      process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

    if (!alchemyKey) {
      console.error("[EVM Balances] ALCHEMY_API_KEY is required - add to .env");
      return NextResponse.json({
        tokens: [],
        error: "ALCHEMY_API_KEY required",
      });
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
          const price = newPrices[token.contractAddress.toLowerCase()] || 0;
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
      getBulkPriceCache(chain)
        .then((existing) => {
          const merged = { ...existing, ...allPrices };
          setBulkPriceCache(chain, merged).catch((err) =>
            console.debug("[EVM Balances] Price cache write failed:", err),
          );
        })
        .catch((err) => {
          console.debug("[EVM Balances] Price cache read failed:", err);
        });
    }

    // Calculate USD values
    for (const token of tokens) {
      if (!token.balanceUsd && token.priceUsd) {
        const humanBalance =
          Number(BigInt(token.balance)) / Math.pow(10, token.decimals);
        token.balanceUsd = humanBalance * token.priceUsd;
      }
    }

    // Filter only obvious dust - show tokens without prices too
    const filteredTokens = tokens.filter((t) => {
      const humanBalance = Number(BigInt(t.balance)) / Math.pow(10, t.decimals);
      const balanceUsd = t.balanceUsd || 0;
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
        return (b.balanceUsd || 0) - (a.balanceUsd || 0);
      }

      // Both unpriced: sort by token balance
      const aBalance = Number(BigInt(a.balance)) / Math.pow(10, a.decimals);
      const bBalance = Number(BigInt(b.balance)) / Math.pow(10, b.decimals);
      return bBalance - aBalance;
    });

    console.log(
      `[EVM Balances] ${tokens.length} total -> ${filteredTokens.length} after dust filter`,
    );

    // Cache the result for 15 minutes
    await setCachedWalletBalances(chain, address, filteredTokens);

    // Cache for 60 seconds - balances can change but short cache is fine for UX
    return NextResponse.json(
      { tokens: filteredTokens },
      {
        headers: {
          "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    console.error("[EVM Balances] Error:", error);
    return NextResponse.json({ tokens: [] });
  }
}
