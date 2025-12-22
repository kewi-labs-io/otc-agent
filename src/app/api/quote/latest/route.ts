import { type NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { validateCSRF } from "@/lib/csrf";
import { walletToEntityId } from "@/lib/entityId";
import type QuoteService from "@/lib/plugin-otc-desk/services/quoteService";
import { parseOrThrow } from "@/lib/validation/helpers";
import type { QuoteMemory } from "@/types";
import { GetLatestQuoteRequestSchema, QuoteResponseSchema } from "@/types/validation/api-schemas";

export async function GET(request: NextRequest) {
  const runtime = await agentRuntime.getRuntime();
  const quoteService = runtime.getService<QuoteService>("QuoteService");

  if (!quoteService) {
    return NextResponse.json({ error: "QuoteService not available" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("entityId");
  const tokenId = searchParams.get("tokenId");

  if (!wallet || !tokenId) {
    return NextResponse.json(
      { error: "entityId and tokenId parameters required" },
      { status: 400 },
    );
  }

  console.log("[Quote API] GET - wallet:", wallet, "tokenId:", tokenId);

  const entityId = walletToEntityId(wallet);
  const quoteKey = `quote:${tokenId}:${entityId}`;
  // Cache stores QuoteMemory objects - use proper type
  let quote = await runtime.getCache<QuoteMemory>(quoteKey);
  console.log("[Quote API] Found:", quote ? quote.quoteId : "null");

  // Fetch token data first - needed for both new and existing quotes
  const { TokenDB } = await import("@/services/database");
  const token = await TokenDB.getToken(tokenId);

  // FAIL-FAST: Token MUST exist (quotes are always for a specific token)
  if (!token) {
    throw new Error(`Token ${tokenId} not found - cannot create quote for non-existent token`);
  }

  if (!quote) {
    console.log("[Quote API] Creating default quote for token:", tokenId);

    // Worst possible deal defaults (lowest discount, longest lockup)
    const DEFAULT_MIN_DISCOUNT_BPS = 100; // 1%
    const DEFAULT_MAX_LOCKUP_MONTHS = 12; // 12 months

    // Create quote with all required fields
    quote = await quoteService.createQuote({
      entityId,
      beneficiary: wallet.toLowerCase(),
      tokenAmount: "0",
      discountBps: DEFAULT_MIN_DISCOUNT_BPS,
      apr: 0,
      lockupMonths: DEFAULT_MAX_LOCKUP_MONTHS,
      paymentCurrency: "USDC",
      totalUsd: 0,
      discountUsd: 0,
      discountedUsd: 0,
      paymentAmount: "0",
      // Required token metadata
      tokenId,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      tokenLogoUrl: token.logoUrl,
      chain: token.chain,
      // Default consignmentId - will be set when user selects a consignment
      consignmentId: "",
      // Default agent commission (0 for P2P)
      agentCommissionBps: 0,
    });

    await runtime.setCache(quoteKey, quote);
  }

  // FAIL-FAST: Quote must exist at this point
  if (!quote) {
    throw new Error(`Quote not found for token ${tokenId} and entity ${entityId}`);
  }
  const tokenChain = token.chain;
  const tokenSymbol = token.symbol;

  // FAIL-FAST: Quote must have tokenId (required by schema)
  if (!quote.tokenId) {
    throw new Error(`Quote ${quote.quoteId} missing required tokenId field`);
  }

  const formattedQuote = {
    quoteId: quote.quoteId,
    entityId: quote.entityId,
    beneficiary: quote.beneficiary,
    tokenId: quote.tokenId,
    tokenAmount: quote.tokenAmount,
    discountBps: quote.discountBps,
    apr: quote.apr,
    lockupMonths: quote.lockupMonths,
    lockupDays: quote.lockupDays,
    paymentCurrency: quote.paymentCurrency,
    totalUsd: quote.totalUsd,
    discountUsd: quote.discountUsd,
    discountedUsd: quote.discountedUsd,
    paymentAmount: quote.paymentAmount,
    status: quote.status,
    createdAt: quote.createdAt,
    tokenChain,
    tokenSymbol,
  };

  console.log("[Quote API] Returning:", formattedQuote.quoteId, "chain:", tokenChain);
  const response = { success: true, quote: formattedQuote };
  const validatedResponse = QuoteResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}

export async function POST(request: NextRequest) {
  const csrfError = validateCSRF(request);
  if (csrfError) return csrfError;

  const runtime = await agentRuntime.getRuntime();
  const quoteService = runtime.getService<QuoteService>("QuoteService");

  if (!quoteService) {
    return NextResponse.json({ error: "QuoteService not available" }, { status: 500 });
  }

  const body = await request.json();

  const data = parseOrThrow(GetLatestQuoteRequestSchema, body);

  const {
    quoteId,
    beneficiary,
    tokenAmount,
    paymentCurrency,
    totalUsd,
    discountUsd,
    discountedUsd,
    paymentAmount,
  } = data;

  if (!quoteId) {
    return NextResponse.json({ error: "quoteId required" }, { status: 400 });
  }

  console.log("[Quote API] POST - updating quote:", {
    quoteId,
    beneficiary: beneficiary ? beneficiary.slice(0, 10) : undefined,
    tokenAmount,
    paymentCurrency,
    totalUsd,
    discountedUsd,
  });

  // Get existing quote
  const quote = await quoteService.getQuoteByQuoteId(quoteId);

  if (!quote) {
    console.error("[Quote API] Quote not found:", quoteId);
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // Update all provided fields
  const updatedQuote = {
    ...quote,
    ...(beneficiary && { beneficiary: beneficiary.toLowerCase() }),
    ...(tokenAmount && { tokenAmount: String(tokenAmount) }),
    ...(paymentCurrency && { paymentCurrency }),
    ...(typeof totalUsd === "number" && { totalUsd }),
    ...(typeof discountUsd === "number" && { discountUsd }),
    ...(typeof discountedUsd === "number" && { discountedUsd }),
    ...(paymentAmount && { paymentAmount: String(paymentAmount) }),
  };

  // Save updated quote
  await runtime.setCache(`quote:${quoteId}`, updatedQuote);

  console.log("[Quote API] ✅ Quote updated:", quoteId);

  const response = { success: true, quote: updatedQuote };
  const validatedResponse = QuoteResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
