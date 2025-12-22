import { type NextRequest, NextResponse } from "next/server";
import type { Chain } from "@/config/chains";
import {
  getCachedConsignments,
  getCachedToken,
  invalidateConsignmentCache,
  invalidateTokenCache,
} from "@/lib/cache";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { ConsignmentService } from "@/services/consignmentService";
import { ConsignmentDB, TokenDB } from "@/services/database";
import {
  ConsignmentsResponseSchema,
  CreateConsignmentRequestSchema,
  CreateConsignmentResponseSchema,
  GetConsignmentsQuerySchema,
} from "@/types/validation/api-schemas";
import { sanitizeConsignmentForBuyer } from "@/utils/consignment-sanitizer";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Build params object that properly handles repeated query params (arrays)
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = params[key];
    if (existing !== undefined) {
      // Multiple values - convert to array
      params[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      params[key] = value;
    }
  }

  // Validate query params - return 400 on invalid params
  const parseResult = GetConsignmentsQuerySchema.safeParse(params);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  const {
    tokenId,
    chains,
    negotiableTypes,
    isFractionalized,
    consigner: consignerAddress,
    requester: requesterAddress,
  } = query;

  // For user-specific requests, bypass cache (private data)
  // For public requests, use serverless-optimized cache
  let consignments;
  if (consignerAddress) {
    // User's own consignments - don't use shared cache
    consignments = await ConsignmentDB.getConsignmentsByConsigner(
      consignerAddress,
      true, // include withdrawn
    );
  } else {
    // Public trading desk - use serverless cache
    const filters: { chain?: Chain; tokenId?: string } = {};
    if (tokenId) filters.tokenId = tokenId;
    consignments = await getCachedConsignments(filters);
  }

  // Filter by chains if specified
  if (chains && chains.length > 0) {
    consignments = consignments.filter((c) => chains.includes(c.chain as Chain));
  }

  // Filter by negotiable types if specified
  if (negotiableTypes && negotiableTypes.length > 0) {
    consignments = consignments.filter((c) => {
      const isNeg = c.isNegotiable;
      if (negotiableTypes.includes("negotiable") && isNeg) return true;
      if (negotiableTypes.includes("fixed") && !isNeg) return true;
      return false;
    });
  }

  // Filter out any null/undefined entries and by fractionalized if specified
  const totalBefore = consignments.length;
  consignments = consignments.filter((c) => c != null);
  const nullCount = totalBefore - consignments.length;
  if (nullCount > 0) {
    console.warn(
      `[Consignments API] WARNING: Found ${nullCount} null/undefined consignments in database - possible data corruption`,
    );
  }
  if (isFractionalized === true) {
    consignments = consignments.filter((c) => c.isFractionalized);
  }

  if (consignerAddress) {
    consignments = consignments.filter((c) => {
      // FAIL-FAST: Consignment must exist (already filtered above, but double-check)
      if (!c) {
        throw new Error("Null consignment found in filtered list - data corruption");
      }
      // FAIL-FAST: Consignment must have consignerAddress
      if (!c.consignerAddress) {
        throw new Error(`Consignment ${c.id} missing consignerAddress`);
      }
      // Solana addresses are case-sensitive, EVM addresses are case-insensitive
      if (c.chain === "solana") {
        return c.consignerAddress === consignerAddress;
      }
      return c.consignerAddress.toLowerCase() === consignerAddress.toLowerCase();
    });
  }

  if (requesterAddress) {
    consignments = consignments.filter((c) => {
      if (!c) return false;
      if (!c.isPrivate) return true;
      // FAIL-FAST: Consignment must have consignerAddress
      if (!c.consignerAddress) {
        throw new Error(`Consignment ${c.id} missing consignerAddress`);
      }
      // Solana addresses are case-sensitive, EVM addresses are case-insensitive
      if (c.chain === "solana") {
        if (c.consignerAddress === requesterAddress) return true;
        // allowedBuyers is optional array - check if present and includes requester
        if (Array.isArray(c.allowedBuyers) && c.allowedBuyers.includes(requesterAddress))
          return true;
      } else {
        const requester = requesterAddress.toLowerCase();
        if (c.consignerAddress.toLowerCase() === requester) return true;
        // allowedBuyers is optional array - check if present and includes requester
        if (
          Array.isArray(c.allowedBuyers) &&
          c.allowedBuyers.some((b) => b.toLowerCase() === requester)
        )
          return true;
      }
      return false;
    });
  } else {
    consignments = consignments.filter((c) => !c.isPrivate);
  }

  // Hide listings with < 1 token remaining from the public trading desk
  // (consigners can still see their own dust listings via consignerAddress filter)
  if (!consignerAddress) {
    // Batch fetch all unique tokens using serverless cache
    const uniqueTokenIds = Array.from(new Set(consignments.map((c) => c.tokenId)));
    const tokenMap = new Map<string, { decimals: number }>();

    // Fetch all tokens in parallel using cached function
    // Note: getCachedToken throws if token not found, so we catch and return null
    const tokenResults = await Promise.all(
      uniqueTokenIds.map(async (tokenId: string) => {
        try {
          const token = await getCachedToken(tokenId);
          if (token) {
            return { tokenId, decimals: token.decimals };
          }
          return null;
        } catch {
          // Token not found in database - log and skip
          console.warn(`[Consignments] Token ${tokenId} not found - consignment may be orphaned`);
          return null;
        }
      }),
    );

    // Build lookup map
    for (const result of tokenResults) {
      if (result) {
        tokenMap.set(result.tokenId, { decimals: result.decimals });
      }
    }

    // Filter consignments using the pre-fetched token data
    consignments = consignments.filter((c) => {
      const tokenData = tokenMap.get(c.tokenId);
      // FAIL-FAST: Token data should exist for all consignments
      if (!tokenData) {
        console.warn(
          `[Consignments] Token data missing for ${c.tokenId} - skipping consignment ${c.id}`,
        );
        return false;
      }
      const decimals = tokenData.decimals;
      const oneToken = BigInt(10) ** BigInt(decimals);
      const remaining = BigInt(c.remainingAmount);
      return remaining >= oneToken;
    });
  }

  // Filter out consignments with invalid chain values (data cleanup)
  const validChains = new Set(["ethereum", "base", "bsc", "solana"]);
  const validConsignments = consignments.filter((c) => {
    if (!validChains.has(c.chain)) {
      console.warn(
        `[Consignments] Invalid chain "${c.chain}" for consignment ${c.id} - filtering out`,
      );
      return false;
    }
    return true;
  });

  // Sanitize response: hide sensitive negotiation terms from non-owners
  // Only the consigner (owner) can see their own full listing details
  const isOwnerRequest = !!consignerAddress;
  const responseConsignments = isOwnerRequest
    ? validConsignments // Owner sees full data
    : validConsignments.map(sanitizeConsignmentForBuyer); // Buyers see sanitized data

  // Cache for 60 seconds, serve stale for 5 minutes while revalidating
  // Private cache if filtering by consigner (user-specific data)
  const cacheControl = consignerAddress
    ? "private, s-maxage=30, stale-while-revalidate=60"
    : "public, s-maxage=60, stale-while-revalidate=300";

  const response = {
    success: true as const,
    consignments: responseConsignments,
  };
  const validatedResponse = ConsignmentsResponseSchema.parse(response);

  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": cacheControl,
    },
  });
}

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body - return 400 on invalid params
  const parseResult = CreateConsignmentRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const data = parseResult.data;

  const {
    tokenId,
    consignerAddress,
    amount,
    isNegotiable,
    fixedDiscountBps,
    fixedLockupDays,
    minDiscountBps,
    maxDiscountBps,
    minLockupDays,
    maxLockupDays,
    minDealAmount,
    maxDealAmount,
    isFractionalized,
    isPrivate,
    allowedBuyers,
    maxPriceVolatilityBps,
    maxTimeToExecuteSeconds,
    chain,
    contractConsignmentId,
    tokenSymbol,
    tokenName,
    tokenDecimals,
    tokenLogoUrl,
    tokenAddress,
  } = data;

  console.log("[Consignments] Creating consignment:", {
    tokenId,
    chain,
    contractConsignmentId,
    tokenSymbol,
    tokenAddress,
    tokenDecimals,
  });

  // FAIL-FAST: Required token fields must be present
  if (!tokenSymbol) {
    return NextResponse.json(
      {
        success: false,
        error: "tokenSymbol is required for consignment creation",
      },
      { status: 400 },
    );
  }
  if (!tokenAddress) {
    return NextResponse.json(
      {
        success: false,
        error: "tokenAddress is required for consignment creation",
      },
      { status: 400 },
    );
  }

  // FAIL-FAST: Validate chain is a valid Chain type (schema should ensure this, but double-check)
  const validChains: Chain[] = ["ethereum", "base", "bsc", "solana"];
  if (!validChains.includes(chain as Chain)) {
    return NextResponse.json({ success: false, error: `Invalid chain: ${chain}` }, { status: 400 });
  }

  // Auto-fetch decimals if not provided
  let resolvedDecimals: number | undefined = tokenDecimals;
  if (typeof resolvedDecimals !== "number") {
    console.log(
      `[Consignments] tokenDecimals not provided, fetching from chain for ${tokenAddress} on ${chain}`,
    );
    try {
      // Build absolute URL for internal API call
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      const decimalsUrl = `${baseUrl}/api/tokens/decimals?address=${encodeURIComponent(tokenAddress)}&chain=${chain}`;
      const decimalsResponse = await fetch(decimalsUrl);
      if (!decimalsResponse.ok) {
        const errorData = await decimalsResponse.json().catch(() => ({}));
        return NextResponse.json(
          {
            success: false,
            error: `Failed to fetch token decimals: ${errorData.error || decimalsResponse.statusText}`,
          },
          { status: 400 },
        );
      }
      const decimalsData = await decimalsResponse.json();
      if (typeof decimalsData.decimals !== "number") {
        return NextResponse.json(
          { success: false, error: "Could not determine token decimals" },
          { status: 400 },
        );
      }
      resolvedDecimals = decimalsData.decimals;
      console.log(`[Consignments] Fetched decimals: ${resolvedDecimals} for ${tokenAddress}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, error: `Failed to fetch token decimals: ${message}` },
        { status: 400 },
      );
    }
  }

  // Save token metadata (required for quote lookups)
  // tokenName is optional - use tokenSymbol as default if not provided
  const tokenNameValue = tokenName || tokenSymbol;
  // logoUrl is optional - use empty string as default if not provided
  const logoUrlValue = tokenLogoUrl || "";

  // At this point resolvedDecimals is guaranteed to be a number
  // (we return early with error if we can't get it)
  if (typeof resolvedDecimals !== "number") {
    return NextResponse.json(
      {
        success: false,
        error: "tokenDecimals is required and must be a number",
      },
      { status: 400 },
    );
  }

  const savedToken = await TokenDB.createToken({
    symbol: tokenSymbol,
    name: tokenNameValue,
    decimals: resolvedDecimals,
    chain: chain as Chain, // Safe after validation above
    contractAddress: tokenAddress,
    logoUrl: logoUrlValue,
    description: "",
    isActive: true,
  });
  console.log("[Consignments] Token saved:", {
    savedTokenId: savedToken.id,
    symbol: savedToken.symbol,
    decimals: savedToken.decimals,
  });

  // FAIL-FAST: Validate required fields - these should come from schema but double-check
  if (!amount) {
    throw new Error("amount is required for consignment creation");
  }

  const service = new ConsignmentService();
  const consignment = await service.createConsignment({
    tokenId,
    consignerAddress,
    amount,
    isNegotiable: isNegotiable === true,
    fixedDiscountBps,
    fixedLockupDays,
    minDiscountBps: typeof minDiscountBps === "number" ? minDiscountBps : 0,
    maxDiscountBps: typeof maxDiscountBps === "number" ? maxDiscountBps : 10000,
    minLockupDays: typeof minLockupDays === "number" ? minLockupDays : 0,
    maxLockupDays: typeof maxLockupDays === "number" ? maxLockupDays : 365,
    // minDealAmount is optional - default to "1" if not provided (service layer requires it)
    minDealAmount: minDealAmount || "1",
    // maxDealAmount is optional - default to amount if not provided (service layer requires it)
    maxDealAmount: maxDealAmount || amount,
    isFractionalized: isFractionalized === true,
    isPrivate: isPrivate === true,
    allowedBuyers: Array.isArray(allowedBuyers) ? allowedBuyers : undefined,
    maxPriceVolatilityBps: typeof maxPriceVolatilityBps === "number" ? maxPriceVolatilityBps : 1000,
    maxTimeToExecuteSeconds:
      typeof maxTimeToExecuteSeconds === "number" ? maxTimeToExecuteSeconds : 3600,
    chain,
    contractConsignmentId,
  });

  // Invalidate caches so trading desk shows fresh data
  invalidateConsignmentCache();
  if (tokenSymbol && tokenAddress) {
    invalidateTokenCache(); // Token was also created
  }

  const response = { success: true, consignment };
  const validatedResponse = CreateConsignmentResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
