import { NextRequest, NextResponse } from "next/server";
import type { Chain } from "@/types";
import { getCachedTokenAddresses } from "@/lib/cache";
import {
  validateQueryParams,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  GetTokenAddressesQuerySchema,
  TokenAddressesResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";

/**
 * GET /api/tokens/addresses?chain=base
 *
 * Returns just the contract addresses of registered tokens.
 * Much lighter than fetching full token data.
 *
 * Uses serverless-optimized caching via unstable_cache.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const parseResult = GetTokenAddressesQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  // Use serverless-optimized cache
  // chain is optional in query - pass undefined if not provided
  const addresses = await getCachedTokenAddresses(
    query.chain !== undefined ? query.chain : undefined,
  );

  const response = { success: true, addresses };
  const validatedResponse = TokenAddressesResponseSchema.parse(response);

  // Cache for 5 minutes - registered tokens change rarely
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
