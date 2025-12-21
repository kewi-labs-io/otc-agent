import type { OTCConsignment } from "@/services/database";
import type { ConsignmentWithDisplay } from "@/types";

// Sensitive fields that reveal the seller's full negotiation range
// Only the "worst case" starting point is exposed for negotiable deals
const NEGOTIABLE_SENSITIVE_FIELDS = [
  "maxDiscountBps", // Best discount - hidden
  "minLockupDays", // Best lockup - hidden
  "minDealAmount",
  "maxDealAmount",
  "allowedBuyers",
] as const;

// Re-export the shared type
export type { ConsignmentWithDisplay as SanitizedConsignment };

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
 *
 * This prevents buyers from gaming negotiations while still showing useful info.
 */
export function sanitizeConsignmentForBuyer(
  consignment: OTCConsignment,
): ConsignmentWithDisplay {
  // Build sanitized object with proper typing
  const sanitized: ConsignmentWithDisplay = {
    // Core fields (always present)
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
    // Display fields (computed based on deal type)
    // FAIL-FAST: Required fields based on isNegotiable flag
    displayDiscountBps: consignment.isNegotiable
      ? (() => {
          if (consignment.minDiscountBps == null) {
            throw new Error(
              "Negotiable consignment missing required minDiscountBps",
            );
          }
          return consignment.minDiscountBps;
        })()
      : (() => {
          if (consignment.fixedDiscountBps == null) {
            throw new Error(
              "Fixed consignment missing required fixedDiscountBps",
            );
          }
          return consignment.fixedDiscountBps;
        })(),
    displayLockupDays: consignment.isNegotiable
      ? (() => {
          if (consignment.maxLockupDays == null) {
            throw new Error(
              "Negotiable consignment missing required maxLockupDays",
            );
          }
          return consignment.maxLockupDays;
        })()
      : (() => {
          if (consignment.fixedLockupDays == null) {
            throw new Error(
              "Fixed consignment missing required fixedLockupDays",
            );
          }
          return consignment.fixedLockupDays;
        })(),
    termsType: consignment.isNegotiable ? "negotiable" : "fixed",
    // Fixed deal fields (only present for fixed deals)
    ...(consignment.isNegotiable
      ? {}
      : {
          fixedDiscountBps: consignment.fixedDiscountBps,
          fixedLockupDays: consignment.fixedLockupDays,
        }),
  };

  return sanitized;
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
    consignment.chain === "solana"
      ? callerAddress
      : callerAddress.toLowerCase();
  const normalizedConsigner =
    consignment.chain === "solana"
      ? consignment.consignerAddress
      : consignment.consignerAddress.toLowerCase();

  return normalizedCaller === normalizedConsigner;
}
