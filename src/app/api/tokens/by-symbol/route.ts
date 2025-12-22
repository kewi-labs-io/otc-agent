import { type NextRequest, NextResponse } from "next/server";
import { getCachedMarketData, getCachedTokenBySymbol } from "@/lib/cache";
import { validationErrorResponse } from "@/lib/validation/helpers";
import {
  GetTokenBySymbolQuerySchema,
  TokenBySymbolResponseSchema,
} from "@/types/validation/api-schemas";

/**
 * GET /api/tokens/by-symbol?symbol=ELIZA&chain=base
 *
 * Fast lookup of a single token by symbol.
 * Much more efficient than fetching all tokens and filtering client-side.
 *
 * Uses serverless-optimized caching via unstable_cache.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const parseResult = GetTokenBySymbolQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  const { symbol, chain } = query;
  // Get token by symbol using serverless cache
  const token = await getCachedTokenBySymbol(symbol);

  if (!token) {
    return NextResponse.json({ success: false, error: "Token not found" }, { status: 404 });
  }

  // Filter by chain if specified
  if (chain && token.chain !== chain) {
    return NextResponse.json(
      { success: false, error: "Token not found on specified chain" },
      { status: 404 },
    );
  }

  const marketData = await getCachedMarketData(token.id);

  const response = { success: true, token, marketData };
  const validatedResponse = TokenBySymbolResponseSchema.parse(response);

  // Cache for 2 minutes - token metadata rarely changes
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
