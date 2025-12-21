import { type NextRequest, NextResponse } from "next/server";
import { ConsignmentDB, MarketDataDB, TokenDB } from "@/services/database";
import { TokenByIdResponseSchema } from "@/types/validation/api-schemas";
import { sanitizeConsignmentForBuyer } from "@/utils/consignment-sanitizer";

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

  // Token lookup - return 404 if not found, 400 if invalid format
  let token;
  try {
    token = await TokenDB.getToken(tokenId);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("not found")) {
        return NextResponse.json(
          { success: false, error: `Token ${tokenId} not found` },
          { status: 404 },
        );
      }
      if (err.message.includes("invalid tokenId format")) {
        return NextResponse.json(
          { success: false, error: "Invalid tokenId format" },
          { status: 400 },
        );
      }
    }
    throw err;
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
