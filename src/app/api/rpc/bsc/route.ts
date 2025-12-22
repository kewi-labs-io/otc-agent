import { type NextRequest, NextResponse } from "next/server";
import { getAlchemyApiKey } from "@/config/env";
import { validationErrorResponse } from "@/lib/validation/helpers";
import {
  RpcProxyErrorResponseSchema,
  RpcProxyResponseSchema,
  RpcRequestSchema,
} from "@/types/validation/api-schemas";

// Proxy RPC requests to Alchemy to keep API key server-side
// This prevents the Alchemy API key from being exposed in the browser

export async function POST(request: NextRequest) {
  const alchemyKey = getAlchemyApiKey();
  if (!alchemyKey) {
    console.error("[RPC Proxy BSC] ALCHEMY_API_KEY not configured");
    const errorResponse = { error: "RPC not configured" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 500 });
  }

  const ALCHEMY_BSC_URL = `https://bnb-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  let body;
  try {
    body = await request.json();
  } catch {
    const errorResponse = { error: "Invalid JSON body" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 400 });
  }

  const parseResult = RpcRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const data = parseResult.data;

  const response = await fetch(ALCHEMY_BSC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    console.error("[RPC Proxy BSC] Alchemy error:", response.status, response.statusText);
    const errorResponse = { error: "RPC request failed" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: response.status });
  }

  const result = await response.json();

  // Validate RPC response structure (JSON-RPC format)
  const validatedResult = RpcProxyResponseSchema.parse(result);
  return NextResponse.json(validatedResult);
}
