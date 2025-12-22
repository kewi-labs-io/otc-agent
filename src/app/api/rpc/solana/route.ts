import { type NextRequest, NextResponse } from "next/server";
import { getHeliusApiKey } from "@/config/env";
import {
  RpcProxyErrorResponseSchema,
  SolanaRpcHealthResponseSchema,
} from "@/types/validation/api-schemas";

// Proxy RPC requests to Helius to keep API key server-side
// This prevents the Helius API key from being exposed in the browser

export async function POST(request: NextRequest) {
  const heliusKey = getHeliusApiKey();
  if (!heliusKey) {
    console.error("[Solana RPC Proxy] HELIUS_API_KEY not configured");
    const errorResponse = { error: "Solana RPC not configured" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 500 });
  }

  const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

  let body;
  try {
    body = await request.json();
  } catch {
    const errorResponse = { error: "Invalid JSON body" };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 400 });
  }

  const response = await fetch(HELIUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      "[Solana RPC Proxy] Helius error:",
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
  return NextResponse.json(data);
}

// Also support GET for health checks
export async function GET() {
  const heliusKey = getHeliusApiKey();
  if (!heliusKey) {
    const healthErrorResponse = {
      status: "error",
      message: "HELIUS_API_KEY not configured",
    };
    const validatedHealthError = SolanaRpcHealthResponseSchema.parse(healthErrorResponse);
    return NextResponse.json(validatedHealthError, { status: 500 });
  }

  const healthResponse = { status: "ok", provider: "helius" };
  const validatedHealth = SolanaRpcHealthResponseSchema.parse(healthResponse);
  return NextResponse.json(validatedHealth);
}
