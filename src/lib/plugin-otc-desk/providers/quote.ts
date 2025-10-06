// Current quote provider using database-backed runtime cache ONLY
// NO in-memory Maps - serverless compatible

import { IAgentRuntime, Memory, Provider, ProviderResult } from "@elizaos/core";
import { formatElizaAmount } from "../services/priceFeed";
import { walletToEntityId } from "../../entityId";
import type { PaymentCurrency, QuoteMemory } from "../types";

export const quoteProvider: Provider = {
  name: "currentElizaQuote",
  get: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<ProviderResult> => {
    const walletAddress =
      (message as any).entityId ||
      (message as any).entityId ||
      (message as any).roomId ||
      "default";

    console.log('[QuoteProvider] get() called for wallet:', walletAddress);

    // Use runtime service
    const QuoteService = runtime.getService<any>("QuoteService");
    const currentQuote = QuoteService ? await QuoteService.getQuoteByWallet(walletAddress) : undefined;
    
    console.log('[QuoteProvider] Service result:', currentQuote ? currentQuote.quoteId : 'null');

    if (!currentQuote) {
      return {
        text: `No active ElizaOS quote. Use 'create quote' to generate a quote for ElizaOS tokens.`,
      };
    }

    const formattedAmount = formatElizaAmount(currentQuote.tokenAmount);

    return {
      text: `
Current Agent Quote (ID: ${currentQuote.quoteId}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Amount: ${Number(currentQuote.tokenAmount) > 0 ? formattedAmount + " ElizaOS" : "Choose amount at acceptance"}
💰 Price per Token: $${currentQuote.priceUsdPerToken.toFixed(8)}
💵 Total Value: $${currentQuote.totalUsd.toFixed(2)}
🎯 Discount: ${currentQuote.discountBps / 100}% (${currentQuote.discountBps} bps)
✨ Your Price: $${currentQuote.discountedUsd.toFixed(2)}
💳 Payment Method: ${currentQuote.paymentCurrency}
🔒 Lockup: ${currentQuote.lockupMonths} months

FAQ:
- What is the minimum order size?
We have a minimum order size of 1000 $ElizaOS tokens.

- What is the maximum order size?
We're capping it so we can have enough for everyone to try out the OTC agent, so only 100k $ElizaOS tokens at a time for now.

- What is the maximum discount?
Try us. Negotiate if you can :) Usually we're around 2-10% off but open to negotiation.

- What is the maximum lockup?
For really deep discounts we usually do a discount up to 12 months (52 weeks).

- What is the minimum lockup?
We're offering 1 week lockups for now.

- How do I buy the tokens?
You'll need ETH or USDC on Base.

- Wait, the new $ElizaOS token is on Base? Isn't $ai16z a Solana project?
It's available on Base, Optimism, Arbitrum, Solana, Polygon and Ethereum mainnet.

- When do I get my tokens?
You'll automatically receive your tokens when the lockup period ends.`.trim(),
    };
  },
};

export async function getUserQuote(walletAddress: string): Promise<QuoteMemory | undefined> {
  const { agentRuntime } = await import("../../agent-runtime");
  const runtime = await agentRuntime.getRuntime();
  const QuoteService = runtime.getService<any>("QuoteService");
  
  if (!QuoteService) return undefined;
  
  return await QuoteService.getQuoteByWallet(walletAddress);
}

export async function setUserQuote(
  walletAddress: string,
  quote: {
    tokenAmount: string;
    discountBps: number;
    paymentCurrency: PaymentCurrency;
    priceUsdPerToken: number;
    totalUsd: number;
    discountedUsd: number;
    expiresAt: number;
    createdAt: number;
    quoteId: string;
    apr: number;
    lockupMonths: number;
    paymentAmount: string;
  },
): Promise<QuoteMemory> {
  const normalized = walletAddress.toLowerCase();
  const entityId = walletToEntityId(normalized);
  
  console.log('[setUserQuote] Creating new quote:', {
    walletAddress: normalized,
    entityId,
    discountBps: quote.discountBps,
    lockupMonths: quote.lockupMonths
  });

  const { agentRuntime } = await import("../../agent-runtime");
  const runtime = await agentRuntime.getRuntime();
  const QuoteService = runtime.getService<any>("QuoteService");

  if (!QuoteService) {
    console.error("[setUserQuote] QuoteService not available!");
    throw new Error("QuoteService not available");
  }

  // Expire old quotes FIRST
  await QuoteService.expireUserQuotes(walletAddress);
  
  // Create new quote and return the actual stored quote with real ID
  const createdQuote = await QuoteService.createQuote({
    entityId,
    beneficiary: normalized,
    tokenAmount: quote.tokenAmount,
    discountBps: quote.discountBps,
    apr: quote.apr,
    lockupMonths: quote.lockupMonths,
    paymentCurrency: quote.paymentCurrency,
    priceUsdPerToken: quote.priceUsdPerToken,
    totalUsd: quote.totalUsd,
    discountUsd: quote.totalUsd - quote.discountedUsd,
    discountedUsd: quote.discountedUsd,
    paymentAmount: quote.paymentAmount,
    expiresAt: new Date(quote.expiresAt),
  });
  
  console.log('[setUserQuote] ✅ New quote created:', createdQuote.quoteId);
  return createdQuote;
}

export function deleteUserQuote(walletAddress: string): void {
  // In serverless, we can't delete from memory - just mark as expired in DB
  console.log('[QuoteProvider] deleteUserQuote called for:', walletAddress);
}

export async function loadActiveQuotes(): Promise<void> {
  const { agentRuntime } = await import("../../agent-runtime");
  const runtime = await agentRuntime.getRuntime();
  const QuoteService = runtime.getService<any>("QuoteService");
  
  if (QuoteService) {
    const activeQuotes = await QuoteService.getActiveQuotes();
    console.log(`[QuoteProvider] Loaded ${activeQuotes.length} active quotes`);
  }
}