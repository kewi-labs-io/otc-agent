import { type NextRequest, NextResponse } from "next/server";
import { validationErrorResponse } from "@/lib/validation/helpers";
import type { TokenInfo } from "@/types/api";
import {
  TokenLookupQuerySchema,
  TokenLookupResponseSchema,
} from "@/types/validation/api-schemas";
import { isEvmAddress, isSolanaAddress } from "@/utils/address-utils";

// Codex GraphQL endpoint and Solana network ID
const CODEX_GRAPHQL_URL = "https://graph.codex.io/graphql";
const SOLANA_NETWORK_ID = 1399811149;

/**
 * Look up Solana token via Codex API
 */
async function lookupSolanaToken(
  address: string,
  codexKey: string,
): Promise<TokenInfo | null> {
  const query = `
    query GetToken($input: TokenInput!) {
      token(input: $input) {
        name
        symbol
        address
        decimals
        info {
          imageSmallUrl
        }
      }
    }
  `;

  const response = await fetch(CODEX_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: codexKey,
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          address,
          networkId: SOLANA_NETWORK_ID,
        },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  // FAIL-FAST: Check response status
  if (!response.ok) {
    // Return null for "not found" - this is expected for invalid addresses
    // But log other errors for debugging
    if (response.status !== 404) {
      console.error(
        `[Token Lookup] Codex API error: ${response.status} ${response.statusText}`,
      );
    }
    return null;
  }

  const data = await response.json();
  // FAIL-FAST: Validate response structure
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid Codex API response: expected object");
  }

  const token = data.data?.token;

  if (!token) return null;

  // FAIL-FAST: Symbol and name are required - if missing, this indicates a data quality issue
  if (!token.symbol || typeof token.symbol !== "string") {
    throw new Error(`Codex token missing symbol for address: ${address}`);
  }
  if (!token.name || typeof token.name !== "string") {
    throw new Error(`Codex token missing name for address: ${address}`);
  }

  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: typeof token.decimals === "number" ? token.decimals : 9,
    logoUrl: token.info?.imageSmallUrl ?? null, // logoUrl is optional
    chain: "solana",
    priceUsd: null,
  };
}

/**
 * Look up EVM token via Alchemy API
 */
async function lookupEvmToken(
  address: string,
  chain: string,
  alchemyKey: string,
): Promise<TokenInfo | null> {
  const alchemyNetwork =
    chain === "ethereum"
      ? "eth-mainnet"
      : chain === "bsc"
        ? "bnb-mainnet"
        : "base-mainnet";

  const url = `https://${alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenMetadata",
      params: [address],
    }),
    signal: AbortSignal.timeout(5000),
  });

  // FAIL-FAST: Check response status
  if (!response.ok) {
    // Return null for "not found" - this is expected for invalid addresses
    // But log other errors for debugging
    if (response.status !== 404) {
      console.error(
        `[Token Lookup] Alchemy API error: ${response.status} ${response.statusText}`,
      );
    }
    return null;
  }

  const data = await response.json();
  // FAIL-FAST: Validate response structure
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid Alchemy API response: expected object");
  }

  const result = data.result;

  // No result means token not found - return null for 404
  if (!result) return null;

  // FAIL-FAST: Symbol, name, and decimals are required - if missing, this indicates a data quality issue
  if (!result.symbol || typeof result.symbol !== "string") {
    throw new Error(`Token metadata missing symbol for address: ${address}`);
  }
  if (!result.name || typeof result.name !== "string") {
    throw new Error(`Token metadata missing name for address: ${address}`);
  }
  if (typeof result.decimals !== "number") {
    throw new Error(
      `Token metadata missing or invalid decimals: ${result.decimals} for address: ${address}`,
    );
  }

  return {
    address: address.toLowerCase(),
    symbol: result.symbol,
    name: result.name,
    decimals: result.decimals,
    // logoUrl is optional - use null if not present
    logoUrl: result.logo ?? null,
    chain,
    priceUsd: null,
  };
}

/**
 * GET /api/token-lookup?address=0x...&chain=base
 * GET /api/token-lookup?address=So111...
 *
 * Looks up a single token by contract address.
 * Auto-detects chain if not provided for Solana addresses.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const parseResult = TokenLookupQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const { address } = parseResult.data;
  let { chain } = parseResult.data;

  // Auto-detect chain from address format using shared utility
  const looksLikeSolana = isSolanaAddress(address);
  const looksLikeEvm = isEvmAddress(address);

  if (!looksLikeSolana && !looksLikeEvm) {
    return NextResponse.json(
      { error: "Invalid address format" },
      { status: 400 },
    );
  }

  // If chain not provided, infer from address
  if (!chain) {
    chain = looksLikeSolana ? "solana" : "base";
  }

  let token: TokenInfo | null = null;

  if (chain === "solana") {
    const codexKey = process.env.CODEX_API_KEY;
    if (!codexKey) {
      return NextResponse.json(
        { error: "Solana token lookup not configured" },
        { status: 503 },
      );
    }
    token = await lookupSolanaToken(address, codexKey);
  } else {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      return NextResponse.json(
        { error: "EVM token lookup not configured" },
        { status: 503 },
      );
    }
    token = await lookupEvmToken(address, chain, alchemyKey);
  }

  if (!token) {
    return NextResponse.json(
      { error: "Token not found", address, chain },
      { status: 404 },
    );
  }

  const response = { success: true, token };
  const validatedResponse = TokenLookupResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
