// Quote history action - show user's ELIZA quote history and statistics

import {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  Content,
  ActionResult,
} from "@elizaos/core";
import {
  getUserQuoteHistory,
  getUserQuoteStats,
} from "../services/quoteHistory";
import { formatElizaAmount } from "../services/priceFeed";

export const quoteHistoryAction: Action = {
  name: "SHOW_ELIZA_HISTORY",
  similes: [
    "show history",
    "quote history",
    "my quotes",
    "past quotes",
    "show my quotes",
    "eliza stats",
    "my statistics",
  ],
  description: "Display user's ELIZA quote history and statistics",

  validate: async () => true,

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

      // Get user's history and stats
      const stats = getUserQuoteStats(userId);
      const history = getUserQuoteHistory(userId, { limit: 10 });

      if (history.length === 0) {
        if (callback) {
          await callback({
            text: "📊 You haven't created any ELIZA quotes yet. Start by saying 'create quote for 100000 ELIZA at 10% discount'",
            action: "NO_HISTORY",
          });
        }
        return { success: true };
      }

      // Format history entries
      const historyText = history
        .map((quote, index) => {
          const date = new Date(quote.createdAt).toLocaleDateString();
          const time = new Date(quote.createdAt).toLocaleTimeString();
          const statusEmoji =
            {
              created: "🆕",
              expired: "⏰",
              accepted: "✅",
              rejected: "❌",
              executed: "💎",
            }[quote.status] || "❓";

          const formattedAmount = formatElizaAmount(quote.tokenAmount);

          return `${index + 1}. ${statusEmoji} ${quote.quoteId} - ${formattedAmount} ELIZA @ ${(quote.discountBps / 100).toFixed(1)}% off - $${quote.discountedUsd.toFixed(2)} - ${date} ${time}`;
        })
        .join("\n");

      // XML response for frontend
      const xmlResponse = `
<quoteHistory>
  <stats>
    <total>${stats.total}</total>
    <executed>${stats.executed}</executed>
    <expired>${stats.expired}</expired>
    <totalVolumeUsd>${stats.totalVolumeUsd.toFixed(2)}</totalVolumeUsd>
    <totalSavedUsd>${stats.totalSavedUsd.toFixed(2)}</totalSavedUsd>
    <totalElizaPurchased>${stats.totalElizaPurchased}</totalElizaPurchased>
    <averageDiscountPercent>${(stats.averageDiscountBps / 100).toFixed(2)}</averageDiscountPercent>
  </stats>
  <quotes>
    ${history
      .map(
        (q) => `
    <quote>
      <quoteId>${q.quoteId}</quoteId>
      <tokenAmount>${q.tokenAmount}</tokenAmount>
      <tokenAmountFormatted>${formatElizaAmount(q.tokenAmount)}</tokenAmountFormatted>
      <discountBps>${q.discountBps}</discountBps>
      <finalPriceUsd>${q.discountedUsd.toFixed(2)}</finalPriceUsd>
      <status>${q.status}</status>
      <createdAt>${new Date(q.createdAt).toISOString()}</createdAt>
      ${q.transactionHash ? `<transactionHash>${q.transactionHash}</transactionHash>` : ""}
      ${q.offerId ? `<offerId>${q.offerId}</offerId>` : ""}
    </quote>`,
      )
      .join("")}
  </quotes>
  <message>Showing last ${history.length} ELIZA quotes</message>
</quoteHistory>`;

      const textResponse = `
📊 **Your ELIZA Quote History & Statistics**

📈 **Lifetime Stats:**
• Total Quotes: ${stats.total}
• Executed: ${stats.executed} (${stats.total > 0 ? ((stats.executed / stats.total) * 100).toFixed(0) : 0}% success rate)
• Expired: ${stats.expired}
• Total ELIZA Purchased: ${formatElizaAmount(stats.totalElizaPurchased)}
• Total Volume: $${stats.totalVolumeUsd.toFixed(2)}
• Total Saved: $${stats.totalSavedUsd.toFixed(2)}
• Average Discount: ${(stats.averageDiscountBps / 100).toFixed(2)}%

📜 **Recent ELIZA Quotes (Last 10):**
${historyText}

Legend: 🆕 Created | ✅ Accepted | 💎 Executed | ⏰ Expired | ❌ Rejected

💡 **Tips:**
• Create a new quote: "quote me 50000 ELIZA at 15% discount"
• Check current quote: "show my quote"
• Accept quote: "accept quote"
      `.trim();

      if (callback) {
        await callback({
          text: textResponse,
          action: "HISTORY_SHOWN",
          content: {
            xml: xmlResponse,
            stats,
            history,
          } as Content,
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Error fetching ELIZA quote history:", error);
      if (callback) {
        await callback({
          text: "❌ Failed to fetch quote history. Please try again.",
          action: "HISTORY_ERROR",
        });
      }
      return { success: false };
    }
  },

  examples: [],
};
