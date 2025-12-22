/**
 * Deal transformation utilities
 */

import type { DealFromAPI } from "@/hooks/useDeals";

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
  tokenSymbol: string;
  tokenName: string;
  tokenLogoUrl?: string;
  tokenId?: string;
  chain: string;
}

/**
 * Validated deal with all required fields guaranteed to be defined.
 * This type is returned by validateDeal after runtime validation.
 * Note: Most fields are already required in DealFromAPI via QuoteMemory,
 * but payer is optional in DealFromAPI, so we make it required here.
 */
interface ValidatedDeal extends DealFromAPI {
  // Override optional field from DealFromAPI to be required
  payer: string;
}

/**
 * Validated EVM deal with ethUsdPrice guaranteed.
 */
interface ValidatedEvmDeal extends ValidatedDeal {
  ethUsdPrice: number;
}

/**
 * Validates a deal has all required fields and returns typed result.
 * Throws descriptive errors if any required field is missing.
 */
function validateDeal(deal: DealFromAPI, type: "Solana" | "EVM"): ValidatedDeal {
  const id = deal.quoteId || deal.offerId || "unknown";
  if (deal.lockupDays === undefined) throw new Error(`${type} deal ${id}: missing lockupDays`);
  if (!deal.offerId) throw new Error(`${type} deal ${id}: missing offerId`);
  if (!deal.beneficiary) throw new Error(`${type} deal ${id}: missing beneficiary`);
  if (typeof deal.discountBps !== "number")
    throw new Error(`${type} deal ${id}: invalid discountBps`);
  if (!deal.tokenAmount) throw new Error(`${type} deal ${id}: missing tokenAmount`);
  if (!deal.paymentAmount) throw new Error(`${type} deal ${id}: missing paymentAmount`);
  if (!deal.payer) throw new Error(`${type} deal ${id}: missing payer`);
  if (!deal.chain) throw new Error(`${type} deal ${id}: missing chain`);
  if (deal.priceUsdPerToken === undefined)
    throw new Error(`${type} deal ${id}: missing priceUsdPerToken`);
  if (!deal.tokenSymbol) throw new Error(`${type} deal ${id}: missing tokenSymbol`);
  if (!deal.tokenName) throw new Error(`${type} deal ${id}: missing tokenName`);

  // After validation, we can safely cast - all required fields verified above
  return deal as ValidatedDeal;
}

export function transformSolanaDeal(deal: DealFromAPI): OfferWithMetadata {
  const validated = validateDeal(deal, "Solana");

  const createdTs = validated.createdAt
    ? new Date(validated.createdAt).getTime() / 1000
    : Date.now() / 1000;

  return {
    id: BigInt(validated.offerId),
    beneficiary: validated.beneficiary,
    tokenAmount: BigInt(Math.floor(parseFloat(validated.tokenAmount))),
    discountBps: BigInt(validated.discountBps),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + validated.lockupDays * 86400)),
    priceUsdPerToken: BigInt(Math.floor(validated.priceUsdPerToken * 1e8)),
    ethUsdPrice: 0n,
    currency: validated.paymentCurrency === "SOL" || validated.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: validated.payer,
    amountPaid: BigInt(validated.paymentAmount),
    quoteId: validated.quoteId,
    tokenSymbol: validated.tokenSymbol,
    tokenName: validated.tokenName,
    tokenLogoUrl: validated.tokenLogoUrl,
    tokenId: validated.tokenId,
    chain: validated.chain,
  };
}

export function transformEvmDeal(deal: DealFromAPI): OfferWithMetadata {
  const validated = validateDeal(deal, "EVM");

  // Additional EVM-specific validation
  if (validated.ethUsdPrice === undefined || validated.ethUsdPrice <= 0) {
    throw new Error(`EVM deal ${validated.offerId}: invalid ethUsdPrice ${validated.ethUsdPrice}`);
  }
  if (validated.priceUsdPerToken <= 0) {
    throw new Error(
      `EVM deal ${validated.offerId}: invalid priceUsdPerToken ${validated.priceUsdPerToken}`,
    );
  }

  // After validation, ethUsdPrice is guaranteed to be a valid positive number
  const evmDeal = validated as ValidatedEvmDeal;

  const createdTs = evmDeal.createdAt
    ? new Date(evmDeal.createdAt).getTime() / 1000
    : Date.now() / 1000;

  return {
    id: BigInt(evmDeal.offerId),
    beneficiary: evmDeal.beneficiary,
    tokenAmount: BigInt(Math.floor(parseFloat(evmDeal.tokenAmount))),
    discountBps: BigInt(evmDeal.discountBps),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + evmDeal.lockupDays * 86400)),
    priceUsdPerToken: BigInt(Math.floor(evmDeal.priceUsdPerToken * 1e8)),
    ethUsdPrice: BigInt(Math.floor(evmDeal.ethUsdPrice * 1e8)),
    currency: evmDeal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: evmDeal.payer,
    amountPaid: BigInt(evmDeal.paymentAmount),
    quoteId: evmDeal.quoteId,
    tokenSymbol: evmDeal.tokenSymbol,
    tokenName: evmDeal.tokenName,
    tokenLogoUrl: evmDeal.tokenLogoUrl,
    tokenId: evmDeal.tokenId,
    chain: evmDeal.chain,
  };
}

type ContractOfferWithId = {
  id: bigint;
  consignmentId?: bigint;
  tokenId?: string;
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
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  chain?: string;
};

export function mergeDealsWithOffers(
  dbDeals: DealFromAPI[],
  contractOffers: ContractOfferWithId[],
): OfferWithMetadata[] {
  const result: OfferWithMetadata[] = [];
  const processedOfferIds = new Set<string>();

  for (const deal of dbDeals) {
    if (deal.status !== "executed" && deal.status !== "approved") continue;

    const id = deal.quoteId || deal.offerId || "unknown";
    if (!deal.tokenSymbol) throw new Error(`Deal ${id}: missing tokenSymbol`);
    if (!deal.tokenName) throw new Error(`Deal ${id}: missing tokenName`);
    if (!deal.chain) throw new Error(`Deal ${id}: missing chain`);

    const contractOffer = deal.offerId
      ? contractOffers.find((o) => o.id.toString() === deal.offerId)
      : undefined;

    if (contractOffer) {
      result.push({
        ...contractOffer,
        quoteId: deal.quoteId,
        tokenSymbol: deal.tokenSymbol,
        tokenName: deal.tokenName,
        tokenLogoUrl: deal.tokenLogoUrl,
        tokenId: deal.tokenId,
        chain: deal.chain,
      });
      if (deal.offerId) processedOfferIds.add(deal.offerId);
    } else {
      result.push(transformEvmDeal(deal));
    }
  }

  // Add contract offers not in database (only if they have required metadata)
  // Filter first, then map - this ensures TypeScript knows the fields are defined
  for (const offer of contractOffers) {
    if (processedOfferIds.has(offer.id.toString())) continue;
    if (!offer.tokenSymbol || !offer.tokenName || !offer.chain) continue;
    if (offer.tokenAmount <= 0n || !offer.paid || offer.fulfilled || offer.cancelled) continue;

    // At this point, tokenSymbol, tokenName, and chain are guaranteed to be defined
    result.push({
      ...offer,
      quoteId: undefined,
      tokenSymbol: offer.tokenSymbol,
      tokenName: offer.tokenName,
      chain: offer.chain,
    });
  }

  return result;
}

export function sortOffersByDate(offers: OfferWithMetadata[]): OfferWithMetadata[] {
  return [...offers].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

export function filterActiveOffers(offers: OfferWithMetadata[]): OfferWithMetadata[] {
  return offers.filter((o) => !o.cancelled && !o.fulfilled);
}
