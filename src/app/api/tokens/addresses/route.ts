import { type NextRequest, NextResponse } from "next/server";
import { getCachedTokenAddresses } from "@/lib/cache";
import { validationErrorResponse } from "@/lib/validation/helpers";
import {
  GetTokenAddressesQuerySchema,
  TokenAddressesResponseSchema,
} from "@/types/validation/api-schemas";

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

  // Normalize chain values (handle legacy cached data with -mainnet suffix)
  const validChains = ["ethereum", "base", "bsc", "solana"];
  const normalizedAddresses = addresses
    .map((a) => ({
      address: a.address,
      chain: a.chain.replace("-mainnet", "") as
        | "ethereum"
        | "base"
        | "bsc"
        | "solana",
    }))
    .filter((a) => validChains.includes(a.chain));

  const response = { success: true, addresses: normalizedAddresses };
  const validatedResponse = TokenAddressesResponseSchema.parse(response);

  // Cache for 5 minutes - registered tokens change rarely
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
