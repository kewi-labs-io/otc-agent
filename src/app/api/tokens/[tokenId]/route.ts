import { NextRequest, NextResponse } from "next/server";
import { TokenDB, MarketDataDB, ConsignmentDB } from "@/services/database";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params;

  try {
    const token = await TokenDB.getToken(tokenId);
    const marketData = await MarketDataDB.getMarketData(tokenId);
    const consignments = await ConsignmentDB.getConsignmentsByToken(tokenId);

    return NextResponse.json({
      success: true,
      token,
      marketData,
      consignments,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: "Token not found" },
        { status: 404 },
      );
    }
    throw error;
  }
}
