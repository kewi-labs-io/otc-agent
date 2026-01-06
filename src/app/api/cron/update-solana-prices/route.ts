import { NextResponse } from "next/server";

/**
 * Cron job to keep Solana token prices fresh on-chain
 * This prevents "StalePrice" errors when users try to create offers
 *
 * Schedule: Every 15 minutes (configured in vercel.json)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60 seconds for multiple token updates

export async function GET() {
  const results: Array<{ tokenMint: string; success: boolean; error?: string; price?: number }> = [];

  try {
    // Get base URL for internal API calls
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4444";

    // Fetch all tokens
    const tokensRes = await fetch(`${baseUrl}/api/tokens`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!tokensRes.ok) {
      throw new Error(`Failed to fetch tokens: ${tokensRes.status}`);
    }

    const tokensData = await tokensRes.json();
    if (!tokensData.success || !tokensData.tokens) {
      throw new Error("Invalid tokens response");
    }

    // Filter to Solana tokens only
    const solanaTokens = tokensData.tokens.filter(
      (t: { chain: string; contractAddress: string }) =>
        t.chain === "solana" && t.contractAddress
    );

    console.log(`[Cron:UpdatePrices] Found ${solanaTokens.length} Solana tokens to update`);

    // Update each token's price
    for (const token of solanaTokens) {
      try {
        const updateRes = await fetch(`${baseUrl}/api/solana/update-price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenMint: token.contractAddress,
            forceUpdate: false, // Only update if stale
          }),
        });

        const updateData = await updateRes.json();

        if (updateData.stale) {
          // Price couldn't be updated on-chain
          console.warn(
            `[Cron:UpdatePrices] ${token.symbol}: Price stale - ${updateData.reason || "unknown reason"}`
          );
          results.push({
            tokenMint: token.contractAddress,
            success: false,
            error: updateData.reason || "Price stale",
            price: updateData.price,
          });
        } else if (updateData.updated || (updateData.price && updateData.price > 0)) {
          console.log(
            `[Cron:UpdatePrices] ${token.symbol}: $${updateData.price || updateData.newPrice}`
          );
          results.push({
            tokenMint: token.contractAddress,
            success: true,
            price: updateData.price || updateData.newPrice,
          });
        } else {
          results.push({
            tokenMint: token.contractAddress,
            success: false,
            error: "No price available",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Cron:UpdatePrices] ${token.symbol}: ${message}`);
        results.push({
          tokenMint: token.contractAddress,
          success: false,
          error: message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(
      `[Cron:UpdatePrices] Complete: ${successCount} success, ${failCount} failed`
    );

    return NextResponse.json({
      success: true,
      updated: successCount,
      failed: failCount,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Cron:UpdatePrices] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
