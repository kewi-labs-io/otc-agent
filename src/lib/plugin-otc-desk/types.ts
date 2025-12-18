// Shared types for OTC Desk plugin - export for external use only

export type QuoteStatus =
  | "active"
  | "expired"
  | "executed"
  | "rejected"
  | "approved";
export type PaymentCurrency = "ETH" | "USDC";
export type ChainType = "evm" | "solana";

export interface QuoteMemory {
  id: string;
  quoteId: string;
  entityId: string;
  beneficiary: string;
  tokenAmount: string;
  discountBps: number;
  apr: number;
  lockupMonths: number;
  lockupDays: number;
  paymentCurrency: PaymentCurrency;
  priceUsdPerToken: number;
  totalUsd: number;
  discountUsd: number;
  discountedUsd: number;
  paymentAmount: string;
  status: QuoteStatus;
  signature: string;
  createdAt: number;
  executedAt: number;
  rejectedAt: number;
  approvedAt: number;
  offerId: string;
  transactionHash: string;
  blockNumber: number;
  rejectionReason: string;
  approvalNote: string;
  // Optional chain context to distinguish EVM vs Solana flows
  chain?: ChainType;
  // Token metadata for display
  tokenId?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  // Consignment reference
  consignmentId?: string;
  // Agent commission in basis points (0 for P2P, 25-150 for negotiated)
  agentCommissionBps?: number;
}

/**
 * Calculate agent commission based on discount and lockup
 * Discount component: 100 bps (1.0%) at ≤5% discount, 25 bps (0.25%) at ≥30% discount
 * Lockup component: 0 bps at 0 days, 50 bps (0.5%) at ≥365 days
 * Returns value between 25 and 150 bps
 */
export function calculateAgentCommission(discountBps: number, lockupDays: number): number {
  // Discount component: 100 bps at 5% discount, 25 bps at 30% discount
  let discountComponent: number;
  if (discountBps <= 500) {
    discountComponent = 100; // 1.0%
  } else if (discountBps >= 3000) {
    discountComponent = 25; // 0.25%
  } else {
    // Linear interpolation: 100 - (discountBps - 500) * 75 / 2500
    discountComponent = 100 - Math.floor((discountBps - 500) * 75 / 2500);
  }
  
  // Lockup component: 0 bps at 0 days, 50 bps at 365+ days
  let lockupComponent: number;
  if (lockupDays >= 365) {
    lockupComponent = 50; // 0.5%
  } else {
    lockupComponent = Math.floor((lockupDays * 50) / 365);
  }
  
  // Total commission: discount + lockup components
  const total = discountComponent + lockupComponent;
  
  // Ensure within bounds (25-150 bps)
  if (total < 25) return 25;
  if (total > 150) return 150;
  return total;
}

export interface UserSessionMemory {
  id: string;
  entityId: string;
  walletAddress: string;
  quotesCreated: number;
  lastQuoteAt: number;
  dailyQuoteCount: number;
  dailyResetAt: number;
  totalDeals: number;
  totalVolumeUsd: number;
  totalSavedUsd: number;
  createdAt: number;
  updatedAt: number;
}
