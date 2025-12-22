import { type NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import type QuoteService from "@/lib/plugin-otc-desk/services/quoteService";
import { validateRouteParams } from "@/lib/validation/helpers";
import {
  GetQuoteByOfferParamsSchema,
  QuoteByOfferErrorResponseSchema,
} from "@/types/validation/api-schemas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  await agentRuntime.getRuntime();

  const routeParams = await params;
  const validatedParams = validateRouteParams(GetQuoteByOfferParamsSchema, routeParams);

  const { offerId } = validatedParams;

  const runtime = await agentRuntime.getRuntime();
  const quoteService = runtime.getService<QuoteService>("QuoteService");

  // FAIL-FAST: QuoteService must be available
  if (!quoteService) {
    throw new Error("QuoteService not available - agent runtime not properly initialized");
  }

  // Search for quote with matching offerId
  const matchingQuote = await quoteService.getQuoteByOfferId(String(offerId));

  if (!matchingQuote) {
    const notFoundResponse = { error: "Quote not found for this offer" };
    const validatedNotFound = QuoteByOfferErrorResponseSchema.parse(notFoundResponse);
    return NextResponse.json(validatedNotFound, { status: 404 });
  }

  // Redirect to the deal page
  return NextResponse.redirect(new URL(`/deal/${matchingQuote.quoteId}`, request.url));
}
