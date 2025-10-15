import { NextRequest, NextResponse } from "next/server";
import { TokenDB, MarketDataDB } from "@/services/database";
import { MarketDataService } from "@/services/marketDataService";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params;

  let marketData = await MarketDataDB.getMarketData(tokenId);

  if (!marketData || Date.now() - marketData.lastUpdated > 300000) {
    const token = await TokenDB.getToken(tokenId);
    const service = new MarketDataService();
    await service.refreshTokenData(tokenId, token.contractAddress, token.chain);
    marketData = await MarketDataDB.getMarketData(tokenId);
  }

  return NextResponse.json({
    success: true,
    marketData,
  });
}



