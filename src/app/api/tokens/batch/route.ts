import { NextRequest, NextResponse } from "next/server";
import { getCachedTokenBatch } from "@/lib/cache";

/**
 * GET /api/tokens/batch?ids=token-base-0x1,token-base-0x2
 *
 * Batch fetch tokens by their IDs. Much more efficient than
 * individual requests when loading multiple tokens.
 * 
 * Uses serverless-optimized caching via unstable_cache.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");

  if (!idsParam) {
    return NextResponse.json(
      { success: false, error: "ids parameter required" },
      { status: 400 },
    );
  }

  const tokenIds = idsParam.split(",").filter(Boolean);

  if (tokenIds.length === 0) {
    return NextResponse.json({ success: true, tokens: {} });
  }

  // Limit batch size to prevent abuse
  if (tokenIds.length > 50) {
    return NextResponse.json(
      { success: false, error: "Maximum 50 tokens per batch" },
      { status: 400 },
    );
  }

  // Use serverless-optimized batch cache
  const tokensMap = await getCachedTokenBatch(tokenIds);

  // Cache for 2 minutes - token metadata rarely changes
  return NextResponse.json(
    { success: true, tokens: tokensMap },
    {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    },
  );
}

