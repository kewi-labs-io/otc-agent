import { NextRequest, NextResponse } from "next/server";
import { ConsignmentDB, TokenDB } from "@/services/database";
import type { Chain } from "@/config/chains";
import { ConsignmentService } from "@/services/consignmentService";
import { sanitizeConsignmentForBuyer } from "@/utils/consignment-sanitizer";
import { getCachedConsignments, getCachedToken, invalidateConsignmentCache, invalidateTokenCache } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tokenId = searchParams.get("tokenId");
    const chains = searchParams.getAll("chains") as Chain[];
    const negotiableTypes = searchParams.getAll("negotiableTypes");
    const isFractionalized = searchParams.get("isFractionalized");
    const consignerAddress = searchParams.get("consigner");
    const requesterAddress = searchParams.get("requester");

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
    if (chains.length > 0) {
      consignments = consignments.filter((c) =>
        chains.includes(c.chain as Chain),
      );
    }

    // Filter by negotiable types if specified
    if (negotiableTypes.length > 0) {
      consignments = consignments.filter((c) => {
        const isNeg = c.isNegotiable;
        if (negotiableTypes.includes("negotiable") && isNeg) return true;
        if (negotiableTypes.includes("fixed") && !isNeg) return true;
        return false;
      });
    }

    // Filter by fractionalized if specified
    if (isFractionalized === "true") {
      consignments = consignments.filter((c) => c.isFractionalized);
    }

    if (consignerAddress) {
      consignments = consignments.filter((c) => {
        // Solana addresses are case-sensitive, EVM addresses are case-insensitive
        if (c.chain === "solana") {
          return c.consignerAddress === consignerAddress;
        }
        return (
          c.consignerAddress.toLowerCase() === consignerAddress.toLowerCase()
        );
      });
    }

    if (requesterAddress) {
      consignments = consignments.filter((c) => {
        if (!c.isPrivate) return true;
        // Solana addresses are case-sensitive, EVM addresses are case-insensitive
        if (c.chain === "solana") {
          if (c.consignerAddress === requesterAddress) return true;
          if (c.allowedBuyers?.includes(requesterAddress)) return true;
        } else {
          const requester = requesterAddress.toLowerCase();
          if (c.consignerAddress.toLowerCase() === requester) return true;
          if (c.allowedBuyers?.some((b) => b.toLowerCase() === requester))
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
      const tokenResults = await Promise.all(
        uniqueTokenIds.map(async (tokenId: string) => {
          const token = await getCachedToken(tokenId);
          if (token) {
            return { tokenId, decimals: token.decimals };
          }
          return null;
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
        const decimals = tokenData?.decimals ?? (c.chain === "solana" ? 9 : 18);
        const oneToken = BigInt(10) ** BigInt(decimals);
        const remaining = BigInt(c.remainingAmount);
        return remaining >= oneToken;
      });
    }

    // Sanitize response: hide sensitive negotiation terms from non-owners
    // Only the consigner (owner) can see their own full listing details
    const isOwnerRequest = !!consignerAddress;
    const responseConsignments = isOwnerRequest
      ? consignments // Owner sees full data
      : consignments.map(sanitizeConsignmentForBuyer); // Buyers see sanitized data

    // Cache for 60 seconds, serve stale for 5 minutes while revalidating
    // Private cache if filtering by consigner (user-specific data)
    const cacheControl = consignerAddress
      ? "private, s-maxage=30, stale-while-revalidate=60"
      : "public, s-maxage=60, stale-while-revalidate=300";

    return NextResponse.json(
      {
        success: true,
        consignments: responseConsignments,
      },
      {
        headers: {
          "Cache-Control": cacheControl,
        },
      },
    );
  } catch (error) {
    console.error("[Consignments GET] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch consignments",
        consignments: [],
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
      // On-chain consignment ID (from contract creation)
      contractConsignmentId,
      // Token metadata (optional but recommended)
      tokenSymbol,
      tokenName,
      tokenDecimals,
      tokenLogoUrl,
      tokenAddress,
    } = body;

    if (!tokenId || !consignerAddress || !amount || !chain) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Save token metadata if provided (so we don't need to fetch from chain later)
    if (tokenSymbol && tokenAddress) {
      try {
        await TokenDB.createToken({
          symbol: tokenSymbol,
          name: tokenName || tokenSymbol,
          decimals: tokenDecimals ?? 18,
          chain: chain as Chain,
          contractAddress: tokenAddress,
          logoUrl: tokenLogoUrl || "",
          description: "",
          isActive: true,
        });
        console.log("[Consignments] Token saved:", {
          tokenId,
          tokenSymbol,
          tokenDecimals,
        });
      } catch (err) {
        // Token might already exist, that's fine
        console.log("[Consignments] Token already exists or save failed:", err);
      }
    }

    // Convert any number/string to BigInt-safe string (handles scientific notation)
    const toBigIntString = (value: string | number): string => {
      let num: number;

      if (typeof value === "string") {
        num = Number(value);
        if (isNaN(num) || !isFinite(num)) {
          throw new Error(`Invalid number: ${value}`);
        }
        // If string has no decimal and no scientific notation, use it directly
        if (!value.includes(".") && !value.toLowerCase().includes("e")) {
          try {
            return BigInt(value).toString();
          } catch {
            // Fall through
          }
        }
      } else {
        num = value;
      }

      // Convert number to integer string (handling scientific notation)
      // Use Intl.NumberFormat to avoid scientific notation in output
      const floored = Math.floor(num);
      const formatted = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
        useGrouping: false,
      }).format(floored);

      return formatted;
    };

    const service = new ConsignmentService();
    const consignment = await service.createConsignment({
      tokenId,
      consignerAddress,
      amount: toBigIntString(amount),
      isNegotiable,
      fixedDiscountBps,
      fixedLockupDays,
      minDiscountBps,
      maxDiscountBps,
      minLockupDays,
      maxLockupDays,
      minDealAmount: toBigIntString(minDealAmount),
      maxDealAmount: toBigIntString(maxDealAmount),
      isFractionalized,
      isPrivate,
      allowedBuyers,
      maxPriceVolatilityBps,
      maxTimeToExecuteSeconds,
      chain,
      contractConsignmentId,
    });

    // Invalidate caches so trading desk shows fresh data
    invalidateConsignmentCache();
    if (tokenSymbol && tokenAddress) {
      invalidateTokenCache(); // Token was also created
    }

    return NextResponse.json({
      success: true,
      consignment,
    });
  } catch (error) {
    console.error("Error creating consignment:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create consignment",
      },
      { status: 500 },
    );
  }
}
