import { type NextRequest, NextResponse } from "next/server";
import { getAlchemyApiKey } from "@/config/env";
import { validationErrorResponse } from "@/lib/validation/helpers";
import {
  RpcProxyErrorResponseSchema,
  RpcProxyResponseSchema,
  RpcRequestSchema,
} from "@/types/validation/api-schemas";

// Allowed EVM RPC methods - only read operations needed by the frontend
const ALLOWED_EVM_RPC_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_sendRawTransaction",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
] as const;

type AllowedEvmMethod = (typeof ALLOWED_EVM_RPC_METHODS)[number];

function isAllowedEvmMethod(method: unknown): method is AllowedEvmMethod {
  return typeof method === "string" && ALLOWED_EVM_RPC_METHODS.includes(method as AllowedEvmMethod);
}

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

  let body: Record<string, unknown>;
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

  // Validate method is in whitelist
  const { method } = data;
  if (!isAllowedEvmMethod(method)) {
    const errorResponse = { error: `RPC method "${method}" is not allowed` };
    const validatedError = RpcProxyErrorResponseSchema.parse(errorResponse);
    return NextResponse.json(validatedError, { status: 403 });
  }

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
