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

async function getCachedMetadata(chain: string, address: string): Promise<CachedTokenMetadata | null> {
  try {
    const runtime = await agentRuntime.getRuntime();
    return await runtime.getCache<CachedTokenMetadata>(`evm-metadata:${chain}:${address.toLowerCase()}`);
  } catch {
    return null;
  }
}

async function setCachedMetadata(chain: string, address: string, metadata: CachedTokenMetadata): Promise<void> {
  try {
    const runtime = await agentRuntime.getRuntime();
    await runtime.setCache(`evm-metadata:${chain}:${address.toLowerCase()}`, metadata);
  } catch {
    // Ignore
  }
}

// Price cache TTL: 5 minutes
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

// Wallet balance cache TTL: 30 seconds (for immediate repeated calls)
const WALLET_CACHE_TTL_MS = 30 * 1000;

interface CachedWalletBalances {
  tokens: TokenBalance[];
  cachedAt: number;
}

async function getCachedWalletBalances(chain: string, address: string): Promise<TokenBalance[] | null> {
  try {
    const runtime = await agentRuntime.getRuntime();
    const cached = await runtime.getCache<CachedWalletBalances>(`evm-wallet:${chain}:${address.toLowerCase()}`);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt >= WALLET_CACHE_TTL_MS) return null;
    console.log(`[EVM Balances] Using cached wallet data (${cached.tokens.length} tokens)`);
    return cached.tokens;
  } catch {
    return null;
  }
}

async function setCachedWalletBalances(chain: string, address: string, tokens: TokenBalance[]): Promise<void> {
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
 * Cache an image URL to Vercel Blob storage
 * Returns the cached blob URL, or null if caching fails
 */
async function cacheImageToBlob(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  
  // Skip if already a blob URL
  if (imageUrl.includes("blob.vercel-storage.com")) {
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
      return null;
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
  } catch {
    return null;
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
const CHAIN_CONFIG: Record<string, { alchemyNetwork: string; coingeckoPlatform: string }> = {
  base: {
    alchemyNetwork: "base-mainnet",
    coingeckoPlatform: "base",
  },
  bsc: {
    alchemyNetwork: "bnb-mainnet",
    coingeckoPlatform: "binance-smart-chain",
  },
};

interface CachedPrice {
  priceUsd: number;
  cachedAt: number;
}

async function getCachedPrice(chain: string, address: string): Promise<number | null> {
  try {
    const runtime = await agentRuntime.getRuntime();
    const cached = await runtime.getCache<CachedPrice>(`token-price:${chain}:${address.toLowerCase()}`);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt >= PRICE_CACHE_TTL_MS) return null;
    return cached.priceUsd;
  } catch {
    return null;
  }
}

async function setCachedPrice(chain: string, address: string, priceUsd: number): Promise<void> {
  try {
    const runtime = await agentRuntime.getRuntime();
    await runtime.setCache(`token-price:${chain}:${address.toLowerCase()}`, {
      priceUsd,
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
  apiKey: string
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
      console.error("[EVM Balances] getTokenBalances failed:", balancesResponse.status);
      return [];
    }

    const balancesData = await balancesResponse.json();
    
    if (balancesData.error) {
      console.error("[EVM Balances] Alchemy error:", balancesData.error.message);
      return [];
    }

    const tokenBalances = balancesData.result?.tokenBalances || [];
    
    // Filter non-zero balances
    const nonZeroBalances = tokenBalances.filter((t: { tokenBalance: string }) => {
      const bal = t.tokenBalance;
      return bal && bal !== "0x0" && bal !== "0x" && BigInt(bal) > 0n;
    });

    console.log(`[EVM Balances] Found ${nonZeroBalances.length} tokens with balance > 0`);

    if (nonZeroBalances.length === 0) return [];

    // Step 2: Check metadata cache (parallel lookups)
    const cacheResults = await Promise.all(
      nonZeroBalances.map(async (t: { contractAddress: string }) => ({
        addr: t.contractAddress.toLowerCase(),
        cached: await getCachedMetadata(chain, t.contractAddress.toLowerCase()),
      }))
    );
    
    const cachedMetadata: Record<string, CachedTokenMetadata> = {};
    const needsMetadata: string[] = [];
    
    for (const { addr, cached } of cacheResults) {
      if (cached) {
        cachedMetadata[addr] = cached;
      } else {
        needsMetadata.push(addr);
      }
    }
    
    console.log(`[EVM Balances] ${Object.keys(cachedMetadata).length} cached, ${needsMetadata.length} need metadata`);

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
              
              // Cache permanently
              setCachedMetadata(chain, contractAddress, metadata);
              
              // Fire-and-forget image caching
              if (result.logo) {
                cacheImageToBlob(result.logo).catch(() => {});
              }
              
              return { contractAddress, metadata };
            }
          } catch {}
          
          return { 
            contractAddress, 
            metadata: { symbol: "ERC20", name: "Unknown Token", decimals: 18 } 
          };
        })
      );
      
      for (const { contractAddress, metadata } of metadataResults) {
        cachedMetadata[contractAddress] = metadata;
      }
    }

    // Step 4: Build token list
    const tokens: TokenBalance[] = nonZeroBalances.map((tokenData: { contractAddress: string; tokenBalance: string }) => {
      const contractAddress = tokenData.contractAddress.toLowerCase();
      const balance = BigInt(tokenData.tokenBalance).toString();
      const metadata = cachedMetadata[contractAddress] || { symbol: "ERC20", name: "Unknown", decimals: 18 };
      
      return {
        contractAddress,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        balance,
        logoUrl: metadata.logoUrl,
      };
    });

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
  addresses: string[]
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};
  
  // DeFiLlama chain identifiers
  const llamaChain = chain === "base" ? "base" : chain === "bsc" ? "bsc" : chain;
  
  try {
    // DeFiLlama accepts comma-separated list of chain:address
    const coins = addresses.map(a => `${llamaChain}:${a}`).join(",");
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
    
    console.log(`[EVM Balances] DeFiLlama returned ${Object.keys(prices).length} prices`);
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
  addresses: string[]
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
    
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    
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
  addresses: string[]
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};
  
  // Try DeFiLlama first (better coverage for newer tokens)
  const llamaPrices = await fetchDeFiLlamaPrices(chain, addresses);
  
  // Find addresses still missing prices
  const missingAddresses = addresses.filter(a => !llamaPrices[a.toLowerCase()]);
  
  if (missingAddresses.length === 0) {
    return llamaPrices;
  }
  
  // Try CoinGecko for remaining
  const geckoprices = await fetchCoinGeckoPrices(chain, missingAddresses);
  
  return { ...llamaPrices, ...geckoprices };
}

/**
 * GET /api/evm-balances?address=0x...&chain=base
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const chain = request.nextUrl.searchParams.get("chain") || "base";

  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  if (!CHAIN_CONFIG[chain]) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  try {
    // Check wallet cache first (30 second TTL)
    const cachedTokens = await getCachedWalletBalances(chain, address);
    if (cachedTokens) {
      return NextResponse.json({ tokens: cachedTokens });
    }
    
    const alchemyKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    
    if (!alchemyKey) {
      console.error("[EVM Balances] ALCHEMY_API_KEY is required - add to .env");
      return NextResponse.json({ 
        tokens: [], 
        error: "ALCHEMY_API_KEY required" 
      });
    }
    
    console.log("[EVM Balances] Using Alchemy API");
    const tokens = await fetchAlchemyBalances(address, chain, alchemyKey);

    if (tokens.length === 0) {
      return NextResponse.json({ tokens: [] });
    }

    // Fetch prices for tokens that don't have them
    const tokensNeedingPrices = tokens.filter(t => !t.priceUsd);
    if (tokensNeedingPrices.length > 0) {
      // Check price cache (parallel lookups)
      const priceCacheResults = await Promise.all(
        tokensNeedingPrices.map(async t => ({
          addr: t.contractAddress,
          cached: await getCachedPrice(chain, t.contractAddress),
        }))
      );
      
      const uncachedAddresses: string[] = [];
      for (const { addr, cached } of priceCacheResults) {
        const token = tokensNeedingPrices.find(t => t.contractAddress === addr);
        if (token) {
          if (cached !== null) {
            token.priceUsd = cached;
          } else {
            uncachedAddresses.push(addr);
          }
        }
      }
      
      // Fetch uncached prices (DeFiLlama + CoinGecko)
      if (uncachedAddresses.length > 0) {
        const prices = await fetchPrices(chain, uncachedAddresses);
        for (const token of tokensNeedingPrices) {
          if (!token.priceUsd) {
            const price = prices[token.contractAddress.toLowerCase()] || 0;
            token.priceUsd = price;
            // Fire-and-forget price caching
            if (price > 0) {
              setCachedPrice(chain, token.contractAddress, price);
            }
          }
        }
      }
    }

    // Calculate USD values
    for (const token of tokens) {
      if (!token.balanceUsd && token.priceUsd) {
        const humanBalance = Number(BigInt(token.balance)) / Math.pow(10, token.decimals);
        token.balanceUsd = humanBalance * token.priceUsd;
      }
    }

    // Filter only obvious dust - show tokens without prices too
    const filteredTokens = tokens.filter(t => {
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

    console.log(`[EVM Balances] ${tokens.length} total -> ${filteredTokens.length} after dust filter`);

    // Cache the result for 30 seconds
    await setCachedWalletBalances(chain, address, filteredTokens);

    return NextResponse.json({ tokens: filteredTokens });
  } catch (error) {
    console.error("[EVM Balances] Error:", error);
    return NextResponse.json({ tokens: [] });
  }
}

