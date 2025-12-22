import { type NextRequest, NextResponse } from "next/server";
import { PoolPriceProxyErrorResponseSchema } from "@/types/validation/api-schemas";

/**
 * GET /api/pool-prices/coingecko-token?network=base&token=0x...
 *
 * Proxies CoinGecko token info API calls to avoid CSP violations in the browser.
 * Used as a fallback when DEX pools aren't found or have low liquidity.
 *
 * Note: This is different from /api/token-prices which uses the simpler
 * CoinGecko price endpoint. This endpoint fetches full token info including
 * market data (market cap, volume) for better TVL estimation.
 */
export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network");
  const tokenAddress = request.nextUrl.searchParams.get("token");

  if (!network || !tokenAddress) {
    const errorResponse = { error: "network and token parameters required" };
    const validatedError = PoolPriceProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 400 });
  }

  // Map network to CoinGecko platform ID
  const platformMap: Record<string, string> = {
    ethereum: "ethereum",
    eth: "ethereum",
    base: "base",
    bsc: "binance-smart-chain",
    polygon: "polygon-pos",
    arbitrum: "arbitrum-one",
  };

  const platformId = platformMap[network.toLowerCase()];
  if (!platformId) {
    const errorResponse = { error: `Unsupported network: ${network}` };
    const validatedError = PoolPriceProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 400 });
  }

  const apiKey = process.env.COINGECKO_API_KEY;

  const url = apiKey
    ? `https://pro-api.coingecko.com/api/v3/coins/${platformId}/contract/${tokenAddress.toLowerCase()}`
    : `https://api.coingecko.com/api/v3/coins/${platformId}/contract/${tokenAddress.toLowerCase()}`;

  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent": "OTC-Desk/1.0",
  };
  if (apiKey) {
    headers["X-Cg-Pro-Api-Key"] = apiKey;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    // Token not found is common, don't log as error
    if (response.status === 404) {
      return NextResponse.json(null, { status: 200 });
    }
    console.warn(`[CoinGecko Token Proxy] API error: ${response.status}`);
    return NextResponse.json(null, { status: 200 });
  }

  const data = await response.json();

  // Cache for 60 seconds - market data updates less frequently
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
