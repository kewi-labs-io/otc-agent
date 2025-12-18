import { NextRequest, NextResponse } from "next/server";
import type { Chain } from "@/types";
import { getCachedTokenAddresses } from "@/lib/cache";

/**
 * GET /api/tokens/addresses?chain=base
 *
 * Returns just the contract addresses of registered tokens.
 * Much lighter than fetching full token data.
 * 
 * Uses serverless-optimized caching via unstable_cache.
 */
export async function GET(request: NextRequest) {
  const chain = request.nextUrl.searchParams.get("chain") as Chain | null;

  try {
    // Use serverless-optimized cache
    const addresses = await getCachedTokenAddresses(chain ?? undefined);

    // Cache for 5 minutes - registered tokens change rarely
    return NextResponse.json(
      {
        success: true,
        addresses,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    console.error("[Token Addresses] Error:", error);
    return NextResponse.json(
      { success: false, addresses: [] },
      { status: 500 },
    );
  }
}

