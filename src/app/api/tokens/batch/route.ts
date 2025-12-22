import { type NextRequest, NextResponse } from "next/server";
import { getCachedTokenBatch } from "@/lib/cache";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { GetTokenBatchQuerySchema, TokenBatchResponseSchema } from "@/types/validation/api-schemas";

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

  // Validate query params - return 400 on invalid params
  const parseResult = GetTokenBatchQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  const tokenIds = query.ids;

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

  const batchResponse = { success: true, tokens: tokensMap };
  const validatedBatch = TokenBatchResponseSchema.parse(batchResponse);

  // Cache for 2 minutes - token metadata rarely changes
  return NextResponse.json(validatedBatch, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
