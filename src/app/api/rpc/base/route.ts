import { NextRequest, NextResponse } from "next/server";
import { getAlchemyApiKey } from "@/config/env";
import {
  parseOrThrow,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  RpcRequestSchema,
  RpcProxyResponseSchema,
  RpcProxyErrorResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";

// Proxy RPC requests to Alchemy to keep API key server-side
// This prevents the Alchemy API key from being exposed in the browser

export async function POST(request: NextRequest) {
  const alchemyKey = getAlchemyApiKey();
  if (!alchemyKey) {
    console.error("[RPC Proxy] ALCHEMY_API_KEY not configured");
    const errorResponse = { error: "RPC not configured" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 500 });
  }

  const ALCHEMY_BASE_URL = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const body = await request.json();
  const data = parseOrThrow(RpcRequestSchema, body);

  const response = await fetch(ALCHEMY_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    console.error(
      "[RPC Proxy] Alchemy error:",
      response.status,
      response.statusText,
    );
    const errorResponse = { error: "RPC request failed" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: response.status });
  }

  const result = await response.json();

  // Validate RPC response structure (JSON-RPC format)
  const validatedResult = RpcProxyResponseSchema.parse(result);
  return NextResponse.json(validatedResult);
}
