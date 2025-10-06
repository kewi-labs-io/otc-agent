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

  const quote = await QuoteDB.getQuoteByQuoteId(quoteId);

  if (quote.status !== "executed") {
    return NextResponse.json({ error: "Quote not executed" }, { status: 400 });
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
