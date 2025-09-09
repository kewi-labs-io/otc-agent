import { NextRequest, NextResponse } from "next/server";
import {
  DealCompletionService,
  QuoteService,
  UserSessionService,
} from "@/services/database";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { quoteId, action, userId } = body;

    if (!quoteId) {
      return NextResponse.json(
        { error: "Quote ID is required" },
        { status: 400 },
      );
    }

    if (action === "complete") {
      if (!userId) {
        return NextResponse.json(
          { error: "User ID is required for completion" },
          { status: 400 },
        );
      }

      // Get quote details from user's history
      const quotes = await QuoteService.getUserQuoteHistory(userId, 50);
      const quote = quotes.find((q) => q.id === quoteId);

      if (!quote) {
        return NextResponse.json({ error: "Quote not found" }, { status: 404 });
      }

      // Record deal completion
      const completion = await DealCompletionService.recordDealCompletion({
        userId: quote.userId,
        quoteId: quote.id,
        transactionHash: body.transactionHash || "",
        offerId: body.offerId,
        blockNumber: body.blockNumber,
        volumeUsd: quote.discountedUsd,
        savedUsd: quote.discountUsd,
      });

      // Update quote status
      await QuoteService.updateQuoteStatus(quoteId, "executed", {
        transactionHash: body.transactionHash,
        blockNumber: body.blockNumber,
      });

      // Update user session stats
      await UserSessionService.updateDealStats(
        quote.userId,
        quote.discountedUsd,
        quote.discountUsd,
      );

      // Log deal completion for audit trail
      console.log("[Deal Completion] Deal completed", {
        userId: quote.userId,
        quoteId,
        tokenAmount: quote.tokenAmount,
        discountBps: quote.discountBps,
        finalPrice: quote.discountedUsd,
        transactionHash: body.transactionHash,
        ipAddress:
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip"),
      });

      return NextResponse.json({
        success: true,
        completion,
      });
    } else if (action === "share") {
      // Generate share data for the quote
      const shareData = await DealCompletionService.generateShareData(quoteId);

      // Log share action
      console.log("[Deal Completion] Deal shared", {
        quoteId,
        platform: body.platform || "general",
      });

      return NextResponse.json({
        success: true,
        shareData,
      });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Deal Completion] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to process deal completion",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 },
      );
    }

    // Get user's quote history and filter for completed deals
    const quotes = await QuoteService.getUserQuoteHistory(userId, 100);
    const completedDeals = quotes.filter(
      (quote) => quote.status === "executed",
    );

    // Get user session for additional stats
    const userSession = await UserSessionService.getOrCreateSession(userId);

    return NextResponse.json({
      success: true,
      deals: completedDeals,
      totalDeals: userSession.totalDeals,
      totalVolumeUsd: userSession.totalVolumeUsd,
      totalSavedUsd: userSession.totalSavedUsd,
    });
  } catch (error) {
    console.error("[Deal Completion] Failed to get user deals:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve deals",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
