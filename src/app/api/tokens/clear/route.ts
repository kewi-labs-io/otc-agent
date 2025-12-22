import { NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { ClearTokensResponseSchema } from "@/types/validation/api-schemas";

/**
 * Clear all tokens from the database (dev utility)
 * POST /api/tokens/clear
 */
export async function POST() {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    const prodErrorResponse = {
      success: false,
      error: "Not allowed in production",
    };
    const validatedProdError = ClearTokensResponseSchema.parse(prodErrorResponse);
    return NextResponse.json(validatedProdError, { status: 403 });
  }

  const runtime = await agentRuntime.getRuntime();

  // Get all token IDs
  // Cache may be empty (no tokens registered yet) - use empty array as default
  const cachedTokenIds = await runtime.getCache<string[]>("all_tokens");
  const allTokenIds = Array.isArray(cachedTokenIds) ? cachedTokenIds : [];

  // Delete each token
  for (const tokenId of allTokenIds) {
    await runtime.setCache(`token:${tokenId}`, null);
  }

  // Clear the token list
  await runtime.setCache("all_tokens", []);

  const clearResponse = {
    success: true,
    message: `Cleared ${allTokenIds.length} tokens`,
    clearedTokens: allTokenIds,
  };
  const validatedClear = ClearTokensResponseSchema.parse(clearResponse);
  return NextResponse.json(validatedClear);
}
