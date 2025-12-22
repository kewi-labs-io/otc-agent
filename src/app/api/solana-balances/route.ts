import crypto from "node:crypto";
import { type HeadBlobResult, head, put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { validationErrorResponse } from "@/lib/validation/helpers";
import type { CodexBalanceItem } from "@/types/api";
import {
  GetSolanaBalancesQuerySchema,
  SolanaBalancesResponseSchema,
} from "@/types/validation/api-schemas";

// Wallet balance cache TTL: 15 minutes
const WALLET_CACHE_TTL_MS = 15 * 60 * 1000;

// Price cache TTL: 15 minutes
const PRICE_CACHE_TTL_MS = 15 * 60 * 1000;

// Codex GraphQL endpoint and Solana network ID
const CODEX_GRAPHQL_URL = "https://graph.codex.io/graphql";
const SOLANA_NETWORK_ID = 1399811149;

// Bulk metadata cache for Solana tokens (permanent - metadata doesn't change)
interface SolanaMetadataCache {
  metadata: Record<string, { symbol: string; name: string; logoURI: string | null }>;
}

async function getSolanaMetadataCache(): Promise<
  Record<string, { symbol: string; name: string; logoURI: string | null }>
> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<SolanaMetadataCache>("solana-metadata-bulk");
  if (!cached || !cached.metadata) {
    return {};
  }
  return cached.metadata;
}

async function setSolanaMetadataCache(
  metadata: Record<string, { symbol: string; name: string; logoURI: string | null }>,
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache("solana-metadata-bulk", { metadata });
}

// Bulk price cache for Solana
interface SolanaPriceCache {
  prices: Record<string, number>;
  cachedAt: number;
}

async function getSolanaPriceCache(): Promise<Record<string, number>> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<SolanaPriceCache>("solana-prices-bulk");
  if (!cached) return {};
  if (Date.now() - cached.cachedAt >= PRICE_CACHE_TTL_MS) return {};
  console.log(
    `[Solana Balances] Using cached prices (${Object.keys(cached.prices).length} tokens)`,
  );
  return cached.prices;
}

async function setSolanaPriceCache(prices: Record<string, number>): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache("solana-prices-bulk", {
    prices,
    cachedAt: Date.now(),
  });
}

interface CachedWalletResponse {
  tokens: Array<{
    mint: string;
    amount: number;
    decimals: number;
    symbol: string;
    name: string;
    logoURI: string | null;
    priceUsd: number;
    balanceUsd: number;
  }>;
  cachedAt: number;
}

async function getCachedWalletResponse(
  address: string,
): Promise<CachedWalletResponse["tokens"] | null> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<CachedWalletResponse>(`solana-wallet:${address}`);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= WALLET_CACHE_TTL_MS) return null;
  console.log(`[Solana Balances] Using cached wallet data (${cached.tokens.length} tokens)`);
  return cached.tokens;
}

async function setCachedWalletResponse(
  address: string,
  tokens: CachedWalletResponse["tokens"],
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`solana-wallet:${address}`, {
    tokens,
    cachedAt: Date.now(),
  });
}

// Alternative IPFS gateways to try if main one fails
const IPFS_GATEWAYS = [
  "https://cloudflare-ipfs.com",
  "https://dweb.link",
  "https://gateway.pinata.cloud",
  "https://ipfs.io",
];

/**
 * Fetch image from IPFS or direct URL
 */
async function fetchWithIpfsGatewayFallback(imageUrl: string): Promise<Response> {
  // Extract IPFS hash from various URL formats
  let ipfsHash: string | null = null;

  // Match various IPFS URL patterns
  const patterns = [
    /ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/,
    /\.mypinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
    /cloudflare-ipfs\.com\/ipfs\/([a-zA-Z0-9]+)/,
    /dweb\.link\/ipfs\/([a-zA-Z0-9]+)/,
    /gateway\.pinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = imageUrl.match(pattern);
    if (match) {
      ipfsHash = match[1];
      break;
    }
  }

  if (ipfsHash) {
    const ipfsPath = `/ipfs/${ipfsHash}`;
    const gatewayUrl = `${IPFS_GATEWAYS[0]}${ipfsPath}`;
    const response = await fetch(gatewayUrl, {
      headers: { "User-Agent": "OTC-Desk/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`IPFS gateway failed: ${gatewayUrl} (status: ${response.status})`);
    }
    return response;
  }

  // For non-IPFS URLs, just fetch directly
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "OTC-Desk/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${imageUrl} (status: ${response.status})`);
  }
  return response;
}

/**
 * Cache an image URL to Vercel Blob storage
 */
async function cacheImageToBlob(imageUrl: string): Promise<string> {
  // Skip if already a blob URL
  if (imageUrl.includes("blob.vercel-storage.com")) {
    return imageUrl;
  }

  const urlHash = crypto.createHash("md5").update(imageUrl).digest("hex");
  const extension = getExtensionFromUrl(imageUrl);
  if (!extension) {
    throw new Error(`Unable to determine extension for URL: ${imageUrl}`);
  }
  const blobPath = `token-images/${urlHash}.${extension}`;

  let existing: HeadBlobResult | null;
  try {
    existing = await head(blobPath);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.toLowerCase().includes("not found")) {
      throw err;
    }
    existing = null;
  }

  if (existing) {
    console.log(`[Solana Balances] Image already cached: ${existing.url}`);
    return existing.url;
  }

  // Download with gateway fallback for IPFS
  const response = await fetchWithIpfsGatewayFallback(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${imageUrl} (status: ${response.status})`);
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

  console.log(`[Solana Balances] Cached image to blob: ${blob.url}`);
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

// CodexBalanceItem imported from @/types/api

/**
 * Fetch balances from local Solana RPC (for local testing)
 * Uses getTokenAccountsByOwner and getParsedAccountInfo for metadata
 */
async function fetchFromLocalRpc(walletAddress: string): Promise<CachedWalletResponse["tokens"]> {
  const localRpc = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  console.log(`[Solana Balances] Fetching from local RPC: ${localRpc}`);

  // Get all token accounts for the wallet
  const accountsResponse = await fetch(localRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        walletAddress,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!accountsResponse.ok) {
    throw new Error(`Local RPC failed: ${accountsResponse.status}`);
  }

  interface LocalTokenAccount {
    pubkey: string;
    account: {
      data: {
        parsed: {
          info: {
            mint: string;
            tokenAmount: {
              amount: string;
              decimals: number;
              uiAmount: number;
            };
          };
        };
      };
    };
  }

  interface LocalRpcResponse {
    result?: { value?: LocalTokenAccount[] };
    error?: { message: string };
  }

  const accountsData = (await accountsResponse.json()) as LocalRpcResponse;
  if (accountsData.error) {
    throw new Error(`Local RPC error: ${accountsData.error.message}`);
  }
  if (!accountsData.result?.value) {
    console.log("[Solana Balances] No token accounts found (empty wallet)");
    return [];
  }

  const accounts = accountsData.result.value;
  console.log(`[Solana Balances] Found ${accounts.length} token accounts`);

  // Convert to our format - for local tokens we don't have metadata
  const tokens = accounts
    .map((acc) => {
      const info = acc.account.data.parsed.info;
      const rawAmount = parseInt(info.tokenAmount.amount, 10);
      if (rawAmount === 0) return null;

      return {
        mint: info.mint,
        amount: rawAmount,
        decimals: info.tokenAmount.decimals,
        // For local tokens, use short mint address as symbol/name
        symbol: `${info.mint.slice(0, 4)}...${info.mint.slice(-4)}`,
        name: `Local Token ${info.mint.slice(0, 8)}`,
        logoURI: null,
        priceUsd: 0, // Local tokens don't have prices
        balanceUsd: 0,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  console.log(`[Solana Balances] Returning ${tokens.length} tokens with balance`);
  return tokens;
}

/**
 * Fetch balances from Codex API (faster, enriched data)
 */
async function fetchFromCodex(
  walletAddress: string,
  codexKey: string,
): Promise<CachedWalletResponse["tokens"]> {
  const query = `
    query GetBalances($input: BalancesInput!) {
      balances(input: $input) {
        items {
          balance
          balanceUsd
          shiftedBalance
          tokenAddress
          token {
            name
            symbol
            address
            decimals
            networkId
            info {
              imageSmallUrl
            }
          }
        }
      }
    }
  `;

  const response = await fetch(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: codexKey,
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          walletAddress,
          networks: [SOLANA_NETWORK_ID],
          includeNative: true,
          removeScams: true,
          limit: 100,
        },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Codex API HTTP error: ${response.status} ${response.statusText}`);
  }

  interface CodexGraphQLError {
    message: string;
    extensions?: Record<string, unknown>;
  }

  interface CodexResponse {
    errors?: CodexGraphQLError[];
    data?: { balances?: { items?: CodexBalanceItem[] } };
  }

  const data = (await response.json()) as CodexResponse;
  if (data.errors) {
    throw new Error(`Codex GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  if (!data.data) {
    throw new Error("Codex API response missing data field");
  }
  if (!data.data.balances) {
    throw new Error("Codex API response missing balances field");
  }
  const items = data.data.balances.items;
  if (!items || items.length === 0) {
    // Empty wallet is valid - return empty array
    return [];
  }

  console.log(`[Solana Balances] Codex returned ${items.length} tokens`);

  const tokens = items
    .map((item) => {
      if (!item.token) {
        throw new Error(`Codex item missing token metadata: ${item.tokenAddress}`);
      }
      const token = item.token;
      // For native SOL, use Wrapped SOL mint
      const mint =
        item.tokenAddress === "native"
          ? "So11111111111111111111111111111111111111112"
          : item.tokenAddress;

      if (typeof token.decimals !== "number") {
        throw new Error(`Token ${mint} missing decimals`);
      }
      if (!token.symbol || typeof token.symbol !== "string") {
        throw new Error(`Token ${mint} missing symbol`);
      }
      if (!token.name || typeof token.name !== "string") {
        throw new Error(`Token ${mint} missing name`);
      }

      return {
        mint,
        amount: parseInt(item.balance, 10),
        decimals: token.decimals,
        symbol: token.symbol,
        name: token.name,
        logoURI: token.info?.imageSmallUrl ? token.info.imageSmallUrl : null,
        priceUsd:
          item.balanceUsd && item.shiftedBalance > 0
            ? parseFloat(item.balanceUsd) / item.shiftedBalance
            : 0,
        balanceUsd: item.balanceUsd ? parseFloat(item.balanceUsd) : 0,
      };
    })
    .filter((t) => t.balanceUsd >= 0.01 || t.amount > 100 * 10 ** t.decimals)
    .sort((a, b) => {
      if (a.balanceUsd > 0 && b.balanceUsd > 0) return b.balanceUsd - a.balanceUsd;
      if (a.balanceUsd > 0) return -1;
      if (b.balanceUsd > 0) return 1;
      return b.amount - a.amount;
    });

  return tokens;
}

/**
 * Fetch Solana token balances with cached metadata
 * Tries Codex first, falls back to Helius
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const parseResult = GetSolanaBalancesQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  const heliusKey = process.env.HELIUS_API_KEY;
  const codexKey = process.env.CODEX_API_KEY;
  const { address: walletAddress } = query;
  const forceRefresh = searchParams.get("refresh") === "true";

  // Local mode: use local RPC directly (mainnet APIs won't see local tokens)
  const isLocalMode =
    process.env.NEXT_PUBLIC_NETWORK === "local" || process.env.NETWORK === "local";

  if (isLocalMode) {
    console.log("[Solana Balances] Local mode - using direct RPC");
    const localTokens = await fetchFromLocalRpc(walletAddress);
    const response = { tokens: localTokens, source: "local" as const };
    const validatedResponse = SolanaBalancesResponseSchema.parse(response);
    return NextResponse.json(validatedResponse);
  }

  // Check wallet cache first (15 minute TTL) unless force refresh
  if (!forceRefresh) {
    const cachedTokens = await getCachedWalletResponse(walletAddress);
    if (cachedTokens) {
      return NextResponse.json({ tokens: cachedTokens });
    }
  } else {
    console.log("[Solana Balances] Force refresh requested");
  }

  // FAIL-FAST: Require at least one API key
  if (!codexKey && !heliusKey) {
    throw new Error("Either CODEX_API_KEY or HELIUS_API_KEY must be configured");
  }

  if (codexKey) {
    console.log("[Solana Balances] Using Codex API...");
    const codexTokens = await fetchFromCodex(walletAddress, codexKey);
    if (codexTokens.length === 0) {
      // Empty wallet is valid - return empty tokens array
      const emptyResponse = { tokens: [], source: "codex" as const };
      const validatedEmpty = SolanaBalancesResponseSchema.parse(emptyResponse);
      return NextResponse.json(validatedEmpty);
    }
    console.log(`[Solana Balances] Codex returned ${codexTokens.length} tokens`);

    // Check blob cache for unreliable image URLs (parallel)
    const unreliableUrls = codexTokens
      .map((t) => t.logoURI)
      .filter(
        (url) =>
          url &&
          (url.includes("ipfs.io/ipfs/") ||
            url.includes("storage.auto.fun") ||
            url.includes(".mypinata.cloud")),
      ) as string[];

    const cachedBlobUrls: Record<string, string> = {};
    if (unreliableUrls.length > 0) {
      const blobChecks = await Promise.allSettled(
        unreliableUrls.map(async (url) => {
          const urlHash = crypto.createHash("md5").update(url).digest("hex");
          const extension = getExtensionFromUrl(url);
          if (!extension) {
            throw new Error(`Unable to determine extension for URL: ${url}`);
          }
          const blobPath = `token-images/${urlHash}.${extension}`;
          const existing = await head(blobPath);
          return { url, blobUrl: existing.url };
        }),
      );
      for (const result of blobChecks) {
        if (result.status === "fulfilled" && result.value.blobUrl) {
          cachedBlobUrls[result.value.url] = result.value.blobUrl;
        }
      }
    }
    console.log(`[Solana Balances] Found ${Object.keys(cachedBlobUrls).length} cached blob images`);

    // Upgrade tokens with cached blob URLs
    const enrichedTokens = codexTokens.map((token) => {
      const rawLogoUrl = token.logoURI;
      let logoURI: string | null = null;
      if (rawLogoUrl) {
        if (rawLogoUrl.includes("blob.vercel-storage.com")) {
          logoURI = rawLogoUrl;
        } else if (cachedBlobUrls[rawLogoUrl]) {
          logoURI = cachedBlobUrls[rawLogoUrl];
        } else if (
          !rawLogoUrl.includes("ipfs.io/ipfs/") &&
          !rawLogoUrl.includes("storage.auto.fun") &&
          !rawLogoUrl.includes(".mypinata.cloud")
        ) {
          logoURI = rawLogoUrl;
        }
      }

      return {
        ...token,
        logoURI,
      };
    });

    // Cache unreliable image URLs to blob storage (background, fire-and-forget)
    for (const token of codexTokens.slice(0, 30)) {
      const originalUrl = token.logoURI;
      if (
        originalUrl &&
        !originalUrl.includes("blob.vercel-storage.com") &&
        (originalUrl.includes("ipfs.io/ipfs/") ||
          originalUrl.includes("storage.auto.fun") ||
          originalUrl.includes(".mypinata.cloud")) &&
        !cachedBlobUrls[originalUrl]
      ) {
        // Cache image in background - don't await (non-critical)
        // Errors will propagate but won't block response
        cacheImageToBlob(originalUrl);
      }
    }

    await setCachedWalletResponse(walletAddress, enrichedTokens);
    const response = { tokens: enrichedTokens, source: "codex" as const };
    const validatedResponse = SolanaBalancesResponseSchema.parse(response);
    return NextResponse.json(validatedResponse);
  }

  // Use Helius (codexKey not available)
  if (!heliusKey) {
    throw new Error("HELIUS_API_KEY required when CODEX_API_KEY not available");
  }

  // Step 1: Get token balances from Helius (fast, single call)
  const balancesResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "balances",
      method: "getTokenAccountsByOwner",
      params: [
        walletAddress,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!balancesResponse.ok) {
    throw new Error(`Helius balances API failed: ${balancesResponse.status}`);
  }

  interface TokenAccount {
    pubkey: string;
    account: {
      data: {
        parsed: {
          info: {
            mint: string;
            tokenAmount: {
              amount: string;
              decimals: number;
              uiAmount: number;
            };
          };
        };
      };
    };
  }

  const balancesData = (await balancesResponse.json()) as {
    result?: { value?: TokenAccount[] };
  };
  if (!balancesData.result) {
    throw new Error("Helius balances API response missing result field");
  }
  if (!Array.isArray(balancesData.result.value)) {
    throw new Error("Helius balances API returned invalid response structure");
  }
  const accounts = balancesData.result.value;

  console.log(`[Solana Balances] RPC returned ${accounts.length} token accounts`);

  // Filter to tokens with balance > 0
  const tokensWithBalance = accounts
    .map((acc) => {
      const info = acc.account.data.parsed.info;
      const decimals = info.tokenAmount.decimals;
      if (!info.tokenAmount || !info.tokenAmount.amount) {
        throw new Error(`Token ${info.mint} missing amount in tokenAmount`);
      }
      const rawAmount = parseInt(info.tokenAmount.amount, 10);
      // Calculate humanBalance ourselves in case uiAmount is null
      const humanBalance =
        typeof info.tokenAmount.uiAmount === "number"
          ? info.tokenAmount.uiAmount
          : rawAmount / 10 ** decimals;
      return {
        mint: info.mint,
        amount: rawAmount,
        decimals,
        humanBalance,
      };
    })
    .filter((t) => t.amount > 0); // Any non-zero balance

  console.log(`[Solana Balances] Found ${tokensWithBalance.length} tokens with balance > 0`);

  if (tokensWithBalance.length === 0) {
    // Empty wallet is valid - return empty array
    const emptyResponse = { tokens: [] };
    const validatedEmpty = SolanaBalancesResponseSchema.parse(emptyResponse);
    return NextResponse.json(validatedEmpty);
  }

  // Step 2: Get metadata from cache first, then fetch missing from Helius
  interface HeliusAsset {
    id: string;
    content?: {
      metadata?: { name?: string; symbol?: string };
      links?: { image?: string };
    };
    token_info?: { symbol?: string; decimals?: number };
  }

  const allMints = tokensWithBalance.map((t) => t.mint);
  const cachedMetadata = await getSolanaMetadataCache();
  const metadata: Record<string, { symbol: string; name: string; logoURI: string | null }> = {
    ...cachedMetadata,
  };

  // Find mints that need metadata
  const mintsNeedingMetadata = allMints.filter((mint) => !metadata[mint]);
  console.log(
    `[Solana Balances] ${Object.keys(cachedMetadata).length} cached, ${mintsNeedingMetadata.length} need metadata`,
  );

  // Batch fetch metadata for uncached tokens (100 at a time)
  if (mintsNeedingMetadata.length > 0) {
    for (let i = 0; i < mintsNeedingMetadata.length; i += 100) {
      const batch = mintsNeedingMetadata.slice(i, i + 100);
      const metadataResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "metadata",
          method: "getAssetBatch",
          params: { ids: batch },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!metadataResponse.ok) {
        throw new Error(`Helius metadata fetch failed: ${metadataResponse.status}`);
      }

      interface HeliusMetadataResponse {
        result?: HeliusAsset[];
      }

      const data = (await metadataResponse.json()) as HeliusMetadataResponse;
      if (!data.result) {
        throw new Error("Helius metadata API response missing result field");
      }
      if (!Array.isArray(data.result)) {
        throw new Error("Helius metadata API returned invalid response structure");
      }
      const assets = data.result;
      for (const asset of assets) {
        if (!asset.id) {
          throw new Error("Helius asset missing id");
        }
        // Symbol can come from content.metadata or token_info - check both explicitly
        const contentSymbol =
          typeof asset.content?.metadata?.symbol === "string" &&
          asset.content.metadata.symbol.trim() !== ""
            ? asset.content.metadata.symbol
            : undefined;
        const tokenInfoSymbol =
          typeof asset.token_info?.symbol === "string" && asset.token_info.symbol.trim() !== ""
            ? asset.token_info.symbol
            : undefined;
        const symbol = contentSymbol ?? tokenInfoSymbol;
        if (!symbol) {
          throw new Error(`Helius asset ${asset.id} missing symbol`);
        }
        const name = asset.content?.metadata?.name;
        if (!name) {
          throw new Error(`Helius asset ${asset.id} missing name`);
        }
        // logoURI is optional - use null if not present
        const logoURI = asset.content?.links?.image ?? null;
        metadata[asset.id] = {
          symbol,
          name,
          logoURI,
        };
      }
    }

    // Update bulk metadata cache (merge with existing to handle concurrent requests)
    const existing = await getSolanaMetadataCache();
    const merged = { ...existing, ...metadata };
    await setSolanaMetadataCache(merged);
  }

  console.log(`[Solana Balances] Got metadata for ${Object.keys(metadata).length} tokens`);

  // Step 3: Get prices from cache first, then fetch missing from Jupiter
  const mints = tokensWithBalance.map((t) => t.mint);
  const cachedPrices = await getSolanaPriceCache();
  const prices: Record<string, number> = { ...cachedPrices };

  // Find mints that need prices
  const mintsNeedingPrices = mints.filter((mint) => prices[mint] === undefined);
  console.log(
    `[Solana Balances] ${Object.keys(cachedPrices).length} prices cached, ${mintsNeedingPrices.length} need fetch`,
  );

  // Jupiter price API - fetch in batches of 100
  if (mintsNeedingPrices.length > 0) {
    for (let i = 0; i < mintsNeedingPrices.length; i += 100) {
      const batch = mintsNeedingPrices.slice(i, i + 100);
      const priceResponse = await fetch(`https://api.jup.ag/price/v2?ids=${batch.join(",")}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!priceResponse.ok) {
        throw new Error(`Jupiter price fetch failed: ${priceResponse.status}`);
      }

      interface JupiterPriceData {
        price?: string;
      }

      interface JupiterResponse {
        data?: Record<string, JupiterPriceData>;
      }

      const priceData = (await priceResponse.json()) as JupiterResponse;
      if (!priceData.data) {
        throw new Error("Jupiter price response missing data");
      }

      for (const [mint, data] of Object.entries(priceData.data)) {
        const price = data.price;
        if (price) prices[mint] = parseFloat(price);
      }
    }

    // Update bulk price cache (merge with existing to handle concurrent requests)
    const existing = await getSolanaPriceCache();
    const merged = { ...existing, ...prices };
    await setSolanaPriceCache(merged);
  }
  console.log(`[Solana Balances] Have prices for ${Object.keys(prices).length} tokens`);

  // Step 4: Check blob cache for unreliable image URLs (parallel)
  const unreliableUrls = Object.values(metadata)
    .map((m) => m.logoURI)
    .filter(
      (url) =>
        url &&
        (url.includes("ipfs.io/ipfs/") ||
          url.includes("storage.auto.fun") ||
          url.includes(".mypinata.cloud")),
    ) as string[];

  const cachedBlobUrls: Record<string, string> = {};
  if (unreliableUrls.length > 0) {
    const blobChecks = await Promise.allSettled(
      unreliableUrls.map(async (url) => {
        const urlHash = crypto.createHash("md5").update(url).digest("hex");
        const extension = getExtensionFromUrl(url);
        if (!extension) {
          throw new Error(`Unable to determine extension for URL: ${url}`);
        }
        const blobPath = `token-images/${urlHash}.${extension}`;
        const existing = await head(blobPath);
        return { url, blobUrl: existing.url };
      }),
    );
    for (const result of blobChecks) {
      if (result.status === "fulfilled" && result.value.blobUrl) {
        cachedBlobUrls[result.value.url] = result.value.blobUrl;
      }
    }
  }
  console.log(`[Solana Balances] Found ${Object.keys(cachedBlobUrls).length} cached blob images`);

  // Step 5: Combine everything
  const tokensWithData = tokensWithBalance.map((token) => {
    const meta = metadata[token.mint];
    if (!meta) {
      throw new Error(
        `Metadata missing for token ${token.mint} - metadata fetch should have populated this`,
      );
    }
    // Price is optional - tokens without prices are still valid (use 0 as default)
    const priceUsd = prices[token.mint] ?? 0;
    // logoURI is optional - use null if not present
    const rawLogoUrl = meta.logoURI ?? null;

    // Get reliable URL: blob cache > reliable URL > null
    let logoURI: string | null = null;
    if (rawLogoUrl) {
      if (rawLogoUrl.includes("blob.vercel-storage.com")) {
        logoURI = rawLogoUrl;
      } else if (cachedBlobUrls[rawLogoUrl]) {
        logoURI = cachedBlobUrls[rawLogoUrl];
      } else if (
        !rawLogoUrl.includes("ipfs.io/ipfs/") &&
        !rawLogoUrl.includes("storage.auto.fun") &&
        !rawLogoUrl.includes(".mypinata.cloud")
      ) {
        logoURI = rawLogoUrl;
      }
    }

    return {
      mint: token.mint,
      amount: token.amount,
      decimals: token.decimals,
      humanBalance: token.humanBalance,
      priceUsd,
      balanceUsd: token.humanBalance * priceUsd,
      symbol: meta.symbol,
      name: meta.name,
      logoURI,
      // Keep original URL for background caching
      _originalLogoUrl: rawLogoUrl,
    };
  });

  interface TokenWithOriginalUrl {
    _originalLogoUrl?: string;
  }

  // Filter: only show tokens worth listing (>$0.01 or >100 tokens if no price)
  const MIN_USD_VALUE = 0.01;
  const MIN_TOKENS_NO_PRICE = 100;

  const filteredTokens = tokensWithData.filter((t) => {
    if (t.priceUsd > 0) return t.balanceUsd >= MIN_USD_VALUE;
    return t.humanBalance >= MIN_TOKENS_NO_PRICE;
  });

  // Sort: priced tokens by value, then unpriced by balance
  filteredTokens.sort((a, b) => {
    if (a.balanceUsd > 0 && b.balanceUsd > 0) return b.balanceUsd - a.balanceUsd;
    if (a.balanceUsd > 0) return -1;
    if (b.balanceUsd > 0) return 1;
    return b.humanBalance - a.humanBalance;
  });

  console.log(
    `[Solana Balances] ${tokensWithBalance.length} total -> ${filteredTokens.length} after filter`,
  );

  // Fire-and-forget: cache unreliable images in background for next request
  for (const token of filteredTokens.slice(0, 30)) {
    const originalUrl = (token as TokenWithOriginalUrl)._originalLogoUrl;
    if (
      originalUrl &&
      !originalUrl.includes("blob.vercel-storage.com") &&
      (originalUrl.includes("ipfs.io/ipfs/") ||
        originalUrl.includes("storage.auto.fun") ||
        originalUrl.includes(".mypinata.cloud")) &&
      !cachedBlobUrls[originalUrl]
    ) {
      // Background image cache - don't await (non-critical)
      // Errors will propagate but won't block response
      cacheImageToBlob(originalUrl);
    }
  }

  // Format response
  const enrichedTokens = filteredTokens.map((t) => ({
    mint: t.mint,
    amount: t.amount,
    decimals: t.decimals,
    priceUsd: t.priceUsd,
    balanceUsd: t.balanceUsd,
    symbol: t.symbol,
    name: t.name,
    logoURI: t.logoURI,
  }));

  // Cache for 15 minutes
  await setCachedWalletResponse(walletAddress, enrichedTokens);

  const response = { tokens: enrichedTokens };
  const validatedResponse = SolanaBalancesResponseSchema.parse(response);

  // Cache for 60 seconds - balances can change but short cache is fine for UX
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
