// Accept/fulfill quote action - executes the quote purchase based on cached quote

import {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  Content,
  ActionResult,
} from "@elizaos/core";
import { getUserQuote, deleteUserQuote } from "../providers/quote";
import { updateQuoteStatus } from "../services/quoteHistory";
import { notificationService } from "../services/notifications";
import { ELIZAOS_TOKEN, formatElizaAmount } from "../services/priceFeed";

export const acceptQuoteAction: Action = {
  name: "ACCEPT_ELIZAOS_QUOTE",
  similes: [
    "accept quote",
    "fulfill quote",
    "execute quote",
    "confirm quote",
    "buy eliza",
    "purchase eliza",
    "proceed with quote",
  ],
  description: "Accept and execute a previously generated ElizaOS quote",

  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content?.text?.toLowerCase() || "";
    return (
      (text.includes("accept") ||
        text.includes("fulfill") ||
        text.includes("execute") ||
        text.includes("confirm") ||
        text.includes("proceed") ||
        text.includes("buy") ||
        text.includes("purchase")) &&
      (text.includes("quote") ||
        text.includes("otc") ||
        text.includes("eliza") ||
        text.includes("it"))
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const userId =
        (message as any).userId ||
        (message as any).entityId ||
        (message as any).roomId ||
        "default";

      // Get the user's current quote
      const quote = getUserQuote(userId);

      if (!quote) {
        if (callback) {
          await callback({
            text: "❌ No active ElizaOS quote found. Please create a quote first using 'create quote'.",
            action: "NO_QUOTE",
          });
        }
        return { success: false };
      }

      // Check if quote has expired
      const now = Date.now();
      if (quote.expiresAt < now) {
        deleteUserQuote(userId);
        updateQuoteStatus(userId, quote.quoteId, { status: "expired" });
        notificationService.notifyQuoteExpired(userId, quote.quoteId);

        if (callback) {
          await callback({
            text: "❌ Your ElizaOS quote has expired. Please create a new quote.",
            action: "QUOTE_EXPIRED",
          });
        }
        return { success: false };
      }

      // Update status to accepted - user will complete tx in frontend
      updateQuoteStatus(userId, quote.quoteId, {
        status: "accepted",
        acceptedAt: now,
      });
      notificationService.notifyQuoteAccepted(userId, quote.quoteId);

      // Format amount for display
      const formattedAmount = formatElizaAmount(quote.tokenAmount);

      // Calculate payment amount for display
      let paymentAmount: string;
      if (quote.paymentCurrency === "ETH") {
        if ("paymentAmount" in quote && quote.paymentAmount) {
          paymentAmount = String(quote.paymentAmount);
        } else {
          const { getEthPriceUsd } = await import("../services/priceFeed");
          const ethPrice = await getEthPriceUsd();
          const ethAmount = quote.discountedUsd / ethPrice;
          paymentAmount = ethAmount.toFixed(6);
        }
      } else {
        paymentAmount = quote.discountedUsd.toFixed(2);
      }

      const timeRemaining = Math.floor((quote.expiresAt - now) / 60000);

      // Guide user to complete transaction in frontend
      const textResponse = `
✅ **Quote Accepted! Ready to Execute**

📋 **Your Quote:**
• Quote ID: ${quote.quoteId}
• Amount: ${formattedAmount} ElizaOS
• Payment: ${paymentAmount} ${quote.paymentCurrency}
• Discount: ${(quote.discountBps / 100).toFixed(2)}%
• You Save: $${(quote.totalUsd - quote.discountedUsd).toFixed(2)}

⏰ **Time Remaining:** ${timeRemaining} minutes

🔐 **Next Steps:**
1. Click the "Accept Quote" button in the chat
2. Connect your wallet if not already connected
3. Review the final terms carefully
4. Sign the transaction to create your OTC offer on-chain
5. Wait for approval from the desk
6. Complete payment when approved
7. Claim your tokens after the lockup period

💡 **Important:** The transaction will be executed on-chain when you sign. Make sure you have enough ${quote.paymentCurrency} and gas for the transaction.
      `.trim();

      // Enhanced XML response for frontend to trigger the modal
      const xmlResponse = `
<QuoteAccepted>
  <QuoteId>${quote.quoteId}</QuoteId>
  <TokenAmount>${quote.tokenAmount}</TokenAmount>
  <TokenAmountFormatted>${formattedAmount}</TokenAmountFormatted>
  <TokenSymbol>${ELIZAOS_TOKEN.symbol}</TokenSymbol>
  <TokenName>${ELIZAOS_TOKEN.name}</TokenName>
  <PaidAmount>${paymentAmount}</PaidAmount>
  <PaymentCurrency>${quote.paymentCurrency}</PaymentCurrency>
  <DiscountBps>${quote.discountBps}</DiscountBps>
  <DiscountPercent>${(quote.discountBps / 100).toFixed(2)}</DiscountPercent>
  <TotalSaved>${(quote.totalUsd - quote.discountedUsd).toFixed(2)}</TotalSaved>
  <FinalPrice>${quote.discountedUsd.toFixed(2)}</FinalPrice>
  <Status>accepted</Status>
  <Timestamp>${new Date().toISOString()}</Timestamp>
  <ExpiresIn>${timeRemaining}</ExpiresIn>
  <Message>Quote ready for execution. Complete the transaction in your wallet.</Message>
</QuoteAccepted>`;

      if (callback) {
        await callback({
          text:
            textResponse +
            "\n\n<!-- XML_START -->\n" +
            xmlResponse +
            "\n<!-- XML_END -->",
          action: "QUOTE_ACCEPTED",
          content: {
            xml: xmlResponse,
            quote: quote,
          } as Content,
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Error accepting ElizaOS quote:", error);
      if (callback) {
        await callback({
          text: "❌ Failed to accept ElizaOS quote. Please try again.",
          action: "ACCEPT_ERROR",
        });
      }
      return { success: false };
    }
  },

  examples: [],
};
