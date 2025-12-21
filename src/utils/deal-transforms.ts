/**
 * Deal transformation utilities
 * Transforms API deal data to UI-friendly offer format
 */

import type { DealFromAPI } from "@/hooks/useDeals";

/**
 * Extended offer type with quoteId and token metadata
 */
export interface OfferWithMetadata {
  id: bigint;
  beneficiary: string;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: string;
  amountPaid: bigint;
  quoteId?: string;
  // Token metadata for display - required fields guaranteed by transform functions
  tokenSymbol: string;
  tokenName: string;
  tokenLogoUrl?: string;
  tokenId?: string;
  chain: string;
}

/**
 * Transform a Solana deal from API to offer format
 */
export function transformSolanaDeal(deal: DealFromAPI): OfferWithMetadata {
  const createdTs = deal.createdAt
    ? new Date(deal.createdAt).getTime() / 1000
    : Date.now() / 1000;

  // FAIL-FAST: DealResponseItemSchema requires lockupDays (required field)
  if (deal.lockupDays === undefined) {
    throw new Error("Deal missing required lockupDays field");
  }
  const lockupDays = deal.lockupDays;

  // FAIL-FAST: Required fields must be present
  if (!deal.offerId) {
    throw new Error(`Solana deal missing required offerId field`);
  }
  if (!deal.beneficiary) {
    throw new Error(
      `Solana deal ${deal.offerId} missing required beneficiary field`,
    );
  }
  if (typeof deal.discountBps !== "number") {
    throw new Error(
      `Solana deal ${deal.offerId} missing or invalid discountBps`,
    );
  }
  if (!deal.tokenAmount) {
    throw new Error(
      `Solana deal ${deal.offerId} missing required tokenAmount field`,
    );
  }
  if (!deal.paymentAmount) {
    throw new Error(
      `Solana deal ${deal.offerId} missing required paymentAmount field`,
    );
  }
  if (!deal.payer) {
    throw new Error(`Solana deal ${deal.offerId} missing required payer field`);
  }
  if (!deal.chain) {
    throw new Error(`Solana deal ${deal.offerId} missing required chain field`);
  }
  if (deal.priceUsdPerToken === undefined) {
    throw new Error(
      `Solana deal ${deal.offerId} missing required priceUsdPerToken field`,
    );
  }

  // tokenAmount from API is ALREADY in human-readable form (e.g., "1000" = 1000 tokens)
  const tokenAmountRaw = BigInt(Math.floor(parseFloat(deal.tokenAmount)));

  // FAIL-FAST: tokenSymbol and tokenName are required for display
  // DealFromAPI extends QuoteMemory which requires these fields
  if (!deal.tokenSymbol) {
    throw new Error(
      `Solana deal ${deal.quoteId ? deal.quoteId : deal.offerId} missing tokenSymbol`,
    );
  }
  if (!deal.tokenName) {
    throw new Error(
      `Solana deal ${deal.quoteId ? deal.quoteId : deal.offerId} missing tokenName`,
    );
  }

  return {
    id: BigInt(deal.offerId),
    beneficiary: deal.beneficiary,
    tokenAmount: tokenAmountRaw,
    discountBps: BigInt(deal.discountBps),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
    priceUsdPerToken: BigInt(Math.floor(deal.priceUsdPerToken * 1e8)),
    ethUsdPrice: BigInt(0), // Not used for Solana
    currency:
      deal.paymentCurrency === "SOL" || deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer,
    amountPaid: BigInt(deal.paymentAmount),
    quoteId: deal.quoteId,
    tokenSymbol: deal.tokenSymbol,
    tokenName: deal.tokenName,
    tokenLogoUrl: deal.tokenLogoUrl,
    tokenId: deal.tokenId,
    chain: deal.chain,
  };
}

/**
 * Transform an EVM deal from API to offer format
 */
export function transformEvmDeal(deal: DealFromAPI): OfferWithMetadata {
  const createdTs = deal.createdAt
    ? new Date(deal.createdAt).getTime() / 1000
    : Date.now() / 1000;

  // FAIL-FAST: DealResponseItemSchema requires lockupDays (required field)
  if (deal.lockupDays === undefined) {
    throw new Error("Deal missing required lockupDays field");
  }
  const lockupDays = deal.lockupDays;

  // FAIL-FAST: Required fields must be present
  if (!deal.offerId) {
    throw new Error(`EVM deal missing required offerId field`);
  }
  if (!deal.beneficiary) {
    throw new Error(
      `EVM deal ${deal.offerId} missing required beneficiary field`,
    );
  }
  if (typeof deal.discountBps !== "number") {
    throw new Error(`EVM deal ${deal.offerId} missing or invalid discountBps`);
  }
  if (!deal.tokenAmount) {
    throw new Error(
      `EVM deal ${deal.offerId} missing required tokenAmount field`,
    );
  }
  if (!deal.paymentAmount) {
    throw new Error(
      `EVM deal ${deal.offerId} missing required paymentAmount field`,
    );
  }
  if (!deal.payer) {
    throw new Error(`EVM deal ${deal.offerId} missing required payer field`);
  }
  if (!deal.chain) {
    throw new Error(`EVM deal ${deal.offerId} missing required chain field`);
  }

  // tokenAmount from API is ALREADY in human-readable form
  const tokenAmountRaw = BigInt(Math.floor(parseFloat(deal.tokenAmount)));

  // FAIL-FAST: tokenSymbol and tokenName are required for display
  // DealFromAPI extends QuoteMemory which requires these fields
  if (!deal.tokenSymbol) {
    throw new Error(
      `EVM deal ${deal.quoteId || deal.offerId} missing tokenSymbol`,
    );
  }
  if (!deal.tokenName) {
    throw new Error(
      `EVM deal ${deal.quoteId || deal.offerId} missing tokenName`,
    );
  }

  // FAIL-FAST: ethUsdPrice is required for EVM deals (required in OfferWithMetadata type)
  if (deal.ethUsdPrice === undefined) {
    throw new Error(
      `EVM deal ${deal.offerId} missing required ethUsdPrice field`,
    );
  }
  if (typeof deal.ethUsdPrice !== "number" || deal.ethUsdPrice <= 0) {
    throw new Error(
      `EVM deal ${deal.offerId} has invalid ethUsdPrice: ${deal.ethUsdPrice}`,
    );
  }

  // FAIL-FAST: priceUsdPerToken is required
  if (deal.priceUsdPerToken === undefined) {
    throw new Error(
      `EVM deal ${deal.offerId} missing required priceUsdPerToken field`,
    );
  }
  if (typeof deal.priceUsdPerToken !== "number" || deal.priceUsdPerToken <= 0) {
    throw new Error(
      `EVM deal ${deal.offerId} has invalid priceUsdPerToken: ${deal.priceUsdPerToken}`,
    );
  }

  return {
    id: BigInt(deal.offerId),
    beneficiary: deal.beneficiary,
    tokenAmount: tokenAmountRaw,
    discountBps: BigInt(deal.discountBps),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
    priceUsdPerToken: BigInt(Math.floor(deal.priceUsdPerToken * 1e8)),
    ethUsdPrice: BigInt(Math.floor(deal.ethUsdPrice * 1e8)),
    currency: deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer,
    amountPaid: BigInt(deal.paymentAmount),
    quoteId: deal.quoteId,
    tokenSymbol: deal.tokenSymbol,
    tokenName: deal.tokenName,
    tokenLogoUrl: deal.tokenLogoUrl,
    tokenId: deal.tokenId,
    chain: deal.chain,
  };
}

/**
 * Contract offer with ID (raw blockchain data from useOTC hook)
 * This type matches the Offer interface from types/index.ts plus the id field
 * Token metadata fields are NOT present on raw contract offers - they must be looked up
 */
type ContractOfferWithId = {
  id: bigint;
  consignmentId?: bigint;
  tokenId?: string; // bytes32 hex string (not the same as token-chain-address format)
  beneficiary: string;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  maxPriceDeviation?: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: string;
  amountPaid: bigint;
  agentCommissionBps?: number;
  // Token metadata may be added from database lookup
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  chain?: string;
};

/**
 * Merge database deals with contract offers
 * Database deals have quoteId and token metadata, contract offers may not
 */
export function mergeDealsWithOffers(
  dbDeals: DealFromAPI[],
  contractOffers: ContractOfferWithId[],
): OfferWithMetadata[] {
  const result: OfferWithMetadata[] = [];
  const processedOfferIds = new Set<string>();

  // Process database deals first (they have quoteId and token metadata)
  for (const deal of dbDeals) {
    if (deal.status !== "executed" && deal.status !== "approved") continue;

    // FAIL-FAST: Deal must have token metadata for display
    if (!deal.tokenSymbol) {
      const dealId = deal.quoteId ? deal.quoteId : deal.offerId;
      throw new Error(
        `Deal ${dealId ? dealId : "unknown"} missing tokenSymbol`,
      );
    }
    if (!deal.tokenName) {
      const dealId = deal.quoteId ? deal.quoteId : deal.offerId;
      throw new Error(`Deal ${dealId ? dealId : "unknown"} missing tokenName`);
    }

    const contractOffer = deal.offerId
      ? contractOffers.find((o) => o.id.toString() === deal.offerId)
      : undefined;

    if (contractOffer) {
      // Merge contract offer data with database token metadata
      result.push({
        ...contractOffer,
        quoteId: deal.quoteId,
        // Token metadata from database (required for display)
        tokenSymbol: deal.tokenSymbol,
        tokenName: deal.tokenName,
        tokenLogoUrl: deal.tokenLogoUrl,
        tokenId: deal.tokenId,
        chain: deal.chain
          ? deal.chain
          : (() => {
              throw new Error(
                `Deal ${deal.quoteId || deal.offerId} missing required chain field`,
              );
            })(),
      });
      if (deal.offerId) processedOfferIds.add(deal.offerId);
    } else {
      result.push(transformEvmDeal(deal));
    }
  }

  // Add contract offers not in database
  // FAIL-FAST: Only include offers with token metadata (required for display)
  // Contract offers without metadata cannot be displayed, so filter them out
  const contractOnlyOffers = contractOffers.filter((o) => {
    const offerId = o.id.toString();
    if (processedOfferIds.has(offerId)) return false;
    // Must have tokenSymbol and tokenName for display
    if (!o.tokenSymbol || !o.tokenName || !o.chain) return false;
    // FAIL-FAST: id is required - use explicit check
    return (
      o.id != null &&
      o.tokenAmount > 0n &&
      o.paid &&
      !o.fulfilled &&
      !o.cancelled
    );
  });

  // Type assertion safe here: we've filtered to only include offers with required fields
  result.push(
    ...contractOnlyOffers.map((o) => ({
      ...o,
      quoteId: undefined,
      tokenSymbol: o.tokenSymbol as string,
      tokenName: o.tokenName as string,
      chain: o.chain as string,
    })),
  );
  return result;
}

/**
 * Sort offers by creation date (newest first)
 */
export function sortOffersByDate(
  offers: OfferWithMetadata[],
): OfferWithMetadata[] {
  return [...offers].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

/**
 * Filter out withdrawn/cancelled offers
 */
export function filterActiveOffers(
  offers: OfferWithMetadata[],
): OfferWithMetadata[] {
  return offers.filter((o) => !o.cancelled && !o.fulfilled);
}
