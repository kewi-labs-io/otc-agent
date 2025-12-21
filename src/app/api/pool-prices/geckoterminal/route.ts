import { NextRequest, NextResponse } from "next/server";
import {
  validateQueryParams,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import { PoolPriceProxyErrorResponseSchema } from "@/types/validation/api-schemas";
import { z } from "zod";
import { EvmAddressSchema } from "@/types/validation/schemas";

/**
 * GET /api/pool-prices/geckoterminal?network=base&token=0x...
 *
 * Proxies GeckoTerminal API calls to avoid CSP violations in the browser.
 * GeckoTerminal is used to find Uniswap V4 pools that may have unknown hooks.
 */
export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network");
  const tokenAddress = request.nextUrl.searchParams.get("token");

  if (!network || !tokenAddress) {
    const errorResponse = { error: "network and token parameters required" };
    const validatedError =
      PoolPriceProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 400 });
  }

  // Validate network parameter
  const validNetworks = [
    "base",
    "eth",
    "ethereum",
    "bsc",
    "polygon",
    "arbitrum",
  ];
  if (!validNetworks.includes(network.toLowerCase())) {
    const errorResponse = { error: `Invalid network: ${network}` };
    const validatedError =
      PoolPriceProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 400 });
  }

  const geckoNetwork = network === "ethereum" ? "eth" : network.toLowerCase();
  const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/tokens/${tokenAddress.toLowerCase()}/pools`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OTC-Desk/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn(`[GeckoTerminal Proxy] API error: ${response.status}`);
    return NextResponse.json({ data: [] }, { status: 200 });
  }

  const data = await response.json();

  // Cache for 30 seconds - pool data updates reasonably frequently
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
