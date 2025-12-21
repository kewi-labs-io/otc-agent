import { NextRequest, NextResponse } from "next/server";
import {
  parseOrThrow,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  RpcRequestSchema,
  RpcProxyErrorResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";

/**
 * Proxy for Solana RPC calls to hide the API key from the client
 */
export async function POST(request: NextRequest) {
  const heliusKey = process.env.HELIUS_API_KEY;

  if (!heliusKey) {
    const errorResponse = { error: "Solana RPC not configured" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 500 });
  }

  const body = await request.json();

  const response = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  // FAIL-FAST: Check response status before parsing JSON
  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      "[Solana RPC] Helius error:",
      response.status,
      response.statusText,
      errorText,
    );
    const errorResponse = {
      error: "Solana RPC request failed",
      details: errorText,
    };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: response.status });
  }

  const data = await response.json();
  // FAIL-FAST: Validate response structure
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid Solana RPC response: expected object");
  }

  return NextResponse.json(data);
}
