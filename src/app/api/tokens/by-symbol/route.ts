import { NextRequest, NextResponse } from "next/server";
import { getCachedTokenBySymbol, getCachedMarketData } from "@/lib/cache";

/**
 * GET /api/tokens/by-symbol?symbol=ELIZA&chain=base
 *
 * Fast lookup of a single token by symbol.
 * Much more efficient than fetching all tokens and filtering client-side.
 * 
 * Uses serverless-optimized caching via unstable_cache.
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const chain = request.nextUrl.searchParams.get("chain");

  if (!symbol) {
    return NextResponse.json(
      { success: false, error: "symbol parameter required" },
      { status: 400 },
    );
  }

  try {
    // Get token by symbol using serverless cache
    const token = await getCachedTokenBySymbol(symbol);

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Token not found" },
        { status: 404 },
      );
    }

    // Filter by chain if specified
    if (chain && token.chain !== chain) {
      return NextResponse.json(
        { success: false, error: "Token not found on specified chain" },
        { status: 404 },
      );
    }

    const marketData = await getCachedMarketData(token.id);

    // Cache for 2 minutes - token metadata rarely changes
    return NextResponse.json(
      {
        success: true,
        token,
        marketData,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    console.error("[Token by Symbol] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch token",
      },
      { status: 500 },
    );
  }
}

