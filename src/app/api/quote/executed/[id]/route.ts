import { type NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { validateRouteParams } from "@/lib/validation/helpers";
import { QuoteDB } from "@/services/database";
import {
  ExecutedQuoteResponseSchema,
  GetExecutedQuoteParamsSchema,
} from "@/types/validation/api-schemas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await agentRuntime.getRuntime();

  const routeParams = await params;
  const validatedParams = validateRouteParams(
    GetExecutedQuoteParamsSchema,
    routeParams,
  );

  const { id: quoteId } = validatedParams;

  // Lookup quote - handle not found at boundary
  let quote;
  try {
    quote = await QuoteDB.getQuoteByQuoteId(quoteId);
  } catch (err) {
    // QuoteDB throws for not found - return 404
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json(
        { error: `Quote ${quoteId} not found` },
        { status: 404 },
      );
    }
    throw err;
  }

  // Allow active, approved, and executed quotes to be viewed
  // active = quote created, approved = offer created/approved on-chain, executed = paid/fulfilled
  if (
    quote.status !== "executed" &&
    quote.status !== "active" &&
    quote.status !== "approved"
  ) {
    console.warn("[Quote Executed API] Invalid status:", {
      quoteId,
      status: quote.status,
    });
    return NextResponse.json(
      { error: "Quote not found or invalid status" },
      { status: 400 },
    );
  }

  const formattedQuote = {
    quoteId: quote.quoteId,
    entityId: quote.entityId,
    beneficiary: quote.beneficiary,
    status: quote.status,
    offerId: quote.offerId,
    tokenAmount: quote.tokenAmount,
    lockupMonths: quote.lockupMonths,
    discountBps: quote.discountBps,
    totalUsd: quote.totalUsd,
    discountUsd: quote.discountUsd,
    discountedUsd: quote.discountedUsd,
    paymentAmount: quote.paymentAmount,
    paymentCurrency: quote.paymentCurrency,
    transactionHash: quote.transactionHash,
    blockNumber: quote.blockNumber,
    // Optional chain hint for UI display ("evm" | "solana")
    chain: quote.chain,
  };

  const response = { success: true, quote: formattedQuote };
  const validatedResponse = ExecutedQuoteResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
