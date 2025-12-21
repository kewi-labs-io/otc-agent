import { NextRequest, NextResponse } from "next/server";
import { TokenDB, MarketDataDB, ConsignmentDB } from "@/services/database";
import { sanitizeConsignmentForBuyer } from "@/utils/consignment-sanitizer";
import {
  validateRouteParams,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  GetTokenByIdParamsSchema,
  TokenByIdResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params;

  // FAIL-FAST: Validate tokenId parameter
  if (!tokenId) {
    return NextResponse.json(
      { success: false, error: "Token ID is required" },
      { status: 400 },
    );
  }

  // Validate tokenId format
  if (!tokenId.match(/^token-(ethereum|base|bsc|solana)-/)) {
    return NextResponse.json(
      { success: false, error: "Invalid tokenId format" },
      { status: 400 },
    );
  }

  // Token lookup - return 404 if not found
  const token = await TokenDB.getToken(tokenId);
  if (!token) {
    return NextResponse.json(
      { success: false, error: `Token ${tokenId} not found` },
      { status: 404 },
    );
  }

  const marketData = await MarketDataDB.getMarketData(tokenId);
  let consignments = await ConsignmentDB.getConsignmentsByToken(tokenId);

  // Filter out listings with < 1 token remaining (dust amounts)
  const oneToken = BigInt(10) ** BigInt(token.decimals);
  consignments = consignments.filter(
    (c) => BigInt(c.remainingAmount) >= oneToken,
  );

  // Sanitize consignments to hide negotiation terms from buyers
  // This prevents gaming the negotiation by querying the API
  const sanitizedConsignments = consignments.map(sanitizeConsignmentForBuyer);

  const response = {
    success: true,
    token,
    marketData,
    consignments: sanitizedConsignments,
  };
  const validatedResponse = TokenByIdResponseSchema.parse(response);

  // Cache for 2 minutes - token metadata rarely changes
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
