import type { OTCConsignment } from "@/services/database";
import type { ConsignmentWithDisplay } from "@/types";

// Re-export the shared type
export type { ConsignmentWithDisplay as SanitizedConsignment };

/**
 * Get display discount with fail-fast validation
 */
function getDisplayDiscount(c: OTCConsignment): number {
  if (c.isNegotiable) {
    if (c.minDiscountBps == null) {
      throw new Error("Negotiable consignment missing required minDiscountBps");
    }
    return c.minDiscountBps;
  }
  if (c.fixedDiscountBps == null) {
    throw new Error("Fixed consignment missing required fixedDiscountBps");
  }
  return c.fixedDiscountBps;
}

/**
 * Get display lockup with fail-fast validation
 */
function getDisplayLockup(c: OTCConsignment): number {
  if (c.isNegotiable) {
    if (c.maxLockupDays == null) {
      throw new Error("Negotiable consignment missing required maxLockupDays");
    }
    return c.maxLockupDays;
  }
  if (c.fixedLockupDays == null) {
    throw new Error("Fixed consignment missing required fixedLockupDays");
  }
  return c.fixedLockupDays;
}

/**
 * Sanitize consignment to hide negotiation terms from non-owners.
 *
 * For NEGOTIABLE deals: Shows "starting at" the worst possible deal
 *   - displayDiscountBps = minDiscountBps (lowest discount)
 *   - displayLockupDays = maxLockupDays (longest lockup)
 *
 * For FIXED deals: Shows the actual fixed terms
 *   - displayDiscountBps = fixedDiscountBps
 *   - displayLockupDays = fixedLockupDays
 */
export function sanitizeConsignmentForBuyer(consignment: OTCConsignment): ConsignmentWithDisplay {
  return {
    // Core fields
    id: consignment.id,
    tokenId: consignment.tokenId,
    consignerAddress: consignment.consignerAddress,
    consignerEntityId: consignment.consignerEntityId,
    totalAmount: consignment.totalAmount,
    remainingAmount: consignment.remainingAmount,
    isNegotiable: consignment.isNegotiable,
    minDiscountBps: consignment.minDiscountBps,
    minLockupDays: consignment.minLockupDays,
    isFractionalized: consignment.isFractionalized,
    isPrivate: consignment.isPrivate,
    maxPriceVolatilityBps: consignment.maxPriceVolatilityBps,
    maxTimeToExecuteSeconds: consignment.maxTimeToExecuteSeconds,
    status: consignment.status,
    contractConsignmentId: consignment.contractConsignmentId,
    chain: consignment.chain,
    createdAt: consignment.createdAt,
    updatedAt: consignment.updatedAt,
    lastDealAt: consignment.lastDealAt,
    // Display fields (computed with fail-fast validation)
    displayDiscountBps: getDisplayDiscount(consignment),
    displayLockupDays: getDisplayLockup(consignment),
    termsType: consignment.isNegotiable ? "negotiable" : "fixed",
    // Fixed deal fields (only for fixed deals)
    ...(consignment.isNegotiable
      ? {}
      : {
          fixedDiscountBps: consignment.fixedDiscountBps,
          fixedLockupDays: consignment.fixedLockupDays,
        }),
  };
}

/**
 * Check if a caller is the owner of a consignment.
 * Handles both Solana (case-sensitive) and EVM (case-insensitive) addresses.
 */
export function isConsignmentOwner(
  consignment: OTCConsignment,
  callerAddress: string | null | undefined,
): boolean {
  if (!callerAddress) return false;

  const normalizedCaller =
    consignment.chain === "solana" ? callerAddress : callerAddress.toLowerCase();
  const normalizedConsigner =
    consignment.chain === "solana"
      ? consignment.consignerAddress
      : consignment.consignerAddress.toLowerCase();

  return normalizedCaller === normalizedConsigner;
}
