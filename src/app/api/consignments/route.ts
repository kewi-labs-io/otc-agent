import { NextRequest, NextResponse } from "next/server";
import { ConsignmentDB } from "@/services/database";
import type { Chain } from "@/config/chains";
import { ConsignmentService } from "@/services/consignmentService";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenId = searchParams.get("tokenId");
  const chain = searchParams.get("chain") as Chain | null;
  const isNegotiable = searchParams.get("isNegotiable");
  const consignerAddress = searchParams.get("consigner");
  const requesterAddress = searchParams.get("requester");

  const filters: Parameters<typeof ConsignmentDB.getAllConsignments>[0] = {};
  if (chain) filters.chain = chain;
  if (tokenId) filters.tokenId = tokenId;
  if (isNegotiable !== null) filters.isNegotiable = isNegotiable === "true";

  let consignments = await ConsignmentDB.getAllConsignments(filters);

  if (consignerAddress) {
    consignments = consignments.filter(
      (c) =>
        c.consignerAddress.toLowerCase() === consignerAddress.toLowerCase(),
    );
  }

  if (requesterAddress) {
    const requester = requesterAddress.toLowerCase();
    consignments = consignments.filter((c) => {
      if (!c.isPrivate) return true;
      if (c.consignerAddress === requester) return true;
      if (c.allowedBuyers?.includes(requester)) return true;
      return false;
    });
  } else {
    consignments = consignments.filter((c) => !c.isPrivate);
  }

  return NextResponse.json({
    success: true,
    consignments,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    tokenId,
    consignerAddress,
    amount,
    isNegotiable,
    fixedDiscountBps,
    fixedLockupDays,
    minDiscountBps,
    maxDiscountBps,
    minLockupDays,
    maxLockupDays,
    minDealAmount,
    maxDealAmount,
    isFractionalized,
    isPrivate,
    allowedBuyers,
    maxPriceVolatilityBps,
    maxTimeToExecuteSeconds,
    chain,
  } = body;

  if (!tokenId || !consignerAddress || !amount || !chain) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const service = new ConsignmentService();
  const consignment = await service.createConsignment({
    tokenId,
    consignerAddress,
    amount,
    isNegotiable,
    fixedDiscountBps,
    fixedLockupDays,
    minDiscountBps,
    maxDiscountBps,
    minLockupDays,
    maxLockupDays,
    minDealAmount,
    maxDealAmount,
    isFractionalized,
    isPrivate,
    allowedBuyers,
    maxPriceVolatilityBps,
    maxTimeToExecuteSeconds,
    chain,
  });

  return NextResponse.json({
    success: true,
    consignment,
  });
}
