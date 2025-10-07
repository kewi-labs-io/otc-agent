import { NextRequest, NextResponse } from "next/server";
import { QuoteDB } from "@/services/database";
import { agentRuntime } from "@/lib/agent-runtime";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await agentRuntime.getRuntime();

  const { id: quoteId } = await params;

  if (!quoteId) {
    return NextResponse.json({ error: "Quote ID required" }, { status: 400 });
  }

  let quote;
  try {
    quote = await QuoteDB.getQuoteByQuoteId(quoteId);
  } catch (error: any) {
    console.error("[Quote Executed API] Quote not found:", quoteId, error.message);
    return NextResponse.json({ error: "Quote not found" }, { status: 400 });
  }

  // Allow active, approved, and executed quotes to be viewed
  // active = quote created, approved = offer created/approved on-chain, executed = paid/fulfilled
  if (quote.status !== "executed" && quote.status !== "active" && quote.status !== "approved") {
    console.warn("[Quote Executed API] Invalid status:", { quoteId, status: quote.status });
    return NextResponse.json({ error: "Quote not found or invalid status" }, { status: 400 });
  }

  const formattedQuote = {
    quoteId: quote.quoteId,
    entityId: quote.entityId,
    beneficiary: quote.beneficiary,
    tokenAmount: quote.tokenAmount,
    lockupMonths: quote.lockupMonths,
    discountBps: quote.discountBps,
    totalUsd: quote.totalUsd,
    discountUsd: quote.discountUsd,
    discountedUsd: quote.discountedUsd,
    paymentAmount: quote.paymentAmount,
    paymentCurrency: quote.paymentCurrency,
    transactionHash: quote.transactionHash,
  };

  return NextResponse.json({ success: true, quote: formattedQuote });
}
