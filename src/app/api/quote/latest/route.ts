import { NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { walletToEntityId } from "@/lib/entityId";
import QuoteService from "@/lib/plugin-otc-desk/services/quoteService";

export async function GET(request: NextRequest) {
  const runtime = await agentRuntime.getRuntime();
  const quoteService = runtime.getService<QuoteService>("QuoteService");

  if (!quoteService) {
    return NextResponse.json({ error: "QuoteService not available" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("entityId");

  if (!wallet) {
    return NextResponse.json({ error: "entityId parameter required" }, { status: 400 });
  }

  console.log('[Quote API] GET - wallet:', wallet);

  let quote = await quoteService.getQuoteByWallet(wallet);
  console.log('[Quote API] Found:', quote ? quote.quoteId : 'null');
  
  if (!quote) {
    console.log('[Quote API] Creating default quote');
    const { getElizaPriceUsd } = await import("@/lib/plugin-otc-desk/services/priceFeed");
    const priceUsdPerToken = await getElizaPriceUsd();
    const entityId = walletToEntityId(wallet);
    
    await quoteService.createQuote({
      entityId,
      beneficiary: wallet.toLowerCase(),
      tokenAmount: "0",
      discountBps: 1000,
      apr: 0,
      lockupMonths: 5,
      paymentCurrency: "USDC",
      priceUsdPerToken,
      totalUsd: 0,
      discountUsd: 0,
      discountedUsd: 0,
      paymentAmount: "0",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    
    quote = await quoteService.getQuoteByWallet(wallet);
  }

  const formattedQuote = quote ? {
    quoteId: quote.quoteId,
    entityId: quote.entityId,
    beneficiary: quote.beneficiary,
    tokenAmount: quote.tokenAmount,
    discountBps: quote.discountBps,
    apr: quote.apr,
    lockupMonths: quote.lockupMonths,
    lockupDays: quote.lockupDays,
    paymentCurrency: quote.paymentCurrency,
    priceUsdPerToken: quote.priceUsdPerToken,
    totalUsd: quote.totalUsd,
    discountUsd: quote.discountUsd,
    discountedUsd: quote.discountedUsd,
    paymentAmount: quote.paymentAmount,
    status: quote.status,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
  } : null;

  console.log('[Quote API] Returning:', formattedQuote?.quoteId ?? 'null');
  return NextResponse.json({ success: true, quote: formattedQuote });
}

export async function POST(request: NextRequest) {
  const runtime = await agentRuntime.getRuntime();
  const quoteService = runtime.getService<QuoteService>("QuoteService");

  if (!quoteService) {
    return NextResponse.json({ error: "QuoteService not available" }, { status: 500 });
  }

  const body = await request.json();
  const { quoteId, beneficiary } = body;

  if (!quoteId || !beneficiary) {
    return NextResponse.json({ error: "quoteId and beneficiary required" }, { status: 400 });
  }

  const updated = await quoteService.setQuoteBeneficiary(quoteId, beneficiary);

  return NextResponse.json({ success: true, quote: updated });
}
